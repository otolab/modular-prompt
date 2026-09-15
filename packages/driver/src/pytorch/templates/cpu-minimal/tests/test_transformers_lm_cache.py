from types import SimpleNamespace

import pytest

torch = pytest.importorskip("torch")

from backends.transformers_lm import TransformersLmBackend


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

    def encode(self, prompt, add_special_tokens):
        del add_special_tokens
        return self.prompts[prompt]


class _Model:
    def __init__(self, past_key_values, generated_texts=None):
        self.past_key_values = past_key_values
        self.generated_texts = generated_texts or ["generated"]
        self.forward_calls = []
        self.generate_calls = []

    def __call__(self, **kwargs):
        self.forward_calls.append(kwargs)
        return SimpleNamespace(past_key_values=self.past_key_values)

    def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
        streamer = kwargs["streamer"]
        for index, text in enumerate(self.generated_texts):
            streamer.on_finalized_text(
                text,
                stream_end=index == len(self.generated_texts) - 1,
            )


def _backend(generated_texts=None):
    # Legacy tuple-shaped caches remain supported by Transformers and make the
    # test independent of a specific Cache class implementation.
    key = torch.zeros((1, 1, 2, 4))
    value = torch.zeros((1, 1, 2, 4))
    past_key_values = ((key, value),)

    backend = TransformersLmBackend()
    backend.tokenizer = _Tokenizer()
    backend.model = _Model(past_key_values, generated_texts)
    return backend, past_key_values


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

    assert [chunk.text for chunk in chunks] == ["generated"]
    call = backend.model.generate_calls[0]
    assert call["input_ids"].tolist() == [[3]]
    assert call["past_key_values"] is not past_key_values
    assert torch.equal(call["past_key_values"][0][0], past_key_values[0][0])
    assert call["cache_position"].tolist() == [2]
    assert call["attention_mask"].tolist() == [[1, 1, 1]]
    assert chunks[0].prompt_tokens == 3
    assert chunks[0].generation_tokens == 1
    assert chunks[0].cache_read_tokens == 2


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

    assert [chunk.text for chunk in chunks] == ["a", "b", "c"]
    assert [chunk.generation_tokens for chunk in chunks] == [1, 2, 3]
    assert chunks[0].prompt_tokens == 3
    assert chunks[1].prompt_tokens is None
    assert chunks[0].cache_read_tokens == 2
    assert chunks[1].cache_read_tokens is None


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
