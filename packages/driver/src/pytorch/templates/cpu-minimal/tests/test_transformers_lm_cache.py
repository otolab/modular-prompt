import json
from types import SimpleNamespace

import pytest

torch = pytest.importorskip("torch")

from backends.transformers_lm import TransformersLmBackend
from handlers.generate import handle_generate
from tokenizers import Tokenizer
from tokenizers.models import WordLevel
from tokenizers.pre_tokenizers import Whitespace
from transformers import GPT2Config, GPT2LMHeadModel, PreTrainedTokenizerFast


class _Tokenizer:
    bos_token = "<bos>"
    pad_token = "<pad>"
    eos_token = "<eos>"

    def __init__(self):
        self.prompts = {
            "prefix": [1, 2],
            "prefix suffix": [1, 2, 3],
            "different suffix": [9, 8, 7],
            "hello alpha": [1, 2],
            "hello beta": [1, 3],
            "hello beta gamma": [1, 3, 4],
        }
        self.token_text = {
            10: "a",
            11: "b",
            12: "c",
            13: "d",
        }

    def encode(self, prompt, add_special_tokens):
        del add_special_tokens
        return self.prompts[prompt]

    def decode(self, token_ids, **kwargs):
        del kwargs
        if isinstance(token_ids, torch.Tensor):
            token_ids = token_ids.flatten().tolist()
        return "".join(self.token_text.get(int(token_id), "x") for token_id in token_ids)


class _Model:
    def __init__(self, past_key_values, generated_texts=None, generated_token_batches=None):
        self.past_key_values = past_key_values
        self.generated_texts = generated_texts or ["generated"]
        self.generated_token_batches = generated_token_batches
        self.forward_calls = []
        self.generate_calls = []

    def __call__(self, **kwargs):
        self.forward_calls.append(kwargs)
        return SimpleNamespace(past_key_values=self.past_key_values)

    def _emit_stream(self, streamer, input_ids, token_batches):
        streamer.put(input_ids.cpu())
        for token_batch in token_batches:
            streamer.put(torch.tensor(token_batch, dtype=torch.long))
        streamer.end()

    def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
        streamer = kwargs["streamer"]
        if self.generated_token_batches is not None:
            self._emit_stream(streamer, kwargs["input_ids"], self.generated_token_batches)
            return
        token_batches = [[10 + index] for index in range(len(self.generated_texts))]
        self._emit_stream(streamer, kwargs["input_ids"], token_batches)


class _IncrementalModel(_Model):
    def __call__(self, **kwargs):
        self.forward_calls.append(kwargs)
        input_ids = kwargs["input_ids"]
        suffix_length = input_ids.shape[-1]
        past_key_values = kwargs.get("past_key_values")
        if past_key_values is None:
            key = torch.zeros((1, 1, suffix_length, 4))
            value = torch.zeros((1, 1, suffix_length, 4))
        else:
            key, value = past_key_values[0]
            key_tail = torch.zeros(
                (key.shape[0], key.shape[1], suffix_length, key.shape[3])
            )
            value_tail = torch.zeros(
                (value.shape[0], value.shape[1], suffix_length, value.shape[3])
            )
            key = torch.cat((key, key_tail), dim=-2)
            value = torch.cat((value, value_tail), dim=-2)
        self.past_key_values = ((key, value),)
        return SimpleNamespace(past_key_values=self.past_key_values)


class _CacheLayer:
    def __init__(self, token_count):
        self.keys = torch.zeros((1, 1, token_count, 4))
        self.values = torch.zeros((1, 1, token_count, 4))

    def get_seq_length(self):
        return self.keys.shape[-2]


class _Cache:
    def __init__(self, token_count):
        self.layers = [_CacheLayer(token_count)]

    def get_seq_length(self):
        return self.layers[0].get_seq_length()


def _backend(generated_texts=None, generated_token_batches=None):
    # Legacy tuple-shaped caches remain supported by Transformers and make the
    # test independent of a specific Cache class implementation.
    key = torch.zeros((1, 1, 2, 4))
    value = torch.zeros((1, 1, 2, 4))
    past_key_values = ((key, value),)

    backend = TransformersLmBackend()
    backend.tokenizer = _Tokenizer()
    backend.model = _Model(past_key_values, generated_texts, generated_token_batches)
    return backend, past_key_values


def _incremental_backend():
    key = torch.zeros((1, 1, 2, 4))
    value = torch.zeros((1, 1, 2, 4))
    model = _IncrementalModel(((key, value),))
    backend = TransformersLmBackend()
    backend.tokenizer = _Tokenizer()
    backend.model = model
    return backend, model


