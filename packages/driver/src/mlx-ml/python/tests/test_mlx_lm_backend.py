from types import SimpleNamespace

import pytest

pytest.importorskip("mlx_lm")

import backends.mlx_lm as lm_module
from backends.mlx_lm import MlxLmBackend


class _Tokenizer:
    bos_token = "<bos>"


def _backend():
    backend = MlxLmBackend()
    backend.model = object()
    backend.tokenizer = _Tokenizer()
    return backend


def test_stream_generate_builds_sampler_and_logits_processors(monkeypatch):
    backend = _backend()
    calls = {}
    sampler = object()
    logits_processors = [object()]

    def fake_make_sampler(**kwargs):
        calls["sampler"] = kwargs
        return sampler

    def fake_make_logits_processors(**kwargs):
        calls["logits_processors"] = kwargs
        return logits_processors

    def fake_stream_generate(*args, **kwargs):
        calls["generate"] = kwargs
        yield SimpleNamespace(text="ok")

    monkeypatch.setattr(lm_module, "make_sampler", fake_make_sampler)
    monkeypatch.setattr(lm_module, "make_logits_processors", fake_make_logits_processors)
    monkeypatch.setattr(lm_module, "mlx_lm_stream_generate", fake_stream_generate)

    result = list(
        backend.stream_generate(
            "prompt",
            {
                "max_tokens": 3,
                "temperature": 0.7,
                "top_p": 0.9,
                "top_k": 20,
                "min_p": 0.05,
                "repetition_penalty": 1.1,
                "repetition_context_size": 30,
                "presence_penalty": 1.5,
                "presence_context_size": 40,
            },
        )
    )

    assert result[0].text == "ok"
    assert calls["sampler"] == {
        "temp": 0.7,
        "top_p": 0.9,
        "min_p": 0.05,
        "top_k": 20,
    }
    assert calls["logits_processors"] == {
        "repetition_penalty": 1.1,
        "presence_penalty": 1.5,
        "repetition_context_size": 30,
        "presence_context_size": 40,
    }
    assert calls["generate"]["sampler"] is sampler
    assert calls["generate"]["logits_processors"] is logits_processors
    assert calls["generate"]["max_tokens"] == 3
    for key in (
        "temperature",
        "top_p",
        "top_k",
        "min_p",
        "repetition_penalty",
        "repetition_context_size",
        "presence_penalty",
        "presence_context_size",
    ):
        assert key not in calls["generate"]


def test_stream_generate_leaves_context_defaults_to_upstream(monkeypatch):
    backend = _backend()
    calls = {}

    monkeypatch.setattr(
        lm_module,
        "make_sampler",
        lambda **kwargs: calls.setdefault("sampler", kwargs),
    )
    monkeypatch.setattr(
        lm_module,
        "make_logits_processors",
        lambda **kwargs: calls.setdefault("logits_processors", kwargs),
    )
    monkeypatch.setattr(
        lm_module,
        "mlx_lm_stream_generate",
        lambda *args, **kwargs: iter([SimpleNamespace(text="ok")]),
    )

    list(
        backend.stream_generate(
            "prompt",
            {"presence_penalty": 1.5},
        )
    )

    assert calls["logits_processors"] == {
        "repetition_penalty": None,
        "presence_penalty": 1.5,
    }
