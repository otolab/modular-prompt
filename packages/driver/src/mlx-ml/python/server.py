"""JSON-RPC風サーバー: stdin/stdoutベースのリクエストディスパッチ"""
import json
import sys

from backends.base import ModelBackend
from handlers import handle_cache_prefill, handle_capabilities, handle_chat, handle_completion, handle_format_test


MAX_READ_LINES = 10000


def read():
    lines = []
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        lines.append(line)
        if len(lines) > MAX_READ_LINES:
            sys.stderr.write(f"Error: read buffer exceeded {MAX_READ_LINES} lines, discarding\n")
            lines.clear()
            continue
        try:
            return json.loads(''.join(lines))
        except json.JSONDecodeError:
            continue


class Server:
    def __init__(self, backend: ModelBackend, capabilities: dict):
        self.backend = backend
        self.capabilities = capabilities

    def run(self):
        while True:
            req = read()
            if req is None:
                break
            self._dispatch(req)

    def _error_response(self, message: str) -> None:
        sys.stderr.write(f"Error: {message}\n")
        print(json.dumps({"error": message}), end='\0', flush=True)

    def _dispatch(self, req: dict):
        method = req.get('method')
        if not method:
            self._error_response("'method' field is required")
            return

        try:
            if method == 'capabilities':
                handle_capabilities(self.capabilities)

            elif method == 'format_test':
                messages = req.get('messages')
                if not messages:
                    self._error_response("'messages' field is required for format_test method")
                    return
                handle_format_test(self.backend, self.capabilities, messages, req.get('options', {}), req.get('tools'))

            elif method == 'cache_prefill':
                cache_path = req.get('cache_path')
                messages = req.get('messages')
                if not cache_path or not messages:
                    self._error_response("'cache_path' and 'messages' fields are required for cache_prefill")
                    return
                handle_cache_prefill(
                    self.backend, self.capabilities, cache_path, messages,
                    base_cache_path=req.get('base_cache_path'),
                    trim_to_tokens=req.get('trim_to_tokens'),
                    element_char_offsets=req.get('element_char_offsets'),
                    tools=req.get('tools'),
                )

            elif method == 'chat':
                messages = req.get('messages')
                if not messages:
                    self._error_response("'messages' field is required for chat method")
                    return
                handle_chat(
                    self.backend,
                    self.capabilities,
                    messages,
                    primer=req.get('primer'),
                    options=req.get('options', {}),
                    tools=req.get('tools'),
                    images=req.get('images', []),
                    max_image_size=req.get('maxImageSize', 768),
                    reasoning_effort=req.get('reasoning_effort'),
                    cache_path=req.get('cache_path'),
                    cache_trim_tokens=req.get('cache_trim_tokens'),
                )

            elif method == 'completion':
                prompt = req.get('prompt')
                if not prompt:
                    self._error_response("'prompt' field is required for completion method")
                    return
                images = req.get('images', [])
                handle_completion(
                    self.backend,
                    prompt,
                    options=req.get('options', {}),
                    images=images if images else None,
                    max_image_size=req.get('maxImageSize', 768),
                )

            else:
                self._error_response(f"Unknown method '{method}'")

        except Exception as e:
            self._error_response(f"Error processing request: {e}")
