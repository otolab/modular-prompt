import sys
from copy import deepcopy
import hashlib
import json
from pathlib import Path
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


def test_stream_generate_passes_prompt_and_vision_caches_with_images(monkeypatch):
    backend = _backend()
    prompt_cache = [_Cache()]
    calls = {}

    class _VisionCache:
        pass

    def fake_stream_generate(*args, **kwargs):
        calls["kwargs"] = kwargs
        yield SimpleNamespace(text="ok")

    monkeypatch.setattr(vlm_module, "mlx_vlm_stream_generate", fake_stream_generate)
    monkeypatch.setattr(vlm_module, "load_and_resize_images", lambda images, size: images)
    monkeypatch.setattr(vlm_module, "VisionFeatureCache", _VisionCache)
    monkeypatch.setattr(
        vlm_module,
        "mlx_vlm_prepare_inputs",
        lambda processor, **kwargs: {"input_ids": [[1, 2, 3, 4]]},
    )
    monkeypatch.setattr(vlm_module, "mlx_vlm_should_add_special_tokens", lambda *_: False)

    list(
        backend.stream_generate(
            "prompt",
            {"max_tokens": 2},
            images=["image.png"],
            prompt_cache=prompt_cache,
        )
    )

    assert calls["kwargs"]["prompt_cache"] is prompt_cache
    assert isinstance(calls["kwargs"]["vision_cache"], _VisionCache)
    assert calls["kwargs"]["image"] == ["image.png"]


def test_cache_prefill_save_load_and_generate_with_token_ids(monkeypatch, tmp_path):
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
    from mlx_vlm import apc as vlm_apc

    class _DiskBlockStore:
        SUFFIX = ".safetensors"
        EXACT_PREFIX = "exact_"
        saved = {}

        def __init__(self, root, namespace="default", num_workers=1):
            self.dir = Path(root) / namespace
            self.dir.mkdir(parents=True, exist_ok=True)

        def save_exact_cache(self, cache_hash, token_ids, extra_hash, prompt_cache):
            raw_hash = int(cache_hash & ((1 << 64) - 1)).to_bytes(8, "little")
            exact_id = hashlib.sha256(raw_hash).hexdigest()[:32]
            path = self.dir / f"exact_{exact_id}.safetensors"
            self.saved[(str(self.dir), int(cache_hash))] = (
                tuple(token_ids),
                int(extra_hash),
                deepcopy(prompt_cache),
            )
            path.touch()

        def load_exact_cache(self, cache_hash, **kwargs):
            return self.saved.get((str(self.dir), int(cache_hash)))

        def close(self):
            pass

    monkeypatch.setattr(vlm_cache, "make_prompt_cache", fake_make_prompt_cache)
    monkeypatch.setattr(vlm_module, "mlx_vlm_stream_generate", fake_stream_generate)
    monkeypatch.setattr(vlm_apc, "DiskBlockStore", _DiskBlockStore)

    logical_path = str(tmp_path / "cache.vlm.safetensors")
    result = backend.cache_prefill(
        logical_path,
        "prompt",
        prefix_offsets=[len("prompt")],
        prefix_hashes=["prompt-hash"],
    )

    actual_path = Path(result["cache_path"])
    assert actual_path.parent == Path(logical_path)
    assert actual_path.name.startswith("exact_")
    assert result["token_count"] == len("prompt")
    assert actual_path.is_file()
    meta = json.loads(Path(str(actual_path) + ".meta.json").read_text())
    assert meta["layout"] == "exact_cache_v1"
    assert meta["token_count"] == len("prompt")
    assert meta["prefix_offsets"] == [len("prompt")]
    assert meta["prefix_hashes"] == ["prompt-hash"]
    assert calls[0][0] == "prompt"
    assert calls[0][1]["image"] is None
    assert calls[0][1]["prompt_cache"] is created[0]
    assert calls[0][1]["max_tokens"] == 0

    loaded = backend.load_cache_from_file(str(actual_path))
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


