from __future__ import annotations

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

        yield from mlx_vlm_stream_generate(
            self.model,
            self.processor,
            prompt,
            image=processed_images,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            top_k=top_k,
            **draft_kwargs,
        )

    def supports_vision(self) -> bool:
        return True

    @property
    def model_kind(self) -> str:
        return "vlm"
