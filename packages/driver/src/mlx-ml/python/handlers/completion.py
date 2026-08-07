from __future__ import annotations

from backends.base import ModelBackend
from handlers.generate import handle_generate


def handle_completion(
    backend: ModelBackend,
    prompt: str | list[int],
    options: dict | None = None,
    images: list | None = None,
    max_image_size: int = 768,
) -> None:
    """completion API（後方互換）— generate に委譲"""
    handle_generate(backend, prompt, options, images, max_image_size)
