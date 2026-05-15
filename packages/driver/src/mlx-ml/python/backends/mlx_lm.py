from __future__ import annotations

import sys
from typing import Any, Iterator

from mlx_lm import load as mlx_lm_load
from mlx_lm import stream_generate as mlx_lm_stream_generate
from mlx_lm.models.cache import make_prompt_cache, save_prompt_cache, load_prompt_cache
from mlx_lm.sample_utils import make_sampler

from backends.base import ModelBackend
from utils.token_utils import is_eod_token


class MlxLmBackend(ModelBackend):
    """`mlx_lm` backend for text-only models."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self.tokenizer: Any | None = None

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

    def cache_prefill(self, cache_path: str, prompt: str) -> dict:
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        prompt_cache = make_prompt_cache(self.model)
        for _ in mlx_lm_stream_generate(
            self.model, self.tokenizer, prompt,
            prompt_cache=prompt_cache, max_tokens=1,
        ):
            break
        save_prompt_cache(cache_path, prompt_cache)
        sys.stderr.write(f"Cache created: {cache_path}\n")
        return {"cache_path": cache_path}

    def load_cache_from_file(self, cache_path: str) -> list | None:
        try:
            return load_prompt_cache(cache_path)
        except FileNotFoundError:
            sys.stderr.write(f"Cache file not found: {cache_path}\n")
            return None
        except Exception as e:
            sys.stderr.write(f"Failed to load cache: {e}\n")
            return None

    def supports_vision(self) -> bool:
        return False

    @property
    def model_kind(self) -> str:
        return "lm"
