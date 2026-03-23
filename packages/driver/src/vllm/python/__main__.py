"""
vLLM driver — Unix ソケットサーバー

AsyncLLMEngine を使用し、Unix ドメインソケットで TypeScript ドライバーと通信する。
エンジンプロセスはドライバーとは独立して起動・停止する。

プロトコル:
- リクエスト: JSON + 改行
- レスポンス:
  - ストリーミング: テキストを逐次送信、null文字(\\0)で終端
  - JSON: JSON 文字列を送信、null文字(\\0)で終端

起動例:
  uv --project . run python __main__.py \\
    --model Qwen/Qwen2.5-7B-Instruct \\
    --socket /tmp/vllm.sock \\
    --tool-call-parser hermes
"""

import sys
import os
import json
import asyncio
import uuid
import argparse
import signal

from vllm import SamplingParams
from vllm.engine.arg_utils import AsyncEngineArgs
from vllm.engine.async_llm_engine import AsyncLLMEngine


# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

engine: AsyncLLMEngine = None
tokenizer = None
tool_parser = None
tool_call_parser_name: str | None = None


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

async def init_engine(model_name: str, engine_kwargs: dict):
    global engine
    sys.stderr.write(f"Loading model: {model_name}\n")
    engine_args = AsyncEngineArgs(
        model=model_name,
        trust_remote_code=True,
        **engine_kwargs,
    )
    engine = AsyncLLMEngine.from_engine_args(engine_args)
    sys.stderr.write(f"Model loaded: {model_name}\n")


async def ensure_tokenizer():
    global tokenizer
    if tokenizer is None:
        tokenizer = await engine.get_tokenizer()
    return tokenizer


def init_tool_parser():
    global tool_parser
    if tool_call_parser_name and tokenizer:
        try:
            from vllm.entrypoints.openai.tool_parsers import ToolParserManager
            parser_class = ToolParserManager.get_tool_parser(tool_call_parser_name)
            tool_parser = parser_class(tokenizer)
            sys.stderr.write(f"Tool parser initialized: {tool_call_parser_name}\n")
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to init tool parser '{tool_call_parser_name}': {e}\n")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_sampling_params(options):
    kwargs = {}
    if 'max_tokens' in options:
        kwargs['max_tokens'] = options['max_tokens']
    if 'temperature' in options:
        kwargs['temperature'] = options['temperature']
    if 'top_p' in options:
        kwargs['top_p'] = options['top_p']
    if 'top_k' in options and options['top_k'] > 0:
        kwargs['top_k'] = options['top_k']
    if 'repetition_penalty' in options:
        kwargs['repetition_penalty'] = options['repetition_penalty']
    return SamplingParams(**kwargs)


def apply_chat_template(messages, tools=None):
    try:
        if tools:
            return tokenizer.apply_chat_template(
                messages, tools=tools,
                add_generation_prompt=True, tokenize=False,
            )
        else:
            return tokenizer.apply_chat_template(
                messages, add_generation_prompt=True, tokenize=False,
            )
    except TypeError:
        return tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False,
        )


def extract_tool_calls(text, tools):
    if not tool_parser or not tools:
        return text, []

    try:
        result = tool_parser.extract_tool_calls(text, None)
        if result.tools_called and result.tool_calls:
            calls = []
            for i, tc in enumerate(result.tool_calls):
                call = {"id": f"call_{i}", "name": "", "arguments": {}}
                if hasattr(tc, 'function'):
                    call["name"] = tc.function.name
                    args = tc.function.arguments
                else:
                    call["name"] = tc.get("function", {}).get("name", "")
                    args = tc.get("function", {}).get("arguments", "{}")
                if isinstance(args, str):
                    try:
                        call["arguments"] = json.loads(args)
                    except json.JSONDecodeError:
                        pass
                elif isinstance(args, dict):
                    call["arguments"] = args
                calls.append(call)
            content = result.content if hasattr(result, 'content') else text
            return content or "", calls
    except Exception as e:
        sys.stderr.write(f"Tool call extraction failed: {e}\n")

    return text, []


# ---------------------------------------------------------------------------
# Request handlers
# ---------------------------------------------------------------------------

async def handle_capabilities(writer):
    tok = await ensure_tokenizer()
    has_chat_template = (
        hasattr(tok, 'chat_template') and tok.chat_template is not None
    )
    model_config = await engine.get_model_config()
    info = {
        "model": engine_args_model,
        "has_chat_template": has_chat_template,
        "max_model_len": model_config.max_model_len,
        "tool_call_parser": tool_call_parser_name,
    }
    writer.write(json.dumps(info).encode() + b'\0')
    await writer.drain()


async def handle_chat(writer, messages, options=None):
    if options is None:
        options = {}

    await ensure_tokenizer()
    if tool_parser is None:
        init_tool_parser()

    params = make_sampling_params(options)
    tools = options.get('tools')
    prompt = apply_chat_template(messages, tools)
    sys.stderr.write(f"--- chat prompt\n{prompt}\n")

    if tools and tool_parser:
        # tools あり: 全文生成 → パース → JSON
        text = await generate_full(prompt, params)
        content, tool_calls = extract_tool_calls(text, tools)
        response = {"content": content, "tool_calls": tool_calls}
        writer.write(json.dumps(response, ensure_ascii=False).encode() + b'\0')
        await writer.drain()
    else:
        # tools なし: ストリーミング
        await stream_generate(writer, prompt, params)


