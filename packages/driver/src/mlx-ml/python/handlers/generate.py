from __future__ import annotations

import json
import os
import re
import sys

from backends.base import ModelBackend
from mlx_lm.models.cache import trim_prompt_cache
from handlers.cancel import poll_cancel


def _read_cache_token_count(cache_path: str) -> int | None:
    """Read token count from the sidecar .meta.json file."""
    meta_path = cache_path + '.meta.json'
    try:
        with open(meta_path) as f:
            meta = json.load(f)
            count = meta.get('token_count')
            return int(count) if count is not None else None
    except (FileNotFoundError, json.JSONDecodeError, ValueError, TypeError):
        return None


def _stream_to_stdout(
    backend: ModelBackend,
    prompt: str | list[int],
    options: dict,
    images: list | None = None,
    primer: str | None = None,
    prompt_cache: list | None = None,
) -> None:
    if primer is not None:
        print(primer, end="", flush=True)

    last_response = None
    for response in backend.stream_generate(prompt, options, images, prompt_cache=prompt_cache):
        if poll_cancel():
            break
        print(response.text.replace("\0", "").replace("\x1e", ""), end="", flush=True)
        last_response = response

    meta: dict = {}
    if last_response is not None:
        if hasattr(last_response, "prompt_tokens"):
            meta["prompt_tokens"] = last_response.prompt_tokens
        if hasattr(last_response, "generation_tokens"):
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
    """LIP generate: 整形済み prompt のストリーム推論"""
    if options is None:
        options = {}

    final_options = dict(options)
    if images:
        final_options["max_image_size"] = max_image_size
        if os.getenv('MLX_DEBUG'):
            if isinstance(prompt, str):
                display_prompt = re.sub(r'(<\|image_pad\|>)+', '<|image_pad|>...', prompt)
            else:
                display_prompt = f"<token ids: len={len(prompt)}>"
            sys.stderr.write(
                f"--- vlm generate (images: {len(images)}, max_size: {max_image_size})\n{display_prompt}\n"
            )
    elif os.getenv('MLX_DEBUG'):
        if isinstance(prompt, list):
            sys.stderr.write(f"--- prompt: len={len(prompt)}\n")
        else:
            sys.stderr.write(f"--- prompt\n{prompt}\n")

    # VLM 経路では KV キャッシュを使わない（旧 chat ハンドラと同様）
    prompt_cache = None
    cache_tokens = 0
    if cache_path and not images:
        prompt_cache = backend.load_cache_from_file(cache_path)
    if prompt_cache is not None:
        if cache_trim_tokens is not None:
            current_offset = backend.get_cache_offset(prompt_cache)
            if current_offset > cache_trim_tokens:
                trim_prompt_cache(prompt_cache, current_offset - cache_trim_tokens)
                sys.stderr.write(
                    f"KV cache trimmed: {current_offset} → {cache_trim_tokens} tokens\n"
                )
                cache_tokens = cache_trim_tokens
            else:
                cache_tokens = current_offset
        else:
            meta_count = _read_cache_token_count(cache_path) if cache_path else None
            if meta_count is not None:
                cache_tokens = meta_count
            else:
                sys.stderr.write(
                    f"WARNING: Cache file exists but no .meta.json found at {cache_path}. "
                    "Ignoring cache for safety (may be from old implementation).\n"
                )
                prompt_cache = None
                cache_tokens = 0
        if prompt_cache is not None:
            sys.stderr.write(
                f"KV cache loaded: {len(prompt_cache)} layers, {cache_tokens} cached tokens\n"
            )
    elif cache_path:
        sys.stderr.write(f"KV cache load FAILED: {cache_path}\n")

    final_options.pop("trust_remote_code", None)

    effective_prompt = prompt
    if prompt_cache is not None and cache_tokens > 0 and isinstance(prompt, str):
        tokenizer = backend.get_tokenizer()
        add_special = tokenizer.bos_token is None or not prompt.startswith(
            tokenizer.bos_token
        )
        full_tokens = tokenizer.encode(prompt, add_special_tokens=add_special)

        if cache_tokens < len(full_tokens):
            effective_prompt = full_tokens[cache_tokens:]
            sys.stderr.write(
                f"Prefilled {cache_tokens}/{len(full_tokens)} tokens, "
                f"generating from {len(effective_prompt)} remaining\n"
            )
        else:
            sys.stderr.write(
                f"Prefill offset {cache_tokens} >= prompt {len(full_tokens)}, "
                f"ignoring prefill state\n"
            )
            prompt_cache = None

    _stream_to_stdout(
        backend,
        effective_prompt,
        final_options,
        images=images,
        primer=primer,
        prompt_cache=prompt_cache,
    )