def _tiny_gpt2_backend():
    vocab = {
        "<pad>": 0,
        "<unk>": 1,
        "hello": 2,
        "alpha": 3,
        "beta": 4,
        "gamma": 5,
    }
    tokenizer = Tokenizer(WordLevel(vocab=vocab, unk_token="<unk>"))
    tokenizer.pre_tokenizer = Whitespace()
    fast_tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=tokenizer,
        unk_token="<unk>",
        pad_token="<pad>",
    )
    config = GPT2Config(
        vocab_size=len(vocab),
        n_positions=32,
        n_ctx=32,
        n_embd=16,
        n_layer=1,
        n_head=1,
        pad_token_id=vocab["<pad>"],
        eos_token_id=None,
    )
    model = GPT2LMHeadModel(config)
    # Make greedy output deterministic and non-special so the streamer emits
    # several chunks without downloading a model in CI.
    model.lm_head = torch.nn.Linear(config.n_embd, config.vocab_size, bias=True)
    with torch.no_grad():
        model.lm_head.weight.zero_()
        model.lm_head.bias.fill_(-1)
        model.lm_head.bias[vocab["alpha"]] = 1
    model.eval()

    backend = TransformersLmBackend()
    backend.tokenizer = fast_tokenizer
    backend.model = model
    return backend


def test_cache_prefill_keeps_past_key_values_in_process():
    backend, past_key_values = _backend()

    result = backend.cache_prefill("memory://prefix", "prefix")

    assert result == {
        "cache_path": "memory://prefix",
        "token_count": 2,
        "cache_write_tokens": 2,
    }
    assert backend.load_cache_from_file("memory://prefix") is past_key_values
    assert backend.consume_cache_write_tokens("memory://prefix") == 2
    assert backend.consume_cache_write_tokens("memory://prefix") == 0
    call = backend.model.forward_calls[0]
    assert call["input_ids"].tolist() == [[1, 2]]
    assert call["input_ids"].device == backend._device
    assert call["use_cache"] is True


def test_cache_prefill_persists_cache_and_metadata(tmp_path):
    backend, past_key_values = _backend()
    cache_path = tmp_path / "prefix.pytorch-cache"

    result = backend.cache_prefill(
        str(cache_path),
        "prefix",
        prefix_offsets=[2],
        prefix_hashes=["hash-prefix"],
    )

    assert result == {
        "cache_path": str(cache_path),
        "token_count": 2,
        "cache_write_tokens": 2,
    }
    assert cache_path.is_file()
    meta = json.loads(cache_path.with_name(cache_path.name + ".meta.json").read_text())
    assert meta == {
        "layout": "pytorch_kv_v1",
        "token_count": 2,
        "prefix_offsets": [2],
        "prefix_hashes": ["hash-prefix"],
        "model_id": "unknown",
        "dtype": "float32",
        "device": "cpu",
    }

    restarted_backend, _ = _backend()
    loaded = restarted_backend.load_cache_from_file(
        str(cache_path),
        prompt="prefix suffix",
    )
    assert loaded is not None
    assert loaded is not past_key_values
    assert restarted_backend.get_cache_offset(loaded) == 2
    assert torch.equal(loaded[0][0], past_key_values[0][0])


def test_disk_cache_load_rejects_model_metadata_mismatch(tmp_path):
    backend, _ = _backend()
    cache_path = tmp_path / "prefix.pytorch-cache"
    backend.cache_prefill(str(cache_path), "prefix")

    restarted_backend, _ = _backend()
    restarted_backend._model_id = "different-model"

    assert restarted_backend.load_cache_from_file(str(cache_path), prompt="prefix") is None


def test_disk_cache_loads_after_restart_and_generates_with_trim(tmp_path, capsys):
    cache_path = tmp_path / "prefix.pytorch-cache"
    backend = _tiny_gpt2_backend()
    backend.cache_prefill(str(cache_path), "hello alpha")

    restarted_backend = _tiny_gpt2_backend()
    handle_generate(
        restarted_backend,
        "hello alpha beta",
        options={"max_tokens": 1, "temperature": 0},
        cache_path=str(cache_path),
        cache_trim_tokens=1,
    )

    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["prompt_tokens"] == 3
    assert meta["generation_tokens"] == 1
    assert meta["cache_read_tokens"] == 1
    assert meta["cache_loaded"] is True


