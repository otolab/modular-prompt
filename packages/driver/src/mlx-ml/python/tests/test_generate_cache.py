from types import SimpleNamespace

import pytest

from handlers.generate import handle_generate


class _Cache:
    offset = 2


class _Backend:
    model_kind = "vlm"

    def __init__(self):
        self.calls = []
        self.cache = [_Cache()]

    def load_cache_from_file(self, cache_path, images=None, max_image_size=768, prompt=None):
        self.calls.append(("load", cache_path, images, max_image_size, prompt))
        return self.cache

    def get_cache_offset(self, prompt_cache):
        return prompt_cache[0].offset

    def tokenize_prompt(self, prompt, images=None, max_image_size=768):
        return [10, 11, 12, 13]

    def stream_generate(self, prompt, options, images=None, prompt_cache=None):
        self.calls.append(("generate", prompt, images, prompt_cache))
        yield SimpleNamespace(text="ok", prompt_tokens=2, generation_tokens=1)


def test_text_only_vlm_generate_loads_cache_from_sidecar(capsys, tmp_path):
    backend = _Backend()
    cache_path = tmp_path / "exact_cache.safetensors"
    cache_path.with_name(cache_path.name + ".meta.json").write_text(
        '{"layout":"exact_cache_v1","token_count":2}'
    )

    handle_generate(backend, "rendered prompt", cache_path=str(cache_path))

    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == [12, 13]
    assert generate_call[2] is None
    assert generate_call[3] is backend.cache
    assert "ok" in capsys.readouterr().out


def test_vlm_generate_reports_cache_load_failure(capsys):
    backend = _Backend()
    backend.cache = None

    handle_generate(
        backend,
        "rendered prompt",
        cache_path="mlx-vlm-memory://missing-ref",
    )

    output = capsys.readouterr().out
    assert '"cache_loaded": false' in output
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == "rendered prompt"
    assert generate_call[3] is None


@pytest.mark.parametrize("snapshot_state", ["missing", "corrupt"])
def test_vlm_file_cache_load_failure_uses_cold_path(capsys, tmp_path, snapshot_state):
    backend = _Backend()
    backend.cache = None
    cache_path = tmp_path / "exact_snapshot.safetensors"
    if snapshot_state == "corrupt":
        cache_path.write_bytes(b"corrupt")
    cache_path.with_name(cache_path.name + ".meta.json").write_text(
        '{"layout":"exact_cache_v1","cache_hash":1,"token_count":2}'
    )

    handle_generate(backend, "rendered prompt", cache_path=str(cache_path))

    output = capsys.readouterr().out
    assert '"cache_loaded": false' in output
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == "rendered prompt"
    assert generate_call[3] is None


def test_vlm_generate_loads_image_cache_with_image_identity():
    backend = _Backend()

    handle_generate(
        backend,
        "rendered prompt",
        images=["image.png"],
        cache_path="mlx-vlm-memory://memory-ref",
    )

    load_call = next(call for call in backend.calls if call[0] == "load")
    assert load_call[1] == "mlx-vlm-memory://memory-ref"
    assert load_call[2] == ["image.png"]
    assert load_call[3] == 768
    assert load_call[4] == "rendered prompt"
    generate_call = next(call for call in backend.calls if call[0] == "generate")
    assert generate_call[1] == [12, 13]
    assert generate_call[2] == ["image.png"]
    assert generate_call[3] is backend.cache
