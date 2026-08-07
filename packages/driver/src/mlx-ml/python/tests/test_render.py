import json
from unittest.mock import MagicMock, patch

from handlers.render import handle_render


class TestHandleRender:
    def test_renders_with_chat_template(self, capsys):
        backend = MagicMock()
        tokenizer = MagicMock()
        tokenizer.chat_template = "template"
        tokenizer.apply_chat_template.return_value = "<prompt>hello</prompt>"
        backend.get_tokenizer.return_value = tokenizer
        backend.supports_vision.return_value = False

        messages = [{"role": "user", "content": "hello"}]
        handle_render(backend, messages)

        captured = capsys.readouterr()
        assert captured.out.endswith("\0")
        result = json.loads(captured.out.rstrip("\0"))
        assert result["formatted_prompt"] == "<prompt>hello</prompt>"
        assert result["error"] is None

    def test_returns_error_when_no_template(self, capsys):
        backend = MagicMock()
        tokenizer = MagicMock()
        tokenizer.chat_template = None
        backend.get_tokenizer.return_value = tokenizer
        backend.supports_vision.return_value = False

        handle_render(backend, [{"role": "user", "content": "hi"}])

        captured = capsys.readouterr()
        result = json.loads(captured.out.rstrip("\0"))
        assert result["formatted_prompt"] is None
        assert "chat_template_not_available" in result["error"]

    def test_passes_tools_and_reasoning_effort(self, capsys):
        backend = MagicMock()
        tokenizer = MagicMock()
        tokenizer.chat_template = "template"
        tokenizer.apply_chat_template.return_value = "formatted"
        backend.get_tokenizer.return_value = tokenizer
        backend.supports_vision.return_value = False

        tools = [{"type": "function", "function": {"name": "foo"}}]
        handle_render(
            backend,
            [{"role": "user", "content": "hi"}],
            options={"trust_remote_code": True},
            tools=tools,
            reasoning_effort="low",
        )

        tokenizer.apply_chat_template.assert_called_once()
        kwargs = tokenizer.apply_chat_template.call_args.kwargs
        assert kwargs["tools"] == tools
        assert kwargs["reasoning_effort"] == "low"
        assert kwargs["trust_remote_code"] is True
