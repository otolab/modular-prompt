from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any, Iterator

from mlx_vlm import load as mlx_vlm_load
from mlx_vlm import stream_generate as mlx_vlm_stream_generate

try:
    from mlx_vlm.utils import prepare_inputs as mlx_vlm_prepare_inputs
    from mlx_vlm.utils import should_add_special_tokens as mlx_vlm_should_add_special_tokens
except ImportError:  # pragma: no cover - only older mlx-vlm installations
    mlx_vlm_prepare_inputs = None
    mlx_vlm_should_add_special_tokens = None

try:
    from mlx_vlm import VisionFeatureCache
except ImportError:  # pragma: no cover - only older mlx-vlm installations
    VisionFeatureCache = None

from backends.base import ModelBackend
from utils.vlm_utils import load_and_resize_images


VLM_EXACT_CACHE_LAYOUT = "exact_cache_v1"
VLM_IMAGE_CACHE_LAYOUT = "vision_cache_v1"
VLM_VISION_FEATURE_CACHE_VERSION = "mlx-vlm-0.7.0"


def _vlm_cache_hash(cache_path: str) -> int:
    """Derive a stable APC exact-cache key from the logical cache path.

    The TypeScript controller owns the logical path.  The key is persisted in
    the sidecar because mlx-vlm's DiskBlockStore names the actual safetensors
    file from this value and the returned file path is different from the
    logical path.
    """
    digest = hashlib.sha256(cache_path.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "little", signed=True)


def _new_vlm_disk_store(cache_path: str, *, logical_path: bool) -> Any:
    """Open the mlx-vlm 0.7.0 DiskBlockStore for a VLM cache.

    A logical cache path is used as the store namespace.  Once the APC writer
    has produced ``exact_*.safetensors``, the returned path is inside that
    namespace and can be used to reconstruct the same store after restart.
    """
    from mlx_vlm.apc import DiskBlockStore

    path = Path(cache_path)
    if logical_path:
        root = path.parent
        namespace = path.name
    else:
        namespace_dir = path.parent
        root = namespace_dir.parent
        namespace = namespace_dir.name
    return DiskBlockStore(root, namespace=namespace, num_workers=1)


def _vlm_exact_cache_path(store: Any, cache_hash: int) -> Path:
    """Return the exact snapshot path used by DiskBlockStore 0.7.0.

    ``_exact_id_for`` is intentionally private in mlx-vlm.  Its layout is
    stable in the pinned 0.7.0 API: SHA-256 of the unsigned little-endian
    64-bit cache hash, truncated to 32 hex characters.
    """
    unsigned_hash = int(cache_hash & ((1 << 64) - 1)).to_bytes(8, "little")
    exact_id = hashlib.sha256(unsigned_hash).hexdigest()[:32]
    return store.dir / f"{store.EXACT_PREFIX}{exact_id}{store.SUFFIX}"


def _vlm_exact_cache_filename(cache_hash: int) -> str:
    """Return the pinned 0.7.0 exact snapshot filename for ``cache_hash``."""
    unsigned_hash = int(cache_hash & ((1 << 64) - 1)).to_bytes(8, "little")
    exact_id = hashlib.sha256(unsigned_hash).hexdigest()[:32]
    return f"exact_{exact_id}.safetensors"


