# This file contains code to use LLM-jp-4 models with mlx-lm on Apple Silicon.

from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler


def main():
    model, tokenizer = load(
        # "llm-jp/llm-jp-4-8b-instruct",
        "llm-jp/llm-jp-4-8b-thinking",
        tokenizer_config={"trust_remote_code": True},
    )

    messages = [
        {"role": "user", "content": "日本語で自己紹介してください。"},
    ]

    prompt: str = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
        reasoning_effort="medium",
    )

    print("--- Prompt ---")
    print(prompt)

    input_ids = tokenizer.encode(prompt)

    print("--- Input IDs ---")
    print(input_ids)

    generated_ids: list[int] = []

    sampler = make_sampler(temp=0.7, top_p=0.9)

    for resp in stream_generate(
        model, tokenizer, prompt=input_ids,
        max_tokens=1024, sampler=sampler,
    ):
        generated_ids.append(resp.token)

    print("--- Generated IDs ---")
    print(generated_ids)

    response = tokenizer.decode(generated_ids)

    print("\n--- Response ---")
    print(response)

    parsed = tokenizer.parse_response(response)

    print("\n--- Parsed Response ---")
    print("Role:", parsed.get("role"))
    print("Thinking:", parsed.get("thinking"))
    print("Content:", parsed.get("content"))

    # Harmony parser is bundled as the parse_harmony_message method of the tokenizer.
    # This function accepts a list of token IDs (not strings)
    # and returns a list of Harmony's message objects with split tokens.

    # To correctly parse the response,
    # we need to include the prefill tokens for the assistant's response.
    response_prefill = tokenizer.encode("<|start|>assistant")
    parsed_harmony = tokenizer.parse_harmony_message(response_prefill + generated_ids)

    print("\n--- Parsed Harmony Messages ---")
    for i, message in enumerate(parsed_harmony, start=1):
        print(f"Message {i}:")

        # The end type can be "END", "CALL", or "INCOMPLETE".
        print("  End Type:", message.end)

        if message.role:
            print("  Role Tokens:", message.role.token_ids)
            print("  Role Text:", repr(tokenizer.decode(message.role.token_ids)))
            print("  Role Start Position:", message.role.start)
        if message.channel:
            print("  Channel Tokens:", message.channel.token_ids)
            print("  Channel Text:", repr(tokenizer.decode(message.channel.token_ids)))
            print("  Channel Start Position:", message.channel.start)
        if message.constrain:
            print("  Constrain Tokens:", message.constrain.token_ids)
            print("  Constrain Text:", repr(tokenizer.decode(message.constrain.token_ids)))
            print("  Constrain Start Position:", message.constrain.start)
        if message.content:
            print("  Content Tokens:", message.content.token_ids)
            print("  Content Text:", repr(tokenizer.decode(message.content.token_ids)))
            print("  Content Start Position:", message.content.start)


if __name__ == "__main__":
    main()
