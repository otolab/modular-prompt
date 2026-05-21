import json

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


def handle_tokenize(
    backend: ModelBackend,
    capabilities: dict,
    messages: list,
    tools: list | None = None,
    reasoning_effort: str | None = None,
) -> None:
    """メッセージをchat template適用後にトークン化して返す"""
    tokenizer = backend.get_tokenizer()

    result = {
        "token_ids": None,
        "token_count": 0,
        "error": None,
    }

    try:
        # apply_chat_templateのfallbackパターン (chat.py L165-188 と同じ)
        # add_generation_prompt=False で、アシスタントの開始トークンは含めない
        extra_kwargs = {}
        if tools is not None:
            extra_kwargs["tools"] = tools
        if reasoning_effort is not None:
            extra_kwargs["reasoning_effort"] = reasoning_effort

        if supports_chat_template(tokenizer):
            # chat.py と同じfallbackチェーン
            prompt = None
            for kwargs in [extra_kwargs, {k: v for k, v in extra_kwargs.items() if k == "tools"}, {}]:
                try:
                    prompt = tokenizer.apply_chat_template(
                        messages,
                        add_generation_prompt=False,
                        tokenize=False,
                        **kwargs,
                    )
                    break
                except TypeError:
                    continue

            if prompt is None:
                prompt = str(messages)
        else:
            prompt = generate_merged_prompt(messages, capabilities)

        # トークン化
        add_special = tokenizer.bos_token is None or not prompt.startswith(
            tokenizer.bos_token or ""
        )
        token_ids = tokenizer.encode(prompt, add_special_tokens=add_special)

        result["token_ids"] = token_ids
        result["token_count"] = len(token_ids)
    except Exception as e:
        result["error"] = str(e)

    print(json.dumps(result), end="\0", flush=True)
