from types import SimpleNamespace

from handlers.generate import handle_generate


class _Cache:
    offset = 2


class _Backend:
    model_kind = "vlm"

    def __init__(self):
        self.calls = []
        self.cache = [_Cache()]

    def load_cache_from_file(self, cache_path):
        self.calls.append(("load", cache_path))
        return self.cache

    def get_cache_offset(self, prompt_cache):
        return prompt_cache[0].offset

    def tokenize_prompt(self, prompt):
        return [10, 11, 12, 13]

    def stream_generate(self, prompt, options, images=None, prompt_cache=None):
        self.calls.append(("generate", prompt, images, prompt_cache))
        yield SimpleNamespace(text="ok", prompt_tokens=2, generation_tokens=1)


def test_text_only_vlm_generate_loads_cache_without_sidecar(capsys):
    backend = _Backend()

    handle_generate(backend, "rendered prompt", cache_path="memory-ref")

    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == [12, 13]
    assert generate_call[2] is None
    assert generate_call[3] is backend.cache
    assert "ok" in capsys.readouterr().out


def test_vlm_generate_reports_cache_load_failure(capsys):
    backend = _Backend()
    backend.cache = None

    handle_generate(backend, "rendered prompt", cache_path="memory-ref")

    output = capsys.readouterr().out
    assert '"cache_loaded": false' in output
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == "rendered prompt"
    assert generate_call[3] is None


def test_vlm_generate_keeps_images_on_cold_path():
    backend = _Backend()

    handle_generate(backend, "rendered prompt", images=["image.png"], cache_path="memory-ref")

    assert not any(call[0] == "load" for call in backend.calls)
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == "rendered prompt"
    assert generate_call[2] == ["image.png"]
    assert generate_call[3] is None
