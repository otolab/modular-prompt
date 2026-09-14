import sys
from types import ModuleType, SimpleNamespace

import pytest

pytest.importorskip("mlx_vlm")

import backends.mlx_vlm as vlm_module
from backends.mlx_vlm import MlxVlmBackend


class _Tokenizer:
    bos_token = "<bos>"

    def encode(self, prompt, add_special_tokens):
        return list(range(1 if add_special_tokens else 0, len(prompt) + 1))


class _Processor:
    chat_template = "template"

    def __init__(self):
        self.tokenizer = _Tokenizer()


class _Cache:
    def __init__(self):
        self.offset = 0

    def trim(self, tokens):
        self.offset -= min(self.offset, tokens)


def _backend():
    backend = MlxVlmBackend()
    backend.model = SimpleNamespace(
        language_model=object(),
        config=SimpleNamespace(model_type="test"),
    )
    backend.processor = _Processor()
    return backend


def test_stream_generate_passes_text_cache_to_mlx_vlm(monkeypatch):
    backend = _backend()
    prompt_cache = [_Cache()]
    calls = {}

    def fake_stream_generate(*args, **kwargs):
        calls["args"] = args
        calls["kwargs"] = kwargs
        yield SimpleNamespace(text="ok")

    monkeypatch.setattr(vlm_module, "mlx_vlm_stream_generate", fake_stream_generate)

    result = list(
        backend.stream_generate(
            "prompt",
            {"max_tokens": 2},
            prompt_cache=prompt_cache,
        )
    )

    assert result[0].text == "ok"
    assert calls["kwargs"]["prompt_cache"] is prompt_cache
    assert calls["kwargs"]["image"] is None


def test_stream_generate_does_not_pass_cache_with_images(monkeypatch):
    backend = _backend()
    prompt_cache = [_Cache()]
    calls = {}

    def fake_stream_generate(*args, **kwargs):
        calls["kwargs"] = kwargs
        yield SimpleNamespace(text="ok")

    monkeypatch.setattr(vlm_module, "mlx_vlm_stream_generate", fake_stream_generate)
    monkeypatch.setattr(vlm_module, "load_and_resize_images", lambda images, size: images)

    list(
        backend.stream_generate(
            "prompt",
            {"max_tokens": 2},
            images=["image.png"],
            prompt_cache=prompt_cache,
        )
    )

    assert "prompt_cache" not in calls["kwargs"]
    assert calls["kwargs"]["image"] == ["image.png"]


def test_cache_prefill_clone_load_and_generate_with_token_ids(monkeypatch):
    backend = _backend()
    created = []
    calls = []

    def fake_make_prompt_cache(language_model):
        assert language_model is backend.model.language_model
        cache = [_Cache()]
        created.append(cache)
        return cache

    def fake_stream_generate(model, processor, prompt, **kwargs):
        calls.append((prompt, kwargs))
        kwargs["prompt_cache"][0].offset = len(prompt)
        yield SimpleNamespace(text="prefill")

    from mlx_vlm.models import cache as vlm_cache

    monkeypatch.setattr(vlm_cache, "make_prompt_cache", fake_make_prompt_cache)
    monkeypatch.setattr(vlm_module, "mlx_vlm_stream_generate", fake_stream_generate)

    result = backend.cache_prefill("memory-ref", "prompt")

    assert result == {"cache_path": "memory-ref", "token_count": len("prompt")}
    assert calls[0][0] == "prompt"
    assert calls[0][1]["image"] is None
    assert calls[0][1]["prompt_cache"] is created[0]
    assert calls[0][1]["max_tokens"] == 0

    loaded = backend.load_cache_from_file("memory-ref")
    assert loaded is not created[0]
    assert loaded[0] is not created[0][0]
    assert loaded[0].offset == len("prompt")

    # The list prompt is the uncached suffix.  Stub the MLX conversion so the
    # cache-hit path tests only the VLM dispatch arguments, not Metal runtime.
    fake_mlx_core = ModuleType("mlx.core")
    fake_mlx_core.array = lambda value: value
    monkeypatch.setitem(sys.modules, "mlx.core", fake_mlx_core)

    generated = list(
        backend.stream_generate(
            [101, 102],
            {"max_tokens": 1},
            prompt_cache=loaded,
        )
    )

    assert generated[0].text == "prefill"
    assert calls[1][0] == [101, 102]
    input_ids = calls[1][1]["input_ids"]
    input_ids_value = input_ids.tolist() if hasattr(input_ids, "tolist") else input_ids
    assert input_ids_value == [[101, 102]]
    assert calls[1][1]["prompt_cache"] is loaded
    assert created[0][0].offset == len("prompt")


def test_cache_prefill_rejects_empty_prompt():
    backend = _backend()

    with pytest.raises(ValueError, match="non-empty text prompt"):
        backend.cache_prefill("memory-ref", "")
