from __future__ import annotations

import re
import sys

from backends.base import ModelBackend


def handle_completion(
    backend: ModelBackend,
    prompt: str | list[int],
    options: dict | None = None,
    images: list | None = None,
    max_image_size: int = 768,
) -> None:
    """completion API の処理"""
    if options is None:
        options = {}

    final_options = dict(options)
    if images:
        final_options["max_image_size"] = max_image_size
        display_prompt = re.sub(r'(<\|image_pad\|>)+', '<|image_pad|>...', prompt)
        sys.stderr.write(f"--- vlm completion (images: {len(images)}, max_size: {max_image_size})\n{display_prompt}\n")
    else:
        if isinstance(prompt, list):
            sys.stderr.write(f"--- prompt: len={len(prompt)}\n")
        else:
            sys.stderr.write(f"--- prompt\n{prompt}\n")

    for response in backend.stream_generate(prompt, final_options, images):
        print(response.text.replace("\0", ""), end="", flush=True)

    print("\n", end="\0", flush=True)
