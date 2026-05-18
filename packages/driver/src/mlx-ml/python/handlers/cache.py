from __future__ import annotations

import json
import sys

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


def _compute_user_header(tokenizer) -> str:
    """user role headerを特定する（BOS除去済み）。

    2つの異なるuserメッセージのテンプレート出力を比較し、
    共通プレフィクス（= user role header）を抽出する。
    """
    content_a, content_b = "ALPHA", "BRAVO"
    try:
        solo_a = tokenizer.apply_chat_template(
            [{"role": "user", "content": content_a}],
            add_generation_prompt=False, tokenize=False,
        )
        solo_b = tokenizer.apply_chat_template(
            [{"role": "user", "content": content_b}],
            add_generation_prompt=False, tokenize=False,
        )
    except Exception:
        return ""

    diverge = 0
    for i in range(min(len(solo_a), len(solo_b))):
        if solo_a[i] != solo_b[i]:
            break
        diverge = i + 1

    prefix = solo_a[:diverge]
    bos = tokenizer.bos_token or ""
    return prefix[len(bos):] if bos and prefix.startswith(bos) else prefix


def _apply_template_system_only(tokenizer, messages: list, user_header: str) -> str:
    """system-onlyメッセージにapply_chat_templateを適用する。

    テンプレートがuserメッセージを要求する場合、ダミーuserを追加して
    テンプレート出力からuser部分を除去したsystemプレフィクスを返す。
    """
    try:
        return tokenizer.apply_chat_template(
            messages, add_generation_prompt=False, tokenize=False,
        )
    except Exception:
        pass

    content_a, content_b = "ALPHA", "BRAVO"
    prompt_a = tokenizer.apply_chat_template(
        messages + [{"role": "user", "content": content_a}],
        add_generation_prompt=False, tokenize=False,
    )
    prompt_b = tokenizer.apply_chat_template(
        messages + [{"role": "user", "content": content_b}],
        add_generation_prompt=False, tokenize=False,
    )

    diverge = 0
    for i in range(min(len(prompt_a), len(prompt_b))):
        if prompt_a[i] != prompt_b[i]:
            break
        diverge = i + 1

    common = prompt_a[:diverge]

    if user_header and common.endswith(user_header):
        return common[: -len(user_header)]

    return common


def _compute_element_offsets(
    tokenizer, full_prompt: str, system_content: str, char_offsets: list[int], user_header: str,
) -> list[int]:
    """各要素境界でのcumulativeトークン数を計算"""
    add_special = tokenizer.bos_token is None or not full_prompt.startswith(
        tokenizer.bos_token or ""
    )
    full_tokens = tokenizer.encode(full_prompt, add_special_tokens=add_special)

    offsets = []
    for char_offset in char_offsets:
        truncated = system_content[:char_offset]
        truncated_msgs = [{"role": "system", "content": truncated}]
        truncated_prompt = _apply_template_system_only(
            tokenizer, truncated_msgs, user_header,
        )
        add_special_trunc = tokenizer.bos_token is None or not truncated_prompt.startswith(
            tokenizer.bos_token or ""
        )
        trunc_tokens = tokenizer.encode(truncated_prompt, add_special_tokens=add_special_trunc)

        shared = 0
        for i in range(min(len(full_tokens), len(trunc_tokens))):
            if full_tokens[i] != trunc_tokens[i]:
                break
            shared = i + 1
        offsets.append(shared)
    return offsets


def handle_cache_prefill(
    backend: ModelBackend,
    capabilities: dict,
    cache_path: str,
    messages: list,
    base_cache_path: str | None = None,
    trim_to_tokens: int | None = None,
    element_char_offsets: list[int] | None = None,
    tools: list | None = None,
    reasoning_effort: str | None = None,
) -> None:
    tokenizer = backend.get_tokenizer()

    user_header = ""
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
                    user_header = _compute_user_header(tokenizer)
                    prompt = _apply_template_system_only(tokenizer, messages, user_header)
                    sys.stderr.write(
                        f"--- cache_prefill: used user-header fallback"
                        f" (header={repr(user_header[:30])})\n"
                    )
        except Exception:
            user_header = _compute_user_header(tokenizer)
            prompt = _apply_template_system_only(tokenizer, messages, user_header)
            sys.stderr.write(
                f"--- cache_prefill: used user-header fallback"
                f" (header={repr(user_header[:30])})\n"
            )
    else:
        prompt = generate_merged_prompt(messages, capabilities)

    element_offsets = None
    if element_char_offsets and supports_chat_template(tokenizer):
        if not user_header:
            user_header = _compute_user_header(tokenizer)
        # Collect all system messages with "\n\n" separator (matching TS side)
        system_parts = []
        for msg in messages or []:
            if msg.get("role") == "system":
                system_parts.append(msg.get("content", ""))
        system_content = "\n\n".join(system_parts) if system_parts else ""
        element_offsets = _compute_element_offsets(
            tokenizer, prompt, system_content, element_char_offsets, user_header,
        )

    # Only show debug output if MLX_DEBUG environment variable is set
    import os
    if os.getenv('MLX_DEBUG'):
        sys.stderr.write(f"--- cache_prefill {cache_path}\n")
    result = backend.cache_prefill(
        cache_path, prompt, base_cache_path,
        trim_to_tokens=trim_to_tokens,
        element_offsets=element_offsets,
    )
    if element_offsets:
        result["element_offsets"] = element_offsets
    print(json.dumps(result), end="\0", flush=True)
