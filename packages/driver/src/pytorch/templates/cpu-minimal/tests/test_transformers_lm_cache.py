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
    assert len(expected_chunks) > 1
    expected_generation_tokens = expected_chunks[-1].generation_tokens
    assert expected_generation_tokens == 4

    handle_generate(backend, "hello", options=options)

    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["prompt_tokens"] == len(backend.tokenize_prompt("hello"))
    assert meta["generation_tokens"] == expected_generation_tokens


def test_cache_prefill_rejects_phase_two_arguments():
    backend, _ = _backend()

    try:
        backend.cache_prefill(
            "memory://prefix",
            "prefix",
            base_cache_path="memory://base",
        )
    except ValueError as error:
        assert "incremental prefill" in str(error)
    else:
        raise AssertionError("Phase 2 incremental prefill must be rejected")