async def handle_completion(writer, prompt, options=None):
    if options is None:
        options = {}
    params = make_sampling_params(options)
    sys.stderr.write(f"--- completion prompt\n{prompt}\n")
    await stream_generate(writer, prompt, params)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

async def generate_full(prompt, params):
    request_id = str(uuid.uuid4())
    final_text = ""
    async for output in engine.generate(prompt, params, request_id):
        final_text = output.outputs[0].text
    return final_text


async def stream_generate(writer, prompt, params):
    request_id = str(uuid.uuid4())
    prev_text = ""
    async for output in engine.generate(prompt, params, request_id):
        new_text = output.outputs[0].text[len(prev_text):]
        if new_text:
            writer.write(new_text.replace('\0', '').encode())
            await writer.drain()
            prev_text = output.outputs[0].text
    writer.write(b'\n\0')
    await writer.drain()


# ---------------------------------------------------------------------------
# Socket server
# ---------------------------------------------------------------------------

async def handle_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    peer = writer.get_extra_info('peername') or writer.get_extra_info('sockname')
    sys.stderr.write(f"Client connected: {peer}\n")

    try:
        while True:
            # リクエストを改行区切りで読み取る
            lines = []
            while True:
                line = await reader.readline()
                if not line:
                    # EOF
                    return
                lines.append(line.decode())
                try:
                    req = json.loads(''.join(lines))
                    break
                except json.JSONDecodeError:
                    continue

            await process_request(writer, req)

    except (ConnectionResetError, BrokenPipeError):
        sys.stderr.write(f"Client disconnected: {peer}\n")
    except Exception as e:
        sys.stderr.write(f"Connection error: {e}\n")
        import traceback
        traceback.print_exc(file=sys.stderr)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


async def process_request(writer, req):
    method = req.get('method')
    if not method:
        sys.stderr.write("Error: 'method' field is required\n")
        writer.write(b'\n\0')
        await writer.drain()
        return

    try:
        if method == 'capabilities':
            await handle_capabilities(writer)
        elif method == 'chat':
            messages = req.get('messages')
            if not messages:
                sys.stderr.write("Error: 'messages' required for chat\n")
                writer.write(b'\n\0')
                await writer.drain()
                return
            await handle_chat(writer, messages, req.get('options', {}))
        elif method == 'completion':
            prompt = req.get('prompt')
            if not prompt:
                sys.stderr.write("Error: 'prompt' required for completion\n")
                writer.write(b'\n\0')
                await writer.drain()
                return
            await handle_completion(writer, prompt, req.get('options', {}))
        else:
            sys.stderr.write(f"Error: Unknown method '{method}'\n")
            writer.write(b'\n\0')
            await writer.drain()
    except Exception as e:
        sys.stderr.write(f"Error processing request: {e}\n")
        import traceback
        traceback.print_exc(file=sys.stderr)
        writer.write(b'\n\0')
        await writer.drain()


async def serve(socket_path: str):
    # 既存のソケットファイルを削除
    if os.path.exists(socket_path):
        os.unlink(socket_path)

    server = await asyncio.start_unix_server(handle_connection, path=socket_path)
    sys.stderr.write(f"vLLM engine listening on {socket_path}\n")

    # graceful shutdown
    loop = asyncio.get_event_loop()
    stop = asyncio.Event()

    def on_signal():
        sys.stderr.write("Shutting down...\n")
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, on_signal)

    async with server:
        await stop.wait()

    # cleanup
    if os.path.exists(socket_path):
        os.unlink(socket_path)
    sys.stderr.write("Server stopped.\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

engine_args_model = ""


async def async_main():
    global engine_args_model, tool_call_parser_name

    parser = argparse.ArgumentParser(description="vLLM engine server")
    parser.add_argument("--model", required=True, help="HuggingFace model ID")
    parser.add_argument("--socket", required=True, help="Unix socket path")
    parser.add_argument("--tool-call-parser", default=None, help="vLLM tool call parser name")
    parser.add_argument("--gpu-memory-utilization", type=float, default=None)
    parser.add_argument("--tensor-parallel-size", type=int, default=None)
    parser.add_argument("--max-model-len", type=int, default=None)

    args = parser.parse_args()
    engine_args_model = args.model
    tool_call_parser_name = args.tool_call_parser

    engine_kwargs = {}
    if args.gpu_memory_utilization is not None:
        engine_kwargs["gpu_memory_utilization"] = args.gpu_memory_utilization
    if args.tensor_parallel_size is not None:
        engine_kwargs["tensor_parallel_size"] = args.tensor_parallel_size
    if args.max_model_len is not None:
        engine_kwargs["max_model_len"] = args.max_model_len

    await init_engine(args.model, engine_kwargs)
    await ensure_tokenizer()
    init_tool_parser()
    await serve(args.socket)


if __name__ == "__main__":
    asyncio.run(async_main())
