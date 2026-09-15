from __future__ import annotations

import json

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


def _render_prefill_prompt(
    backend: ModelBackend,
    capabilities: dict,
    messages: list,
    tools: list | None,
    reasoning_effort: str | None,
) -> str:
    tokenizer = backend.get_tokenizer()
    extra_kwargs = {}
    if tools is not None:
        extra_kwargs["tools"] = tools
    if reasoning_effort is not None:
        extra_kwargs["reasoning_effort"] = reasoning_effort

    if not supports_chat_template(tokenizer):
        return generate_merged_prompt(messages, capabilities)

    try:
        return tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=False,
            tokenize=False,
            **extra_kwargs,
        )
    except TypeError:
        try:
            fallback_kwargs = {"tools": tools} if tools is not None else {}
            return tokenizer.apply_chat_template(
                messages,
                add_generation_prompt=False,
                tokenize=False,
                **fallback_kwargs,
            )
        except TypeError:
            return tokenizer.apply_chat_template(
                messages,
                add_generation_prompt=False,
                tokenize=False,
            )


def handle_cache_prefill(
    backend: ModelBackend,
    capabilities: dict,
    cache_path: str,
    messages: list,
    base_cache_path: str | None = None,
    trim_to_tokens: int | None = None,
    prefix_offsets: list[int] | None = None,
    prefix_hashes: list[str] | None = None,
    tools: list | None = None,
    reasoning_effort: str | None = None,
    images: list | None = None,
    max_image_size: int = 768,
) -> None:
    """Build a persistent or process-local PyTorch KV cache from chat messages."""
    if images:
        raise ValueError("PyTorch LIP backend does not support vision input")

    prompt = _render_prefill_prompt(
        backend,
        capabilities,
        messages,
        tools,
        reasoning_effort,
    )
    result = backend.cache_prefill(
        cache_path,
        prompt,
        base_cache_path=base_cache_path,
        trim_to_tokens=trim_to_tokens,
        prefix_offsets=prefix_offsets,
        prefix_hashes=prefix_hashes,
        images=images,
        max_image_size=max_image_size,
    )
    if prefix_offsets is not None and prefix_hashes is not None:
        result["prefix_offsets"] = prefix_offsets
        result["prefix_hashes"] = prefix_hashes
    print(json.dumps(result), end="\0", flush=True)
