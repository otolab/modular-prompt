from __future__ import annotations

import json

from backends.base import ModelBackend
from utils.template_render import apply_chat_template_prompt


def handle_render(
    backend: ModelBackend,
    messages: list,
    options: dict | None = None,
    tools: list | None = None,
    reasoning_effort: str | None = None,
) -> None:
    """LIP render: apply_chat_template のみ（推論しない）"""
    if options is None:
        options = {}

    result: dict = {
        "formatted_prompt": None,
        "error": None,
    }

    try:
        trust_remote_code = options.get("trust_remote_code")
        primer = options.get("primer")
        prompt = apply_chat_template_prompt(
            backend,
            messages,
            primer=primer,
            tools=tools,
            reasoning_effort=reasoning_effort,
            trust_remote_code=trust_remote_code,
        )
        result["formatted_prompt"] = prompt
    except Exception as e:
        result["error"] = str(e)

    print(json.dumps(result), end="\0", flush=True)
