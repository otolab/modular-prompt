from types import SimpleNamespace

import pytest

from utils.transformers_errors import (
    MIN_TRANSFORMERS_VERSION,
    extract_unsupported_model_type,
    unsupported_model_type_error,
)


def test_extracts_model_type_from_transformers_value_error():
    error = ValueError(
        "The checkpoint has model type `qwen3_5` but Transformers does not "
        "recognize this architecture."
    )

    assert extract_unsupported_model_type(error) == "qwen3_5"


def test_extracts_model_type_from_older_registry_key_error():
    assert extract_unsupported_model_type(KeyError("qwen3_5")) == "qwen3_5"


def test_leaves_unrelated_errors_unchanged():
    assert extract_unsupported_model_type(ValueError("invalid weights")) is None
    assert extract_unsupported_model_type(KeyError("model_type")) is None


def test_error_includes_runtime_requirement_and_setup_guidance():
    error = unsupported_model_type_error("Qwen/Qwen3.5-0.8B", "qwen3_5", "4.57.6")
    message = str(error)

    assert "qwen3_5" in message
    assert "transformers 4.57.6" in message
    assert f"transformers>={MIN_TRANSFORMERS_VERSION}" in message
    assert "setup-pytorch" in message
    assert "modular-prompt-runtime sync pytorch" in message


def test_backend_wraps_unknown_architecture_error(monkeypatch):
    pytest.importorskip("torch")
    import backends.transformers_lm as backend_module

    tokenizer = SimpleNamespace(pad_token=None, eos_token="<eos>")
    backend = backend_module.TransformersLmBackend(device="cpu")

    def load_tokenizer(*args, **kwargs):
        return tokenizer

    def load_model(*args, **kwargs):
        raise ValueError(
            "The checkpoint has model type `qwen3_5` but Transformers does not "
            "recognize this architecture."
        )

    monkeypatch.setattr(backend_module.AutoTokenizer, "from_pretrained", load_tokenizer)
    monkeypatch.setattr(
        backend_module.AutoModelForCausalLM,
        "from_pretrained",
        load_model,
    )

    with pytest.raises(RuntimeError, match="qwen3_5") as raised:
        backend.load("Qwen/Qwen3.5-0.8B")

    assert f"transformers {backend_module.transformers.__version__}" in str(raised.value)
    assert "transformers>=5.14.0" in str(raised.value)
