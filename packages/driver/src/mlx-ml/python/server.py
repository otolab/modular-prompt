"""JSON-RPC風サーバー: stdin/stdoutベースのリクエストディスパッチ"""
import json
import sys

from backends.base import ModelBackend
from handlers import handle_capabilities, handle_chat, handle_completion, handle_format_test


def read():
    lines = []
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        lines.append(line)
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

    def _dispatch(self, req: dict):
        method = req.get('method')
        if not method:
            sys.stderr.write("Error: 'method' field is required\n")
            print('\n', end='\0', flush=True)
            return

        try:
            if method == 'capabilities':
                handle_capabilities(self.capabilities)

            elif method == 'format_test':
                messages = req.get('messages')
                if not messages:
                    sys.stderr.write("Error: 'messages' field is required for format_test method\n")
                    print('\n', end='\0', flush=True)
                    return
                handle_format_test(self.backend, self.capabilities, messages, req.get('options', {}), req.get('tools'))

            elif method == 'chat':
                messages = req.get('messages')
                if not messages:
                    sys.stderr.write("Error: 'messages' field is required for chat method\n")
                    print('\n', end='\0', flush=True)
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
                )

            elif method == 'completion':
                prompt = req.get('prompt')
                if not prompt:
                    sys.stderr.write("Error: 'prompt' field is required for completion method\n")
                    print('\n', end='\0', flush=True)
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
                sys.stderr.write(f"Error: Unknown method '{method}'\n")
                print('\n', end='\0', flush=True)

        except Exception as e:
            sys.stderr.write(f"Error processing request: {e}\n")
            print('\n', end='\0', flush=True)
