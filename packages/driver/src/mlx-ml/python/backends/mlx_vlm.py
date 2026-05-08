from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any, Iterator

from mlx_vlm import load as mlx_vlm_load
from mlx_vlm import stream_generate as mlx_vlm_stream_generate

from backends.base import ModelBackend
from utils.vlm_utils import load_and_resize_images


@dataclass
class BatchResponse:
    """batch_generate の結果を stream_generate 互換にするラッパー"""
    text: str


class MlxVlmBackend(ModelBackend):
    """`mlx_vlm` backend for vision-language models."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self.processor: Any | None = None
        self.drafter: Any | None = None

    def load(self, model_name: str) -> None:
        self.model, self.processor = mlx_vlm_load(model_name)

    def load_drafter(self, drafter_model: str) -> None:
        from mlx_vlm.speculative.drafters import load_drafter
        self.drafter = load_drafter(drafter_model, kind="mtp")
        sys.stderr.write(f"Drafter loaded: {drafter_model}\n")

    def has_drafter(self) -> bool:
        return self.drafter is not None

    def get_tokenizer(self) -> Any:
        return self.processor

    def stream_generate(
        self, prompt: str | list[int], options: dict, images: list | None = None
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

        if self.drafter:
            yield from self._batch_with_drafter(
                prompt, max_tokens, temperature, top_p, top_k, processed_images
            )
        else:
            yield from mlx_vlm_stream_generate(
                self.model,
                self.processor,
                prompt,
                image=processed_images,
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                top_k=top_k,
            )

    def _batch_with_drafter(
        self,
        prompt: str | list[int],
        max_tokens: int,
        temperature: float,
        top_p: float,
        top_k: int,
        images: Any | None,
    ) -> Iterator[BatchResponse]:
        from mlx_vlm.generate import batch_generate

        results = batch_generate(
            self.model,
            self.processor,
            prompts=[prompt],
            draft_model=self.drafter,
            draft_kind="mtp",
            draft_block_size=3,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
        )
        if results:
            yield BatchResponse(text=results[0])

    def supports_vision(self) -> bool:
        return True

    @property
    def model_kind(self) -> str:
        return "vlm"
