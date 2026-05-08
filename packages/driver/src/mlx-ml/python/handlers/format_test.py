import json

from backends.base import ModelBackend
from utils.prompt_builder import generate_merged_prompt, supports_chat_template


def handle_format_test(
    backend: ModelBackend,
    capabilities: dict,
    messages: list,
    options: dict | None = None,
    tools: list | None = None,
) -> None:
    """フォーマットテスト API の処理（実際に生成せずフォーマットのみ）"""
    if options is None:
        options = {}

    tokenizer = backend.get_tokenizer()
    result = {
        "formatted_prompt": None,
        "template_applied": False,
        "model_specific_processing": None,
        "error": None,
    }

    try:
        if supports_chat_template(tokenizer):
            result["model_specific_processing"] = messages

            primer = options.get("primer")
            add_generation_prompt = True

            if primer is not None:
                messages.append({"role": "assistant", "content": primer})
                add_generation_prompt = False

            try:
                formatted_prompt = tokenizer.apply_chat_template(
                    messages,
                    tools=tools,
                    add_generation_prompt=add_generation_prompt,
                    tokenize=False,
                )
            except TypeError:
                formatted_prompt = tokenizer.apply_chat_template(
                    messages,
                    add_generation_prompt=add_generation_prompt,
                    tokenize=False,
                )

            if primer is not None:
                formatted_prompt = (
                    primer.join(formatted_prompt.split(primer)[0:-1]) + primer
                )

            result["formatted_prompt"] = formatted_prompt
            result["template_applied"] = True
        else:
            formatted_prompt = generate_merged_prompt(messages, capabilities)
            primer = options.get("primer")
            if primer is not None:
                formatted_prompt += primer

            result["formatted_prompt"] = formatted_prompt
            result["template_applied"] = False
    except Exception as e:
        result["error"] = str(e)

    print(json.dumps(result), end="\0", flush=True)
