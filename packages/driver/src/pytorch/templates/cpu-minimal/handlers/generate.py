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
    prompt_cache=None,
    cache_loaded: bool | None = None,
    cache_read_tokens: int = 0,
) -> None:
    if images:
        raise ValueError("PyTorch LIP backend does not support images in Phase 1")

    if primer is not None:
        print(primer, end="", flush=True)

    last_response = None
    for response in backend.stream_generate(
        prompt,
        options,
        images,
        prompt_cache=prompt_cache,
    ):
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
        if getattr(last_response, "cache_read_tokens", None) is not None:
            meta["cache_read_tokens"] = last_response.cache_read_tokens
    if cache_read_tokens > 0 and "cache_read_tokens" not in meta:
        meta["cache_read_tokens"] = cache_read_tokens
    if cache_loaded is not None:
        meta["cache_loaded"] = cache_loaded

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
    """LIP generate: 整形済み prompt のストリーム推論"""
    if cache_trim_tokens is not None:
        raise ValueError(
            "PyTorch LIP backend does not support cache trimming in Phase 1"
        )

    if options is None:
        options = {}

    final_options = dict(options)
    final_options.pop("trust_remote_code", None)

    prompt_cache = None
    cache_loaded = None
    cache_read_tokens = 0
    if cache_path:
        if images:
            cache_loaded = False
        else:
            prompt_cache = backend.load_cache_from_file(
                cache_path,
                images=images,
                max_image_size=max_image_size,
                prompt=prompt,
            )
            cache_loaded = prompt_cache is not None

        if prompt_cache is not None:
            cache_read_tokens = backend.get_cache_offset(prompt_cache)
            if cache_read_tokens <= 0:
                prompt_cache = None
                cache_loaded = False
            elif isinstance(prompt, (str, list)):
                full_tokens = (
                    backend.tokenize_prompt(prompt)
                    if isinstance(prompt, str)
                    else [int(token_id) for token_id in prompt]
                )
                if cache_read_tokens < len(full_tokens):
                    prompt = full_tokens[cache_read_tokens:]
                else:
                    # A cache covering the complete prompt cannot be passed
                    # with an empty input_ids tensor.  The safe fallback is a
                    # cold generation for this Phase 1 handler.
                    prompt_cache = None
                    cache_loaded = False
                    cache_read_tokens = 0

    _stream_to_stdout(
        backend,
        prompt,
        final_options,
        images=images,
        primer=primer,
        prompt_cache=prompt_cache,
        cache_loaded=cache_loaded,
        cache_read_tokens=cache_read_tokens,
    )
