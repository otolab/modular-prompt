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
) -> None:
    tokenizer = backend.get_tokenizer()

    if supports_chat_template(tokenizer):
        prompt = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=False,
            tokenize=False,
        )
    else:
        prompt = generate_merged_prompt(messages, capabilities)

    sys.stderr.write(f"--- cache_prefill {cache_path}\n")
    result = backend.cache_prefill(cache_path, prompt, base_cache_path)
    print(json.dumps(result), end="\0", flush=True)
