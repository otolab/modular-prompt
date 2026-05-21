from __future__ import annotations

import json
import sys

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


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
) -> None:
    tokenizer = backend.get_tokenizer()

    extra_kwargs = {}
    if tools is not None:
        extra_kwargs["tools"] = tools
    if reasoning_effort is not None:
        extra_kwargs["reasoning_effort"] = reasoning_effort
    if supports_chat_template(tokenizer):
        try:
            prompt = tokenizer.apply_chat_template(
                messages,
                add_generation_prompt=False,
                tokenize=False,
                **extra_kwargs,
            )
        except TypeError:
            try:
                fallback_kwargs = {}
                if tools is not None:
                    fallback_kwargs["tools"] = tools
                prompt = tokenizer.apply_chat_template(
                    messages,
                    add_generation_prompt=False,
                    tokenize=False,
                    **fallback_kwargs,
                )
            except TypeError:
                try:
                    prompt = tokenizer.apply_chat_template(
                        messages,
                        add_generation_prompt=False,
                        tokenize=False,
                    )
                except Exception:
                    prompt = generate_merged_prompt(messages, capabilities)
                    sys.stderr.write(
                        "--- cache_prefill: fallback to generate_merged_prompt\n"
                    )
        except Exception:
            prompt = generate_merged_prompt(messages, capabilities)
            sys.stderr.write(
                "--- cache_prefill: fallback to generate_merged_prompt\n"
            )
    else:
        prompt = generate_merged_prompt(messages, capabilities)

    # Only show debug output if MLX_DEBUG environment variable is set
    import os
    if os.getenv('MLX_DEBUG'):
        sys.stderr.write(f"--- cache_prefill {cache_path}\n")
    result = backend.cache_prefill(
        cache_path, prompt, base_cache_path,
        trim_to_tokens=trim_to_tokens,
        prefix_offsets=prefix_offsets,
        prefix_hashes=prefix_hashes,
    )
    if prefix_offsets and prefix_hashes:
        result["prefix_offsets"] = prefix_offsets
        result["prefix_hashes"] = prefix_hashes
    print(json.dumps(result), end="\0", flush=True)
