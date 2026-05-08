from __future__ import annotations

from typing import Any, Iterator

from mlx_lm import load as mlx_lm_load
from mlx_lm import stream_generate as mlx_lm_stream_generate
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
        self, prompt: str, options: dict, images: list | None = None
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

        for response in mlx_lm_stream_generate(
            self.model,
            self.tokenizer,
            prompt,
            **final_options,
        ):
            if is_eod_token(response, self.tokenizer):
                break
            yield response

    def supports_vision(self) -> bool:
        return False

    @property
    def model_kind(self) -> str:
        return "lm"
