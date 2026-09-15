"""apply_chat_template によるプロンプト整形（推論なし）"""

from __future__ import annotations

from utils.prompt_builder import supports_chat_template


def apply_chat_template_prompt(
    backend,
    messages: list,
    *,
    primer: str | None = None,
    tools: list | None = None,
    reasoning_effort: str | None = None,
    trust_remote_code: bool | None = None,
) -> str | list:
    """messages を chat template で整形して prompt を返す"""
    tokenizer = backend.get_tokenizer()

    if not supports_chat_template(tokenizer):
        raise ValueError("chat_template_not_available")

    add_generation_prompt = True
    fmt_messages = list(messages)
    if primer is not None:
        fmt_messages.append({"role": "assistant", "content": primer})
        add_generation_prompt = False

    if backend.supports_vision():
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
    else:
        extra_kwargs: dict = {}
        if tools is not None:
            extra_kwargs["tools"] = tools
        if reasoning_effort is not None:
            extra_kwargs["reasoning_effort"] = reasoning_effort
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
                fallback_kwargs: dict = {}
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

    if primer is not None and isinstance(prompt, str):
        prompt = primer.join(prompt.split(primer)[0:-1]) + primer

    return prompt
