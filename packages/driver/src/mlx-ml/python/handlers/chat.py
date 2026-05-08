from __future__ import annotations

import re
import sys

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


def _stream_to_stdout(
    backend: ModelBackend,
    prompt: str | list[int],
    options: dict,
    images: list | None = None,
    primer: str | None = None,
) -> None:
    if primer is not None:
        print(primer, end="", flush=True)

    for response in backend.stream_generate(prompt, options, images):
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

    if not supports_chat_template(tokenizer):
        prompt = generate_merged_prompt(messages, capabilities)
        _stream_to_stdout(backend, prompt, options, primer=primer)
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
    _stream_to_stdout(backend, prompt, final_options, primer=primer)