def test_image_cache_prefill_persists_extra_hash_and_rejects_another_image(monkeypatch, tmp_path):
    backend = _backend()
    image_a = SimpleNamespace(mode="RGB", size=(2, 2), tobytes=lambda: b"image-a")
    image_b = SimpleNamespace(mode="RGB", size=(2, 2), tobytes=lambda: b"image-b")
    image_map = {"image-a.png": image_a, "image-b.png": image_b}
    monkeypatch.setattr(
        vlm_module,
        "load_and_resize_images",
        lambda paths, size: [image_map[path] for path in paths],
    )
    monkeypatch.setattr(
        vlm_module,
        "mlx_vlm_prepare_inputs",
        lambda processor, **kwargs: {"input_ids": [[1, 2, 3, 4]]},
    )
    monkeypatch.setattr(vlm_module, "mlx_vlm_should_add_special_tokens", lambda *_: False)

    class _VisionCache:
        pass

    monkeypatch.setattr(vlm_module, "VisionFeatureCache", _VisionCache)
    calls = []

    def fake_stream_generate(model, processor, prompt, **kwargs):
        calls.append((prompt, kwargs))
        kwargs["prompt_cache"][0].offset = len(prompt)
        yield SimpleNamespace(text="prefill")

    from mlx_vlm.models import cache as vlm_cache
    from mlx_vlm import apc as vlm_apc

    class _DiskBlockStore:
        SUFFIX = ".safetensors"
        EXACT_PREFIX = "exact_"

        def __init__(self, root, namespace="default", num_workers=1):
            self.dir = Path(root) / namespace
            self.dir.mkdir(parents=True, exist_ok=True)

        def save_exact_cache(self, cache_hash, token_ids, extra_hash, prompt_cache):
            raw_hash = int(cache_hash & ((1 << 64) - 1)).to_bytes(8, "little")
            exact_id = hashlib.sha256(raw_hash).hexdigest()[:32]
            path = self.dir / f"exact_{exact_id}.safetensors"
            type(self).saved = (tuple(token_ids), int(extra_hash), deepcopy(prompt_cache))
            path.touch()

        def load_exact_cache(self, cache_hash, **kwargs):
            return type(self).saved

        def close(self):
            pass

    monkeypatch.setattr(vlm_cache, "make_prompt_cache", lambda model: [_Cache()])
    monkeypatch.setattr(vlm_module, "mlx_vlm_stream_generate", fake_stream_generate)
    monkeypatch.setattr(vlm_apc, "DiskBlockStore", _DiskBlockStore)

    logical_path = str(tmp_path / "cache.vlm-vision.safetensors")
    result = backend.cache_prefill(
        logical_path,
        "prompt",
        images=["image-a.png"],
        max_image_size=512,
    )

    actual_path = Path(result["cache_path"])
    meta = json.loads(Path(str(actual_path) + ".meta.json").read_text())
    assert meta["layout"] == "vision_cache_v1"
    assert result["token_count"] == 4
    assert meta["extra_hash"] != 0
    assert meta["image_count"] == 1
    assert meta["image_refs"] == ["image-a.png"]
    assert meta["max_image_size"] == 512
    assert calls[0][1]["image"] == [image_a]
    assert isinstance(calls[0][1]["vision_cache"], _VisionCache)

    assert backend.load_cache_from_file(
        str(actual_path), images=["image-a.png"], max_image_size=512
    ) is not None
    monkeypatch.setattr(
        vlm_module,
        "mlx_vlm_prepare_inputs",
        lambda processor, **kwargs: {"input_ids": [[9, 8, 7, 6]]},
    )
    assert backend.load_cache_from_file(
        str(actual_path),
        images=["image-a.png"],
        max_image_size=512,
        prompt="prompt",
    ) is None
    assert backend.load_cache_from_file(
        str(actual_path), images=["image-b.png"], max_image_size=512
    ) is None


def test_load_cache_rejects_sidecar_hash_for_another_snapshot(monkeypatch, tmp_path):
    backend = _backend()
    from mlx_vlm import apc as vlm_apc

    class _DiskBlockStore:
        SUFFIX = ".safetensors"
        EXACT_PREFIX = "exact_"

        def __init__(self, root, namespace="default", num_workers=1):
            self.dir = Path(root) / namespace

        def load_exact_cache(self, cache_hash, **kwargs):
            raise AssertionError("a mismatched sidecar must not load any snapshot")

        def close(self):
            pass

    monkeypatch.setattr(vlm_apc, "DiskBlockStore", _DiskBlockStore)

    namespace = tmp_path / "cache.vlm.safetensors"
    namespace.mkdir()
    requested_hash = vlm_module._vlm_cache_hash(str(namespace / "logical-ref"))
    other_hash = requested_hash + 1
    requested_path = namespace / vlm_module._vlm_exact_cache_filename(requested_hash)
    requested_path.touch()
    requested_path.with_name(requested_path.name + ".meta.json").write_text(
        json.dumps({
            "layout": "exact_cache_v1",
            "cache_hash": other_hash,
            "token_count": 1,
        })
    )

    assert backend.load_cache_from_file(str(requested_path)) is None


def test_load_cache_rejects_missing_snapshot(monkeypatch, tmp_path):
    backend = _backend()
    from mlx_vlm import apc as vlm_apc

    class _DiskBlockStore:
        SUFFIX = ".safetensors"
        EXACT_PREFIX = "exact_"

        def __init__(self, root, namespace="default", num_workers=1):
            self.dir = Path(root) / namespace

        def load_exact_cache(self, cache_hash, **kwargs):
            raise AssertionError("a missing snapshot must be rejected before load")

        def close(self):
            pass

    monkeypatch.setattr(vlm_apc, "DiskBlockStore", _DiskBlockStore)

    namespace = tmp_path / "cache.vlm.safetensors"
    namespace.mkdir()
    cache_hash = vlm_module._vlm_cache_hash(str(namespace / "logical-ref"))
    requested_path = namespace / vlm_module._vlm_exact_cache_filename(cache_hash)
    requested_path.with_name(requested_path.name + ".meta.json").write_text(
        json.dumps({
            "layout": "exact_cache_v1",
            "cache_hash": cache_hash,
            "token_count": 1,
        })
    )

    assert backend.load_cache_from_file(str(requested_path)) is None


def test_load_cache_rejects_corrupt_snapshot(monkeypatch, tmp_path):
    backend = _backend()
    from mlx_vlm import apc as vlm_apc

    class _DiskBlockStore:
        SUFFIX = ".safetensors"
        EXACT_PREFIX = "exact_"

        def __init__(self, root, namespace="default", num_workers=1):
            self.dir = Path(root) / namespace

        def load_exact_cache(self, cache_hash, **kwargs):
            raise ValueError("corrupt safetensors")

        def close(self):
            pass

    monkeypatch.setattr(vlm_apc, "DiskBlockStore", _DiskBlockStore)

    namespace = tmp_path / "cache.vlm.safetensors"
    namespace.mkdir()
    cache_hash = vlm_module._vlm_cache_hash(str(namespace / "logical-ref"))
    requested_path = namespace / vlm_module._vlm_exact_cache_filename(cache_hash)
    requested_path.write_bytes(b"corrupt")
    requested_path.with_name(requested_path.name + ".meta.json").write_text(
        json.dumps({
            "layout": "exact_cache_v1",
            "cache_hash": cache_hash,
            "token_count": 1,
        })
    )

    assert backend.load_cache_from_file(str(requested_path)) is None