def test_incremental_prefill_loads_base_trims_and_prefills_suffix(tmp_path):
    base_backend, _ = _backend()
    base_path = tmp_path / "base.pytorch-cache"
    base_backend.cache_prefill(str(base_path), "prefix")

    backend, model = _incremental_backend()
    cache_path = tmp_path / "extended.pytorch-cache"
    result = backend.cache_prefill(
        str(cache_path),
        "prefix suffix",
        base_cache_path=str(base_path),
        trim_to_tokens=2,
        prefix_offsets=[2, 3],
        prefix_hashes=["hash-prefix", "hash-full"],
    )

    assert result == {
        "cache_path": str(cache_path),
        "token_count": 3,
        "cache_write_tokens": 1,
    }
    call = model.forward_calls[0]
    assert call["input_ids"].tolist() == [[3]]
    assert call["past_key_values"][0][0].shape[-2] == 2
    assert call["cache_position"].tolist() == [2]
    assert call["attention_mask"].tolist() == [[1, 1, 1]]
    assert backend.get_cache_offset(backend._caches[str(cache_path)]) == 3

    meta = json.loads(cache_path.with_name(cache_path.name + ".meta.json").read_text())
    assert meta["token_count"] == 3
    assert meta["prefix_offsets"] == [2, 3]
    assert meta["prefix_hashes"] == ["hash-prefix", "hash-full"]


def test_incremental_prefill_validates_only_trimmed_prefix(tmp_path, capsys):
    base_backend, _ = _backend()
    base_path = tmp_path / "base.pytorch-cache"
    base_backend.cache_prefill(str(base_path), "hello alpha")

    backend, model = _incremental_backend()
    cache_path = tmp_path / "diverged.pytorch-cache"
    result = backend.cache_prefill(
        str(cache_path),
        "hello beta",
        base_cache_path=str(base_path),
        trim_to_tokens=1,
    )

    assert result["token_count"] == 2
    assert result["cache_write_tokens"] == 1
    assert model.forward_calls[0]["input_ids"].tolist() == [[3]]
    assert model.forward_calls[0]["past_key_values"][0][0].shape[-2] == 1

    handle_generate(
        backend,
        "hello beta gamma",
        options={"max_tokens": 1},
        cache_path=str(cache_path),
    )
    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["cache_loaded"] is True
    assert meta["cache_read_tokens"] == 2


def test_generate_trim_does_not_mutate_reusable_disk_cache(tmp_path, capsys):
    cache_path = tmp_path / "prefix.pytorch-cache"
    backend = _tiny_gpt2_backend()
    backend.cache_prefill(str(cache_path), "hello alpha")
    original_cache = backend.load_cache_from_file(
        str(cache_path),
        prompt="hello alpha beta",
    )
    assert original_cache is not None
    assert backend.get_cache_offset(original_cache) == 2

    handle_generate(
        backend,
        "hello alpha beta",
        options={"max_tokens": 1, "temperature": 0},
        cache_path=str(cache_path),
        cache_trim_tokens=1,
    )
    first_output = capsys.readouterr().out
    first_meta = json.loads(
        first_output.split("\x1e__META__:", 1)[1].split("\0", 1)[0]
    )
    assert first_meta["cache_loaded"] is True
    assert first_meta["cache_read_tokens"] == 1
    assert backend.get_cache_offset(original_cache) == 2

    handle_generate(
        backend,
        "hello alpha beta",
        options={"max_tokens": 1, "temperature": 0},
        cache_path=str(cache_path),
    )
    second_output = capsys.readouterr().out
    second_meta = json.loads(
        second_output.split("\x1e__META__:", 1)[1].split("\0", 1)[0]
    )
    assert second_meta["cache_loaded"] is True
    assert second_meta["cache_read_tokens"] == 2
    assert backend.get_cache_offset(original_cache) == 2


def test_generate_trim_validates_only_trimmed_prefix(tmp_path, capsys):
    base_path = tmp_path / "base.pytorch-cache"
    base_backend = _tiny_gpt2_backend()
    base_backend.cache_prefill(str(base_path), "hello alpha")

    backend = _tiny_gpt2_backend()
    handle_generate(
        backend,
        "hello beta gamma",
        options={"max_tokens": 1, "temperature": 0},
        cache_path=str(base_path),
        cache_trim_tokens=1,
    )

    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["cache_loaded"] is True
    assert meta["cache_read_tokens"] == 1


def test_trim_cache_supports_legacy_tuple_and_cache_objects():
    backend, past_key_values = _backend()

    trimmed_tuple = backend.trim_cache(past_key_values, 1)
    assert backend.get_cache_offset(trimmed_tuple) == 1
    assert trimmed_tuple[0][0].shape[-2] == 1
    assert backend.get_cache_offset(past_key_values) == 2

    cache = _Cache(3)
    trimmed_cache = backend.trim_cache(cache, 1)
    assert trimmed_cache is not cache
    assert backend.get_cache_offset(trimmed_cache) == 2
    assert backend.get_cache_offset(cache) == 3
    assert trimmed_cache.layers[0].keys.shape[-2] == 2
    assert cache.layers[0].keys.shape[-2] == 3


