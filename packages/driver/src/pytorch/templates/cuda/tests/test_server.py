import pytest

pytest.importorskip("torch")

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


class _Tokenizer:
    bos_token = "<bos>"
    chat_template = "template"

    def apply_chat_template(self, messages, **kwargs):
        del messages, kwargs
        return "prefix"


class _Backend:
    model_kind = "lm"

    def __init__(self):
        self.tokenizer = _Tokenizer()
        self.cache = None
        self.generate_prompt = None
        self.pending_cache_write_tokens = 0

    def get_tokenizer(self):
        return self.tokenizer

    def cache_prefill(self, cache_path, prompt, **kwargs):
        del prompt, kwargs
        self.cache = object()
        self.pending_cache_write_tokens = 2
        return {
            "cache_path": cache_path,
            "token_count": 2,
            "cache_write_tokens": 2,
        }

    def load_cache_from_file(self, cache_path, **kwargs):
        del kwargs
        return self.cache if cache_path == "memory://prefix" else None

    def get_cache_offset(self, prompt_cache):
        return 2 if prompt_cache is self.cache else 0

    def consume_cache_write_tokens(self, cache_path):
        del cache_path
        result = self.pending_cache_write_tokens
        self.pending_cache_write_tokens = 0
        return result

    def tokenize_prompt(self, prompt):
        assert prompt == "prefix suffix"
        return [1, 2, 3]

    def stream_generate(self, prompt, options, images=None, prompt_cache=None):
        del options, images
        self.generate_prompt = prompt
        assert prompt_cache is self.cache
        yield SimpleNamespace(
            text="ok",
            prompt_tokens=3,
            generation_tokens=1,
            cache_read_tokens=2,
        )


def _make_server():
    from server import Server

    backend = MagicMock()
    return Server(backend, {"methods": ["capabilities"], "model_kind": "lm"})


def test_cache_prefill_dispatches_to_handler(capsys):
    server = _make_server()

    with patch("server.handle_cache_prefill") as mock_prefill:
        server._dispatch(
            {
                "method": "cache_prefill",
                "cache_path": "memory://prefix",
                "messages": [{"role": "user", "content": "hello"}],
            }
        )

    mock_prefill.assert_called_once()
    assert mock_prefill.call_args.args[2:] == (
        "memory://prefix",
        [{"role": "user", "content": "hello"}],
    )
    assert capsys.readouterr().out == ""


def test_cache_prefill_requires_path_and_messages(capsys):
    server = _make_server()

    server._dispatch({"method": "cache_prefill"})

    assert capsys.readouterr().out.endswith("\0")


def test_cache_prefill_then_generate_with_cache_via_server(capsys):
    from server import Server

    backend = _Backend()
    server = Server(backend, {"methods": ["cache_prefill"], "model_kind": "lm"})

    server._dispatch(
        {
            "method": "cache_prefill",
            "cache_path": "memory://prefix",
            "messages": [{"role": "user", "content": "hello"}],
        }
    )
    prefill_output = capsys.readouterr().out
    assert json.loads(prefill_output.split("\0", 1)[0]) == {
        "cache_path": "memory://prefix",
        "token_count": 2,
        "cache_write_tokens": 2,
    }

    server._dispatch(
        {
            "method": "generate",
            "prompt": "prefix suffix",
            "options": {"max_tokens": 1},
            "cache_path": "memory://prefix",
        }
    )
    generate_output = capsys.readouterr().out
    assert generate_output.startswith("ok")
    meta = json.loads(
        generate_output.split("\x1e__META__:", 1)[1].split("\0", 1)[0]
    )
    assert meta == {
        "prompt_tokens": 3,
        "generation_tokens": 1,
        "cache_read_tokens": 2,
        "cache_write_tokens": 2,
        "cache_loaded": True,
    }
    assert backend.generate_prompt == [3]
