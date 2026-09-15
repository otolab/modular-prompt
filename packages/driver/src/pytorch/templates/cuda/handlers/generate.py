from __future__ import annotations

import json

from backends.base import ModelBackend
from handlers.cancel import poll_cancel


def _stream_to_stdout(
    backend: ModelBackend,
    prompt: str | list[int],
    options: dict,
    images: list | None = None,
    primer: str | None = None,
) -> None:
    if images:
        raise ValueError("PyTorch LIP backend does not support images in Phase 6")

    if primer is not None:
        print(primer, end="", flush=True)

    last_response = None
    for response in backend.stream_generate(prompt, options, images):
        if poll_cancel():
            break
        print(response.text.replace("\0", "").replace("\x1e", ""), end="", flush=True)
        last_response = response

    meta: dict = {}
    if last_response is not None:
        if last_response.prompt_tokens is not None:
            meta["prompt_tokens"] = last_response.prompt_tokens
        if last_response.generation_tokens is not None:
            meta["generation_tokens"] = last_response.generation_tokens

    if meta:
        print(f"\x1e__META__:{json.dumps(meta)}", end="\0", flush=True)
    else:
        print("", end="\0", flush=True)


def handle_generate(
    backend: ModelBackend,
    prompt: str | list[int],
    options: dict | None = None,
    images: list | None = None,
    max_image_size: int = 768,
    primer: str | None = None,
    cache_path: str | None = None,
    cache_trim_tokens: int | None = None,
) -> None:
    """LIP generate: 整形済み prompt のストリーム推論（KV キャッシュ非対応）"""
    if cache_path or cache_trim_tokens is not None:
        raise ValueError("PyTorch LIP backend does not support prompt caching")

    if options is None:
        options = {}

    final_options = dict(options)
    final_options.pop("trust_remote_code", None)

    _stream_to_stdout(
        backend,
        prompt,
        final_options,
        images=images,
        primer=primer,
    )
