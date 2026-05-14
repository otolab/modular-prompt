from __future__ import annotations

import copy
import sys
from typing import Any, Iterator

from mlx_lm import load as mlx_lm_load
from mlx_lm import stream_generate as mlx_lm_stream_generate
from mlx_lm.models.cache import make_prompt_cache
from mlx_lm.sample_utils import make_sampler

from backends.base import ModelBackend
from utils.token_utils import is_eod_token


class MlxLmBackend(ModelBackend):
    """`mlx_lm` backend for text-only models."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self.tokenizer: Any | None = None
        self._caches: dict[str, list] = {}

    def load(self, model_name: str) -> None:
        self.model, self.tokenizer = mlx_lm_load(model_name)

    def get_tokenizer(self) -> Any:
        return self.tokenizer

    def stream_generate(
        self,
        prompt: str | list[int],
        options: dict,
        images: list | None = None,
        prompt_cache: list | None = None,
    ) -> Iterator[Any]:
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        final_options = {"max_tokens": 1000, **options}
        temperature = final_options.pop("temperature", 1.0)
        top_p = final_options.pop("top_p", 0.0)
        top_k = final_options.pop("top_k", 0)
        final_options["sampler"] = make_sampler(
            temp=temperature,
            top_p=top_p,
            top_k=top_k,
        )

        if prompt_cache is not None:
            final_options["prompt_cache"] = prompt_cache

        for response in mlx_lm_stream_generate(
            self.model,
            self.tokenizer,
            prompt,
            **final_options,
        ):
            if is_eod_token(response, self.tokenizer):
                break
            yield response

    def cache_prefill(self, cache_id: str, prompt: str) -> dict:
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        prompt_cache = make_prompt_cache(self.model)
        for _ in mlx_lm_stream_generate(
            self.model, self.tokenizer, prompt,
            prompt_cache=prompt_cache, max_tokens=1,
        ):
            pass
        self._caches[cache_id] = prompt_cache
        sys.stderr.write(f"Cache created: {cache_id}\n")
        return {"cache_id": cache_id}

    def cache_delete(self, cache_id: str) -> None:
        removed = self._caches.pop(cache_id, None)
        if removed is not None:
            sys.stderr.write(f"Cache deleted: {cache_id}\n")

    def cache_get(self, cache_id: str) -> list | None:
        cached = self._caches.get(cache_id)
        if cached is None:
            return None
        return copy.deepcopy(cached)

    def supports_vision(self) -> bool:
        return False

    @property
    def model_kind(self) -> str:
        return "lm"
