# Tool call example using LLM-jp-4 with mlx-lm on Apple Silicon.

from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler


def generate_response(model, tokenizer, input_ids, sampler):
    generated_ids: list[int] = []
    for resp in stream_generate(
        model, tokenizer, prompt=input_ids,
        max_tokens=1024, sampler=sampler,
    ):
        generated_ids.append(resp.token)
    return generated_ids


def main():
    model, tokenizer = load(
        # "llm-jp/llm-jp-4-8b-thinking",
        # "llm-jp/llm-jp-4-8b-instruct",
        # "mlx-community/llm-jp-4-32b-a3b-thinking-4bit",
        "mlx-community/Qwen3.6-27B-4bit",
        # tokenizer_config={"trust_remote_code": True},
    )

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_current_time",
                "description": "現在の日時を取得する",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "指定された都市の現在の天気を取得する",
                "parameters": {
                    "type": "object",
                    "required": ["city"],
                    "properties": {
                        "city": {
                            "type": "string",
                            "description": "都市名（例: 東京、大阪）",
                        },
                    },
                },
            },
        },
    ]

    messages = [
        {"role": "developer", "content": "必要に応じて応答をTool Callに切り替えてください。functionsで定義されている機能を呼び出すことができます。"},
        # \nツール実行形式: <|start|>assistant to=functions.get_current_time<|channel|>commentary json<|message|>{"locate": "Asia/Tokyo"}<|call|>

        # few-shot: tool call → tool response の例
        {"role": "user", "content": "今何時？"},
        {
            "role": "assistant",
            "tool_calls": [{
                "function": {
                    "name": "get_current_time",
                    "arguments": {"locate": "Asia/Tokyo"},
                },
            }],
        },
        {
            "role": "tool",
            "content": {"datetime": "2026-04-24T15:30:00+09:00"},
        },
        {
            "role": "assistant",
            "content": "現在の時刻は15時30分です。",
        },
        # 本番のリクエスト
        {"role": "user", "content": '東京の天気を教えてください。'},
    ]

    sampler = make_sampler(temp=0.7, top_p=0.9)

    # --- Turn 1: tool call生成 ---
    prompt: str = tokenizer.apply_chat_template(
        messages,
        tools=tools,
        tokenize=False,
        add_generation_prompt=True,
        trust_remote_code=True,
        reasoning_effort="middle",
    )

    print("=== Turn 1: Tool Call ===")
    print("--- Prompt ---")
    print(prompt)

    input_ids = tokenizer.encode(prompt)
    generated_ids = generate_response(model, tokenizer, input_ids, sampler)
    response = tokenizer.decode(generated_ids)

    print("\n--- Raw Response ---")
    print(response)

    # Harmony parserでtool callを解析
    response_prefill = tokenizer.encode("<|start|>assistant")
    parsed_harmony = tokenizer.parse_harmony_message(response_prefill + generated_ids)

    print("\n--- Parsed Harmony Messages ---")
    for i, message in enumerate(parsed_harmony, start=1):
        print(f"Message {i}:")
        print("  End Type:", message.end)
        if message.role:
            print("  Role:", repr(tokenizer.decode(message.role.token_ids)))
        if message.channel:
            print("  Channel:", repr(tokenizer.decode(message.channel.token_ids)))
        if message.constrain:
            print("  Constrain:", repr(tokenizer.decode(message.constrain.token_ids)))
        if message.content:
            print("  Content:", repr(tokenizer.decode(message.content.token_ids)))

    # # --- Turn 2: tool resultを渡して最終応答 ---
    # messages.append({
    #     "role": "assistant",
    #     "tool_calls": [{
    #         "function": {
    #             "name": "get_weather",
    #             "arguments": '{"city": "東京"}',
    #         },
    #     }],
    # })
    # messages.append({
    #     "role": "tool",
    #     "content": '{"city": "東京", "weather": "晴れ", "temperature": 22, "humidity": 45}',
    # })

    # prompt2: str = tokenizer.apply_chat_template(
    #     messages,
    #     tools=tools,
    #     tokenize=False,
    #     add_generation_prompt=True,
    # )

    # print("\n\n=== Turn 2: Final Response ===")
    # print("--- Prompt ---")
    # print(prompt2)

    # input_ids2 = tokenizer.encode(prompt2)
    # generated_ids2 = generate_response(model, tokenizer, input_ids2, sampler)
    # response2 = tokenizer.decode(generated_ids2)

    # print("\n--- Raw Response ---")
    # print(response2)

    # parsed = tokenizer.parse_response(response2)
    # print("\n--- Parsed Response ---")
    # print("Role:", parsed.get("role"))
    # print("Thinking:", parsed.get("thinking"))
    # print("Content:", parsed.get("content"))


if __name__ == "__main__":
    main()
