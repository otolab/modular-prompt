from __future__ import annotations

from copy import deepcopy
import os
import sys
from typing import Any, Iterator

from mlx_vlm import load as mlx_vlm_load
from mlx_vlm import stream_generate as mlx_vlm_stream_generate

from backends.base import ModelBackend
from utils.vlm_utils import load_and_resize_images


class MlxVlmBackend(ModelBackend):
    """`mlx_vlm` backend for vision-language models."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self.processor: Any | None = None
        self.drafter: Any | None = None
        self.drafter_kind: str | None = None
        self.draft_block_size: int | None = None
        # Keep refs and cache objects in this backend process for Phase 1.5.
        # mlx-vlm's APC/disk cache is intentionally not used here: LM/VLM
        # cache formats remain backend-specific and Phase 2 is out of scope.
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

        # Image/vision cache is intentionally out of Phase 1.  A text-only
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

        mlx-vlm owns a cache module separate from mlx-lm.  Its 0.7.0 API can
        construct and consume prompt caches, but this backend does not use the
        APC/disk helpers, so ``cache_path`` is an opaque in-process key for
        this phase.
        """
        if self.model is None or self.processor is None:
            raise RuntimeError("Model is not loaded")
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("VLM cache_prefill requires a non-empty text prompt")

        if (
            base_cache_path is not None
            or trim_to_tokens is not None
            or prefix_offsets is not None
            or prefix_hashes is not None
        ):
            sys.stderr.write(
                "VLM cache_prefill ignores base/trim/prefix arguments; "
                "VLM Phase 1 caches are backend-local and fresh-prefilled.\n"
            )

        from mlx_vlm.models.cache import make_prompt_cache

        language_model = getattr(self.model, "language_model", None)
        if language_model is None:
            raise RuntimeError("VLM model does not expose language_model")

        prompt_cache = make_prompt_cache(language_model)
        token_count = len(self.tokenize_prompt(prompt))
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

        self._prompt_caches[cache_path] = prompt_cache
        if os.getenv("MLX_DEBUG"):
            sys.stderr.write(
                f"VLM cache created in memory: {cache_path} ({token_count} tokens)\n"
            )
        return {
            "cache_path": cache_path,
            "token_count": token_count,
        }

    def load_cache_from_file(self, cache_path: str) -> list[Any] | None:
        prompt_cache = self._prompt_caches.get(cache_path)
        if prompt_cache is None:
            sys.stderr.write(f"VLM cache ref not found in this process: {cache_path}\n")
            return None
        try:
            return self._clone_prompt_cache(prompt_cache)
        except Exception as e:
            sys.stderr.write(f"Failed to clone VLM cache: {e}\n")
            return None

    def supports_vision(self) -> bool:
        return True

    @property
    def model_kind(self) -> str:
        return "vlm"
