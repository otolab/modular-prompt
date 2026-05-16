from __future__ import annotations

import json
import re
import sys

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


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

    for response in backend.stream_generate(prompt, options, images, prompt_cache=prompt_cache):
        print(response.text.replace("\0", ""), end="", flush=True)

    print("\n", end="\0", flush=True)


def handle_chat(
    backend: ModelBackend,
    capabilities: dict,
    messages: list,
    primer: str | None = None,
    options: dict | None = None,
    tools: list | None = None,
    images: list | None = None,
    max_image_size: int = 768,
    reasoning_effort: str | None = None,
    cache_path: str | None = None,
) -> None:
    """chat API の処理"""
    if options is None:
        options = {}

    tokenizer = backend.get_tokenizer()

    if backend.supports_vision():
        add_generation_prompt = True
        fmt_messages = list(messages)
        if primer is not None:
            fmt_messages.append({"role": "assistant", "content": primer})
            add_generation_prompt = False

        try:
            prompt = tokenizer.apply_chat_template(
                fmt_messages,
                tools=tools,
                add_generation_prompt=add_generation_prompt,
                tokenize=False,
            )
        except TypeError:
            prompt = tokenizer.apply_chat_template(
                fmt_messages,
                add_generation_prompt=add_generation_prompt,
                tokenize=False,
            )

        if primer is not None:
            prompt = primer.join(prompt.split(primer)[0:-1]) + primer

        display_prompt = re.sub(r'(<\|image_pad\|>)+', '<|image_pad|>...', prompt)
        sys.stderr.write(f"--- vlm prompt (images: {len(images) if images else 0}, max_size: {max_image_size})\n{display_prompt}\n")

        final_options = dict(options)
        final_options["max_image_size"] = max_image_size
        _stream_to_stdout(
            backend,
            prompt,
            final_options,
            images=images,
            primer=primer,
        )
        return

    prompt_cache = backend.load_cache_from_file(cache_path) if cache_path else None
    cache_tokens = 0
    if prompt_cache is not None:
        meta_count = _read_cache_token_count(cache_path) if cache_path else None
        if meta_count is not None:
            cache_tokens = meta_count
        sys.stderr.write(
            f"KV cache loaded: {len(prompt_cache)} layers, {cache_tokens} cached tokens\n"
        )
    elif cache_path:
        sys.stderr.write(f"KV cache load FAILED: {cache_path}\n")

    if not supports_chat_template(tokenizer):
        prompt = generate_merged_prompt(messages, capabilities)
        _stream_to_stdout(backend, prompt, options, primer=primer, prompt_cache=prompt_cache)
        return

    add_generation_prompt = True
    fmt_messages = list(messages)
    if primer is not None:
        fmt_messages.append({"role": "assistant", "content": primer})
        add_generation_prompt = False

    extra_kwargs = {}
    if tools is not None:
        extra_kwargs["tools"] = tools
    if reasoning_effort is not None:
        extra_kwargs["reasoning_effort"] = reasoning_effort

    trust_remote_code = options.get("trust_remote_code")
    if trust_remote_code is not None:
        extra_kwargs["trust_remote_code"] = trust_remote_code

    try:
        prompt = tokenizer.apply_chat_template(
            fmt_messages,
            add_generation_prompt=add_generation_prompt,
            tokenize=False,
            **extra_kwargs,
        )
    except TypeError:
        try:
            fallback_kwargs = {}
            if tools is not None:
                fallback_kwargs["tools"] = tools
            prompt = tokenizer.apply_chat_template(
                fmt_messages,
                add_generation_prompt=add_generation_prompt,
                tokenize=False,
                **fallback_kwargs,
            )
        except TypeError:
            prompt = tokenizer.apply_chat_template(
                fmt_messages,
                add_generation_prompt=add_generation_prompt,
                tokenize=False,
            )

    if primer is not None:
        prompt = primer.join(prompt.split(primer)[0:-1]) + primer

    if isinstance(prompt, list):
        sys.stderr.write(f"--- prompt: len={len(prompt)}\n")
    else:
        sys.stderr.write(f"--- prompt\n{prompt}\n")

    final_options = dict(options)
    final_options.pop("trust_remote_code", None)

    effective_prompt = prompt
    if prompt_cache is not None and cache_tokens > 0 and isinstance(prompt, str):
        add_special = tokenizer.bos_token is None or not prompt.startswith(
            tokenizer.bos_token
        )
        full_tokens = tokenizer.encode(prompt, add_special_tokens=add_special)

        if cache_tokens < len(full_tokens):
            effective_prompt = full_tokens[cache_tokens:]
            sys.stderr.write(
                f"Prompt cache: skip {cache_tokens}/{len(full_tokens)} tokens, "
                f"process {len(effective_prompt)} remaining\n"
            )
        else:
            sys.stderr.write(
                f"Prompt cache: offset {cache_tokens} >= prompt {len(full_tokens)}, "
                f"ignoring cache\n"
            )
            prompt_cache = None

    _stream_to_stdout(backend, effective_prompt, final_options, primer=primer, prompt_cache=prompt_cache)