def test_load_cache_validates_prompt_prefix_without_reading_a_file():
    backend, past_key_values = _backend()
    backend.cache_prefill("memory://prefix", "prefix")

    assert backend.load_cache_from_file(
        "memory://prefix", prompt="prefix suffix"
    ) is past_key_values
    assert backend.load_cache_from_file(
        "memory://prefix", prompt="different suffix"
    ) is None
    assert backend.load_cache_from_file("/tmp/not-created.cache") is None


def test_stream_generate_passes_cached_prefix_and_reports_usage():
    backend, past_key_values = _backend()
    backend.cache_prefill("memory://prefix", "prefix")

    chunks = list(
        backend.stream_generate(
            [3],
            {"max_tokens": 1, "temperature": 0},
            prompt_cache=past_key_values,
        )
    )

    assert chunks[-1].text == "a"
    assert chunks[-1].generation_tokens == 1
    call = backend.model.generate_calls[0]
    assert call["input_ids"].tolist() == [[3]]
    assert call["past_key_values"] is not past_key_values
    assert torch.equal(call["past_key_values"][0][0], past_key_values[0][0])
    assert call["cache_position"].tolist() == [2]
    assert call["attention_mask"].tolist() == [[1, 1, 1]]
    first_meta_chunk = next(chunk for chunk in chunks if chunk.prompt_tokens is not None)
    assert first_meta_chunk.prompt_tokens == 3
    assert first_meta_chunk.cache_read_tokens == 2


def test_stream_generate_reports_cumulative_generation_tokens_for_multiple_chunks():
    backend, past_key_values = _backend(["a", "b", "c"])
    backend.cache_prefill("memory://prefix", "prefix")

    chunks = list(
        backend.stream_generate(
            [3],
            {"max_tokens": 3, "temperature": 0},
            prompt_cache=past_key_values,
        )
    )

    assert chunks[-1].text == "abc"
    assert chunks[-1].generation_tokens == 3
    first_meta_chunk = next(chunk for chunk in chunks if chunk.prompt_tokens is not None)
    assert first_meta_chunk.prompt_tokens == 3
    assert first_meta_chunk.cache_read_tokens == 2


def test_stream_generate_counts_token_ids_not_empty_text_chunks(capsys):
    backend, _ = _backend(generated_token_batches=[[10], [11], [12], [13]])

    chunks = list(
        backend.stream_generate(
            "prefix suffix",
            {"max_tokens": 4, "temperature": 0},
        )
    )

    # TextIteratorStreamer emits an empty chunk while buffering each token and
    # one final text chunk, so chunk count is five for four generated tokens.
    assert len(chunks) == 5
    assert chunks[0].text == ""
    assert chunks[-1].text == "abcd"
    assert chunks[-1].generation_tokens == 4

    handle_generate(
        backend,
        "prefix suffix",
        options={"max_tokens": 4, "temperature": 0},
    )
    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["prompt_tokens"] == 3
    assert meta["generation_tokens"] == 4


def test_generate_handler_reports_backend_prefill_write_usage(capsys):
    backend, _ = _backend()
    backend.cache_prefill("memory://prefix", "prefix")

    handle_generate(
        backend,
        "prefix suffix",
        options={"max_tokens": 1, "temperature": 0},
        cache_path="memory://prefix",
    )

    output = capsys.readouterr().out
    assert output.startswith("a")
    meta = output.split("\x1e__META__:", 1)[1].split("\0", 1)[0]
    assert json.loads(meta) == {
        "prompt_tokens": 3,
        "generation_tokens": 1,
        "cache_read_tokens": 2,
        "cache_write_tokens": 2,
        "cache_loaded": True,
    }


def test_generate_handler_preserves_usage_for_tiny_gpt2_multiple_chunks(capsys):
    backend = _tiny_gpt2_backend()
    options = {"max_tokens": 4, "temperature": 0}

    expected_chunks = list(backend.stream_generate("hello", options))
    # The real TextIteratorStreamer buffers the generated word, so the first
    # text chunk is empty and the final chunk flushes all four generated
    # tokens.  Token usage must not be derived from this five-chunk sequence.
    assert len(expected_chunks) == 5
    assert expected_chunks[0].text == ""
    expected_generation_tokens = expected_chunks[-1].generation_tokens
    assert expected_generation_tokens == 4

    handle_generate(backend, "hello", options=options)

    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["prompt_tokens"] == len(backend.tokenize_prompt("hello"))
    assert meta["generation_tokens"] == expected_generation_tokens


def test_cache_prefill_uses_cold_path_when_base_cache_is_missing():
    backend, _ = _backend()

    result = backend.cache_prefill(
        "memory://prefix",
        "prefix",
        base_cache_path="memory://base",
    )

    assert result["token_count"] == 2
    assert result["cache_write_tokens"] == 2
