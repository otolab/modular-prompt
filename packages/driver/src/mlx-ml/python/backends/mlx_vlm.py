from __future__ import annotations

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

    def load(self, model_name: str) -> None:
        self.model, self.processor = mlx_vlm_load(model_name)

    def get_tokenizer(self) -> Any:
        return self.processor

    def stream_generate(
        self, prompt: str, options: dict, images: list | None = None
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

    def supports_vision(self) -> bool:
        return True

    @property
    def model_kind(self) -> str:
        return "vlm"
