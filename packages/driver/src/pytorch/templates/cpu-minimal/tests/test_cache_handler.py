import json
from types import SimpleNamespace

from handlers.cache import handle_cache_prefill
from handlers.generate import handle_generate


class _Tokenizer:
    bos_token = "<bos>"
    chat_template = "template"

    def __init__(self):
        self.calls = []

    def apply_chat_template(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        return "prefix"


class _Cache:
    pass


class _Backend:
    model_kind = "lm"

    def __init__(self, cache=None):
        self.tokenizer = _Tokenizer()
        self.cache = cache
        self.calls = []

    def get_tokenizer(self):
        return self.tokenizer

    def cache_prefill(self, cache_path, prompt, **kwargs):
        self.calls.append(("prefill", cache_path, prompt, kwargs))
        return {"cache_path": cache_path, "token_count": 2}

    def load_cache_from_file(self, cache_path, **kwargs):
        self.calls.append(("load", cache_path, kwargs))
        return self.cache

    def get_cache_offset(self, prompt_cache):
        return 2 if prompt_cache is self.cache else 0

    def tokenize_prompt(self, prompt):
        assert prompt == "prefix suffix"
        return [1, 2, 3]

    def stream_generate(self, prompt, options, images=None, prompt_cache=None):
        self.calls.append(("generate", prompt, options, images, prompt_cache))
        yield SimpleNamespace(
            text="ok",
            prompt_tokens=3,
            generation_tokens=1,
            cache_read_tokens=2 if self.cache is not None and prompt_cache is self.cache else None,
        )


def _json_response(output):
    return json.loads(output.split("\0", 1)[0])


def test_cache_prefill_renders_without_generation_prompt(capsys):
    backend = _Backend()

    handle_cache_prefill(
        backend,
        {"special_tokens": {}},
        "memory://prefix",
        [{"role": "user", "content": "hello"}],
    )

    assert _json_response(capsys.readouterr().out) == {
        "cache_path": "memory://prefix",
        "token_count": 2,
    }
    assert backend.calls == [
        ("prefill", "memory://prefix", "prefix", {
            "base_cache_path": None,
            "trim_to_tokens": None,
            "prefix_offsets": None,
            "prefix_hashes": None,
            "images": None,
            "max_image_size": 768,
        })
    ]
    assert backend.tokenizer.calls[0][1]["add_generation_prompt"] is False


def test_generate_loads_cache_and_only_generates_suffix(capsys):
    cache = _Cache()
    backend = _Backend(cache)

    handle_generate(
        backend,
        "prefix suffix",
        options={"max_tokens": 1},
        cache_path="memory://prefix",
    )

    output = capsys.readouterr().out
    assert output.startswith("ok")
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta == {
        "prompt_tokens": 3,
        "generation_tokens": 1,
        "cache_read_tokens": 2,
        "cache_loaded": True,
    }
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == [3]
    assert generate_call[4] is cache
    load_call = next(call for call in backend.calls if call[0] == "load")
    assert load_call[2]["prompt"] == "prefix suffix"
    assert load_call[2]["images"] is None
    assert load_call[2]["max_image_size"] == 768


def test_generate_uses_cold_path_for_missing_cache(capsys):
    backend = _Backend(cache=None)

    handle_generate(
        backend,
        "prefix suffix",
        cache_path="memory://missing",
    )

    output = capsys.readouterr().out
    meta = json.loads(output.split("\x1e__META__:", 1)[1].split("\0", 1)[0])
    assert meta["cache_loaded"] is False
    assert "cache_read_tokens" not in meta
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == "prefix suffix"
    assert generate_call[4] is None


def test_generate_removes_cached_prefix_from_token_ids(capsys):
    cache = _Cache()
    backend = _Backend(cache)

    handle_generate(
        backend,
        [1, 2, 3],
        cache_path="memory://prefix",
    )

    output = capsys.readouterr().out
    assert '"cache_loaded": true' in output
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == [3]