def _read_vlm_cache_meta(cache_path: str) -> dict[str, Any] | None:
    try:
        with open(cache_path + ".meta.json") as f:
            meta = json.load(f)
        if not isinstance(meta, dict) or meta.get("layout") not in {
            VLM_EXACT_CACHE_LAYOUT,
            VLM_IMAGE_CACHE_LAYOUT,
        }:
            return None
        if meta.get("cache_hash") is None or meta.get("token_count") is None:
            return None
        cache_hash = int(meta["cache_hash"])
        if Path(cache_path).name != _vlm_exact_cache_filename(cache_hash):
            return None
        return {
            **meta,
            "cache_hash": cache_hash,
            "token_count": int(meta["token_count"]),
        }
    except (FileNotFoundError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _write_vlm_cache_meta(
    cache_path: str,
    token_count: int,
    cache_hash: int,
    prefix_offsets: list[int] | None = None,
    prefix_hashes: list[str] | None = None,
    *,
    layout: str = VLM_EXACT_CACHE_LAYOUT,
    extra_hash: int = 0,
    images: list[str] | None = None,
    max_image_size: int = 768,
) -> None:
    meta: dict[str, Any] = {
        "backend": "mlx-vlm",
        "layout": layout,
        "cache_hash": int(cache_hash),
        "token_count": int(token_count),
    }
    if layout == VLM_IMAGE_CACHE_LAYOUT:
        meta.update({
            "extra_hash": int(extra_hash),
            "image_hash": f"{extra_hash & ((1 << 64) - 1):016x}",
            "image_count": len(images or []),
            "image_refs": list(images or []),
            "max_image_size": int(max_image_size),
            "vision_feature_cache_version": VLM_VISION_FEATURE_CACHE_VERSION,
        })
    if prefix_offsets is not None and prefix_hashes is not None:
        meta["prefix_offsets"] = prefix_offsets
        meta["prefix_hashes"] = prefix_hashes
    with open(cache_path + ".meta.json", "w") as f:
        json.dump(meta, f)


def _image_extra_hash(images: list[Any]) -> int:
    """Hash the normalized image payload used by the VLM cache.

    mlx-vlm's APC uses an image payload hash as the ``extra_hash`` component
    of an exact cache key.  The backend does not expose its internal pixel
    tensor before dispatch, so this fallback hashes the exact PIL payload
    produced by ``load_and_resize_images`` (mode, shape, and bytes).  It is
    deterministic across processes and keeps same-token/different-image
    snapshots disjoint.
    """
    digest = hashlib.sha256()
    digest.update(b"modular-prompt:vision-cache-v1\0")
    digest.update(len(images).to_bytes(4, "little", signed=False))
    for image in images:
        mode = str(getattr(image, "mode", "")).encode("utf-8")
        width, height = getattr(image, "size", (0, 0))
        tobytes = getattr(image, "tobytes", None)
        raw = tobytes() if callable(tobytes) else str(image).encode("utf-8")
        digest.update(len(mode).to_bytes(4, "little", signed=False))
        digest.update(mode)
        digest.update(int(width).to_bytes(8, "little", signed=False))
        digest.update(int(height).to_bytes(8, "little", signed=False))
        digest.update(len(raw).to_bytes(8, "little", signed=False))
        digest.update(raw)
    return int.from_bytes(digest.digest()[:8], "little", signed=True)


class MlxVlmBackend(ModelBackend):
    """`mlx_vlm` backend for vision-language models."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self.processor: Any | None = None
        self.drafter: Any | None = None
        self.drafter_kind: str | None = None
        self.draft_block_size: int | None = None
        # ``mlx-vlm-memory://`` remains a compatibility fallback for callers
        # that provide an explicit Phase 1 ref.  The controller's normal path
        # is a DiskBlockStore-backed VLM exact snapshot.
        self._prompt_caches: dict[str, list[Any]] = {}
        self._prompt_cache_meta: dict[str, dict[str, Any]] = {}
        # Projected image features are intentionally process-local.  The
        # persisted VLM cache stores prompt/KV state plus a sidecar identity;
        # opaque feature tensors are never mixed with the text-only store.
        self._vision_caches: dict[int, Any] = {}

    def _get_vision_cache(self, max_image_size: int) -> Any | None:
        if VisionFeatureCache is None:
            return None
        cache = self._vision_caches.get(int(max_image_size))
        if cache is None:
            cache = VisionFeatureCache()
            self._vision_caches[int(max_image_size)] = cache
        return cache

    def load(self, model_name: str) -> None:
        self._vision_caches.clear()
        self.model, self.processor = mlx_vlm_load(model_name)

    def load_drafter(self, drafter_model: str) -> None:
        from mlx_vlm.speculative.drafters import load_drafter
        self.drafter, self.drafter_kind = load_drafter(drafter_model)
        sys.stderr.write(f"Drafter loaded: {drafter_model} (kind={self.drafter_kind})\n")

    def has_drafter(self) -> bool:
        return self.drafter is not None

    def get_tokenizer(self) -> Any:
        return self.processor

    def _text_tokenizer(self) -> Any:
        if self.processor is None:
            raise RuntimeError("Model is not loaded")
        return getattr(self.processor, "tokenizer", self.processor)

    def _tokenize_text_prompt(self, prompt: str) -> list[int]:
        tokenizer = self._text_tokenizer()
        add_special = getattr(tokenizer, "bos_token", None) is None or not prompt.startswith(
            getattr(tokenizer, "bos_token", None) or ""
        )

        # Match mlx-vlm's model-specific chat-template marker handling when
        # available, while keeping the backend testable with plain processors.
        try:
            from mlx_vlm.utils import should_add_special_tokens

            model_type = getattr(getattr(self.model, "config", None), "model_type", "")
            add_special = should_add_special_tokens(model_type, self.processor)
        except (ImportError, AttributeError, TypeError):
            pass

        return list(tokenizer.encode(prompt, add_special_tokens=add_special))

    def _tokenize_image_prompt(
        self,
        prompt: str,
        images: list[str],
        max_image_size: int,
    ) -> list[int]:
        """Match mlx-vlm's image-aware input preparation for cache offsets.

        Dynamic-resolution processors expand one image marker into a model-
        dependent number of image tokens.  Calling the same 0.7.0
        ``prepare_inputs`` helper as ``stream_generate`` keeps the persisted
        token count and the generation suffix boundary aligned.
        """
        if mlx_vlm_prepare_inputs is None or mlx_vlm_should_add_special_tokens is None:
            # Older mlx-vlm versions did not expose the public helper.  The
            # pinned Phase 3 dependency does, but retain the text fallback for
            # compatible installations that cannot build an image cache.
            return self._tokenize_text_prompt(prompt)

        processed_images = load_and_resize_images(images, max_image_size)
        inputs = self._prepare_image_inputs(prompt, processed_images)
        if inputs is None:
            # Older mlx-vlm installations did not expose the public helper.
            # The pinned Phase 3 dependency does, but retain the text fallback
            # for compatible installations that cannot expand image tokens.
            return self._tokenize_text_prompt(prompt)
        return self._input_ids_from_prepared_inputs(inputs)

    def _prepare_image_inputs(
        self,
        prompt: str,
        processed_images: list[Any],
    ) -> dict[str, Any] | None:
        if mlx_vlm_prepare_inputs is None or mlx_vlm_should_add_special_tokens is None:
            return None
        model_type = getattr(getattr(self.model, "config", None), "model_type", "")
        return mlx_vlm_prepare_inputs(
            self.processor,
            images=processed_images,
            prompts=prompt,
            image_token_index=getattr(
                getattr(self.model, "config", None), "image_token_index", None
            ),
            add_special_tokens=mlx_vlm_should_add_special_tokens(
                model_type, self.processor
            ),
        )

    @staticmethod
    def _input_ids_from_prepared_inputs(inputs: dict[str, Any]) -> list[int]:
        input_ids = inputs.get("input_ids")
        if input_ids is None:
            raise ValueError("mlx-vlm image preparation returned no input_ids")
        if hasattr(input_ids, "flatten"):
            input_ids = input_ids.flatten()
        values = input_ids.tolist() if hasattr(input_ids, "tolist") else input_ids
        while values and isinstance(values[0], (list, tuple)):
            values = values[0]
        return [int(value) for value in values]

    def _matches_cached_prefix(
        self,
        prompt: str | list[int] | None,
        token_ids: list[int] | tuple[int, ...],
        images: list[str] | None,
        max_image_size: int,
    ) -> bool:
        """Check that the request starts with the snapshot's token sequence."""
        if prompt is None or not isinstance(prompt, str):
            # A list prompt is already a suffix selected by the shared
            # generate handler, so there is no complete request to compare.
            return True
        try:
            current_tokens = self.tokenize_prompt(
                prompt,
                images=images,
                max_image_size=max_image_size,
            )
            cached = [int(token) for token in token_ids]
            return len(current_tokens) >= len(cached) and current_tokens[: len(cached)] == cached
        except Exception as e:
            sys.stderr.write(f"Failed to validate VLM cache token prefix: {e}\n")
            return False

    def tokenize_prompt(
        self,
        prompt: str,
        images: list[str] | None = None,
        max_image_size: int = 768,
    ) -> list[int]:
        if images:
            return self._tokenize_image_prompt(prompt, images, max_image_size)
        return self._tokenize_text_prompt(prompt)

    def trim_cache(self, prompt_cache: list, tokens: int) -> None:
        super().trim_cache(prompt_cache, tokens)

    @staticmethod
    def _clone_prompt_cache(prompt_cache: list[Any]) -> list[Any]:
        """Detach a cache before generation mutates it.

        mlx-vlm's APC adapters provide a model-cache-aware clone for the cache
        classes shipped in 0.7.0.  The deepcopy fallback keeps this backend
        usable with compatible custom cache objects.
        """
        try:
            from mlx_vlm.apc_adapters import clone_cache_entry
            import mlx.core as mx

            eval_targets: list[Any] = []
            cloned: list[Any] = []
            for entry in prompt_cache:
                copy_entry = clone_cache_entry(
                    entry,
                    min_capacity_tokens=None,
                    eval_targets=eval_targets,
                )
                if copy_entry is None:
                    raise RuntimeError(
                        f"unsupported cache entry: {type(entry).__name__}"
                    )
                cloned.append(copy_entry)
            if eval_targets:
                mx.eval(eval_targets)
            return cloned
        except Exception:
            return deepcopy(prompt_cache)

    def stream_generate(
        self, prompt: str | list[int], options: dict, images: list | None = None,
        prompt_cache: list | None = None,
    ) -> Iterator[Any]:
        if self.model is None or self.processor is None:
            raise RuntimeError("Model is not loaded")

        final_options = dict(options)
        temperature = final_options.pop("temperature", 1.0)
        max_tokens = final_options.pop("max_tokens", 1000)
        top_p = final_options.pop("top_p", 0.0)
        top_k = final_options.pop("top_k", 0)

        processed_images = None
        max_image_size = 768
        if images:
            max_image_size = int(final_options.pop("max_image_size", 768))
            processed_images = load_and_resize_images(images, max_image_size)

        draft_kwargs = {}
        if self.drafter:
            draft_kwargs["draft_model"] = self.drafter
            draft_kwargs["draft_kind"] = self.drafter_kind
            if self.draft_block_size is not None:
                draft_kwargs["draft_block_size"] = self.draft_block_size

        if prompt_cache is not None:
            draft_kwargs["prompt_cache"] = prompt_cache
        if processed_images is not None:
            vision_cache = self._get_vision_cache(max_image_size)
            if vision_cache is not None:
                # mlx-vlm 0.7.0 resolves this cache before model dispatch and
                # supplies cached_image_features to supported VLM models.
                draft_kwargs["vision_cache"] = vision_cache
        if isinstance(prompt, list):
            # mlx-lm accepts token IDs as its prompt argument, while
            # mlx-vlm's public prompt argument is text.  Its dispatch path
            # does accept pre-tokenized ``input_ids``; use that path for the
            # suffix left after a cached prefix.
            import mlx.core as mx

            draft_kwargs["input_ids"] = mx.array([prompt])

        # Generate and collect tokens
        token_count = 0
        for result in mlx_vlm_stream_generate(
            self.model,
            self.processor,
            prompt,
            image=processed_images,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            **draft_kwargs,
        ):
            token_count += 1
            yield result

        # Output speculative decoding stats if drafter was used
        if self.drafter and hasattr(self.drafter, 'accept_lens'):
            accept_lens = self.drafter.accept_lens
            if accept_lens:
                avg_accepted = sum(accept_lens) / len(accept_lens)
                # Show stats unless MLX_NO_STATS environment variable is set
                if not os.getenv('MLX_NO_STATS'):
                    sys.stderr.write(f"\n[Speculative Decoding Stats]\n")
                    sys.stderr.write(f"  Rounds: {len(accept_lens)}\n")
                    sys.stderr.write(f"  Average accepted tokens/round: {avg_accepted:.2f}\n")
                    sys.stderr.write(f"  Total tokens generated: {token_count}\n")
                    sys.stderr.write(f"  Speedup factor: {avg_accepted:.2f}x (theoretical)\n")
                # Clear for next generation
                self.drafter.accept_lens = []

    def cache_prefill(
        self,
        cache_path: str,
        prompt: str,
        base_cache_path: str | None = None,
        trim_to_tokens: int | None = None,
        prefix_offsets: list[int] | None = None,
        prefix_hashes: list[str] | None = None,
        images: list[str] | None = None,
        max_image_size: int = 768,
    ) -> dict:
        """Prefill a VLM cache in the current backend process.

        mlx-vlm owns a cache module separate from mlx-lm.  Its 0.7.0
        ``DiskBlockStore.save_exact_cache`` API stores the whole prompt cache
        as an ``exact_cache_v1`` snapshot.  Image-bearing snapshots use a
        separate ``vision_cache_v1`` sidecar and namespace, and carry the
        image payload in ``extra_hash``.  This is deliberately not the
        ``mlx-lm`` ``.safetensors.zip`` format.
        """
        if self.model is None or self.processor is None:
            raise RuntimeError("Model is not loaded")
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("VLM cache_prefill requires a non-empty text prompt")

        is_memory_ref = cache_path.startswith("mlx-vlm-memory://")
        if base_cache_path is not None or trim_to_tokens is not None:
            sys.stderr.write(
                "VLM cache_prefill ignores base/trim arguments; "
                "VLM incremental prefill is not implemented in Phase 3.\n"
            )

        processed_images = load_and_resize_images(images, max_image_size) if images else None
        prepared_image_inputs = (
            self._prepare_image_inputs(prompt, processed_images)
            if processed_images is not None
            else None
        )
        extra_hash = _image_extra_hash(processed_images) if processed_images is not None else 0
        cache_layout = VLM_IMAGE_CACHE_LAYOUT if processed_images is not None else VLM_EXACT_CACHE_LAYOUT

        from mlx_vlm.models.cache import make_prompt_cache

        language_model = getattr(self.model, "language_model", None)
        if language_model is None:
            raise RuntimeError("VLM model does not expose language_model")

        prompt_cache = make_prompt_cache(language_model)
        full_tokens = (
            self._input_ids_from_prepared_inputs(prepared_image_inputs)
            if prepared_image_inputs is not None
            else self.tokenize_prompt(
                prompt,
                images=images,
                max_image_size=max_image_size,
            )
        )
        token_count = len(full_tokens)
        prefill_options: dict[str, Any] = {"max_tokens": 0}
        if images:
            prefill_options["max_image_size"] = max_image_size
        for _ in self.stream_generate(
            prompt,
            prefill_options,
            images=images,
            prompt_cache=prompt_cache,
        ):
            break

        if is_memory_ref:
            self._prompt_caches[cache_path] = prompt_cache
            self._prompt_cache_meta[cache_path] = {
                "layout": cache_layout,
                "cache_hash": _vlm_cache_hash(cache_path),
                "extra_hash": extra_hash,
                "token_count": token_count,
                "token_ids": full_tokens,
                "image_count": len(images or []),
                "max_image_size": max_image_size,
            }
            if os.getenv("MLX_DEBUG"):
                sys.stderr.write(
                    f"VLM cache created in memory: {cache_path} ({token_count} tokens)\n"
                )
            return {"cache_path": cache_path, "token_count": token_count}

        cache_hash = _vlm_cache_hash(cache_path)
        store = None
        actual_path: Path
        try:
            store = _new_vlm_disk_store(cache_path, logical_path=True)
            actual_path = _vlm_exact_cache_path(store, cache_hash)
            # DiskBlockStore writes asynchronously.  Clone and evaluate on the
            # producer thread before handing the snapshot to its writer, as
            # required by mlx-vlm's APC implementation.
            detached_cache = self._clone_prompt_cache(prompt_cache)
            store.save_exact_cache(cache_hash, full_tokens, extra_hash, detached_cache)
            store.close()
            store = None
            if not actual_path.is_file():
                raise FileNotFoundError(
                    f"mlx-vlm exact cache writer did not create {actual_path}"
                )
            _write_vlm_cache_meta(
                str(actual_path),
                token_count,
                cache_hash,
                prefix_offsets,
                prefix_hashes,
                layout=cache_layout,
                extra_hash=extra_hash,
                images=images,
                max_image_size=max_image_size,
            )
        finally:
            if store is not None:
                store.close()

        if os.getenv("MLX_DEBUG"):
            sys.stderr.write(
                f"VLM cache created on disk: {actual_path} ({token_count} tokens)\n"
            )
        return {"cache_path": str(actual_path), "token_count": token_count}

    def load_cache_from_file(
        self,
        cache_path: str,
        images: list[str] | None = None,
        max_image_size: int = 768,
        prompt: str | list[int] | None = None,
    ) -> list[Any] | None:
        if cache_path.startswith("mlx-vlm-memory://"):
            prompt_cache = self._prompt_caches.get(cache_path)
            if prompt_cache is None:
                sys.stderr.write(
                    f"VLM cache ref not found in this process: {cache_path}\n"
                )
                return None
            meta = self._prompt_cache_meta.get(cache_path)
            if images:
                if not meta or meta.get("layout") != VLM_IMAGE_CACHE_LAYOUT:
                    sys.stderr.write(
                        f"VLM memory cache has no image metadata: {cache_path}\n"
                    )
                    return None
                try:
                    expected_hash = _image_extra_hash(
                        load_and_resize_images(images, max_image_size)
                    )
                    if (
                        int(meta.get("extra_hash")) != expected_hash
                        or int(meta.get("image_count")) != len(images)
                        or int(meta.get("max_image_size")) != int(max_image_size)
                    ):
                        sys.stderr.write(
                            f"VLM memory cache image metadata mismatch: {cache_path}\n"
                        )
                        return None
                except Exception as e:
                    sys.stderr.write(f"Failed to validate VLM memory cache: {e}\n")
                    return None
            elif meta and meta.get("layout") == VLM_IMAGE_CACHE_LAYOUT:
                sys.stderr.write(
                    f"VLM image cache requires image inputs: {cache_path}\n"
                )
                return None
            cached_token_ids = meta.get("token_ids") if meta else None
            if isinstance(cached_token_ids, list) and not self._matches_cached_prefix(
                prompt,
                cached_token_ids,
                images,
                max_image_size,
            ):
                sys.stderr.write(
                    f"VLM memory cache token prefix mismatch: {cache_path}\n"
                )
                return None
            try:
                return self._clone_prompt_cache(prompt_cache)
            except Exception as e:
                sys.stderr.write(f"Failed to clone VLM cache: {e}\n")
                return None

        meta = _read_vlm_cache_meta(cache_path)
        if meta is None:
            sys.stderr.write(f"VLM cache metadata not found or invalid: {cache_path}\n")
            return None

        is_image_cache = meta.get("layout") == VLM_IMAGE_CACHE_LAYOUT
        if bool(images) != is_image_cache:
            sys.stderr.write(
                f"VLM cache image/text layout mismatch: {cache_path}\n"
            )
            return None

        expected_extra_hash = 0
        if is_image_cache:
            try:
                processed_images = load_and_resize_images(images or [], max_image_size)
                expected_extra_hash = _image_extra_hash(processed_images)
                if (
                    int(meta.get("extra_hash")) != expected_extra_hash
                    or int(meta.get("image_count")) != len(images or [])
                    or int(meta.get("max_image_size")) != int(max_image_size)
                    or meta.get("vision_feature_cache_version")
                    != VLM_VISION_FEATURE_CACHE_VERSION
                ):
                    sys.stderr.write(
                        f"VLM image cache metadata mismatch: {cache_path}\n"
                    )
                    return None
            except Exception as e:
                sys.stderr.write(f"Failed to validate VLM image cache: {e}\n")
                return None

        store = None
        try:
            store = _new_vlm_disk_store(cache_path, logical_path=False)
            expected_path = _vlm_exact_cache_path(store, meta["cache_hash"])
            requested_path = Path(cache_path).resolve()
            if requested_path != expected_path.resolve():
                sys.stderr.write(
                    f"VLM exact cache hash does not match snapshot path: {cache_path}\n"
                )
                return None
            if not expected_path.is_file():
                sys.stderr.write(f"VLM exact cache snapshot missing: {cache_path}\n")
                return None
            loaded = store.load_exact_cache(meta["cache_hash"])
            if loaded is None:
                sys.stderr.write(f"VLM exact cache not found: {cache_path}\n")
                return None
            token_ids, extra_hash, prompt_cache = loaded
            if extra_hash != expected_extra_hash or len(token_ids) != meta["token_count"]:
                sys.stderr.write(f"VLM exact cache metadata mismatch: {cache_path}\n")
                return None
            if not self._matches_cached_prefix(
                prompt,
                token_ids,
                images,
                max_image_size,
            ):
                sys.stderr.write(f"VLM exact cache token prefix mismatch: {cache_path}\n")
                return None
            return prompt_cache
        except Exception as e:
            sys.stderr.write(f"Failed to load VLM cache: {e}\n")
            return None
        finally:
            if store is not None:
                store.close()

    def supports_vision(self) -> bool:
        return True

    @property
    def model_kind(self) -> str:
        return "vlm"
