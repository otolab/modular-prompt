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

from backends.base import ModelBackend
from utils.vlm_utils import load_and_resize_images


VLM_EXACT_CACHE_LAYOUT = "exact_cache_v1"


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
        if not isinstance(meta, dict) or meta.get("layout") != VLM_EXACT_CACHE_LAYOUT:
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
) -> None:
    meta: dict[str, Any] = {
        "backend": "mlx-vlm",
        "layout": VLM_EXACT_CACHE_LAYOUT,
        "cache_hash": int(cache_hash),
        "token_count": int(token_count),
    }
    if prefix_offsets is not None and prefix_hashes is not None:
        meta["prefix_offsets"] = prefix_offsets
        meta["prefix_hashes"] = prefix_hashes
    with open(cache_path + ".meta.json", "w") as f:
        json.dump(meta, f)


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
        # is a DiskBlockStore-backed exact_cache_v1 snapshot.
        self._prompt_caches: dict[str, list[Any]] = {}

    def load(self, model_name: str) -> None:
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

    def tokenize_prompt(self, prompt: str) -> list[int]:
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
        if images:
            max_image_size = final_options.pop("max_image_size", 768)
            processed_images = load_and_resize_images(images, max_image_size)

        draft_kwargs = {}
        if self.drafter:
            draft_kwargs["draft_model"] = self.drafter
            draft_kwargs["draft_kind"] = self.drafter_kind
            if self.draft_block_size is not None:
                draft_kwargs["draft_block_size"] = self.draft_block_size

        # Image/vision cache is intentionally out of Phase 2.  A text-only
        # prompt cache is safe to pass through the VLM API when no image is
        # present; images must use a cold VLM request.
        if prompt_cache is not None and processed_images is None:
            draft_kwargs["prompt_cache"] = prompt_cache
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
    ) -> dict:
        """Prefill a text-only VLM cache in the current backend process.

        mlx-vlm owns a cache module separate from mlx-lm.  Its 0.7.0
        ``DiskBlockStore.save_exact_cache`` API stores the whole prompt cache
        as an ``exact_cache_v1`` snapshot.  This is deliberately not the
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
                "VLM incremental prefill is not implemented in Phase 2.\n"
            )

        from mlx_vlm.models.cache import make_prompt_cache

        language_model = getattr(self.model, "language_model", None)
        if language_model is None:
            raise RuntimeError("VLM model does not expose language_model")

        prompt_cache = make_prompt_cache(language_model)
        full_tokens = self.tokenize_prompt(prompt)
        token_count = len(full_tokens)
        for _ in mlx_vlm_stream_generate(
            self.model,
            self.processor,
            prompt,
            image=None,
            prompt_cache=prompt_cache,
            # mlx-vlm processes the prompt before yielding its zero-token
            # terminal result, so no generated token is left in the cache.
            max_tokens=0,
        ):
            break

        if is_memory_ref:
            self._prompt_caches[cache_path] = prompt_cache
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
            store.save_exact_cache(cache_hash, full_tokens, 0, detached_cache)
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
            )
        finally:
            if store is not None:
                store.close()

        if os.getenv("MLX_DEBUG"):
            sys.stderr.write(
                f"VLM cache created on disk: {actual_path} ({token_count} tokens)\n"
            )
        return {"cache_path": str(actual_path), "token_count": token_count}

    def load_cache_from_file(self, cache_path: str) -> list[Any] | None:
        if cache_path.startswith("mlx-vlm-memory://"):
            prompt_cache = self._prompt_caches.get(cache_path)
            if prompt_cache is None:
                sys.stderr.write(
                    f"VLM cache ref not found in this process: {cache_path}\n"
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
            if extra_hash != 0 or len(token_ids) != meta["token_count"]:
                sys.stderr.write(f"VLM exact cache metadata mismatch: {cache_path}\n")
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
