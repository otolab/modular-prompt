import io
import sys
from unittest.mock import patch

from server import read


class TestRead:
    def test_single_line_json(self):
        fake_stdin = io.StringIO('{"method": "capabilities"}\n')
        with patch.object(sys, 'stdin', fake_stdin):
            result = read()
        assert result == {"method": "capabilities"}

    def test_multiline_json(self):
        fake_stdin = io.StringIO('{"method":\n"chat"}\n')
        with patch.object(sys, 'stdin', fake_stdin):
            result = read()
        assert result == {"method": "chat"}

    def test_eof_returns_none(self):
        fake_stdin = io.StringIO('')
        with patch.object(sys, 'stdin', fake_stdin):
            result = read()
        assert result is None

    def test_nested_json(self):
        data = '{"method": "chat", "messages": [{"role": "user", "content": "hi"}]}\n'
        fake_stdin = io.StringIO(data)
        with patch.object(sys, 'stdin', fake_stdin):
            result = read()
        assert result["method"] == "chat"
        assert len(result["messages"]) == 1


class TestServerDispatch:
    def _make_server(self):
        from server import Server
        from unittest.mock import MagicMock
        backend = MagicMock()
        backend.get_tokenizer.return_value = MagicMock()
        caps = {"methods": ["capabilities"], "model_kind": "lm"}
        return Server(backend, caps)

    def test_unknown_method(self, capsys):
        server = self._make_server()
        server._dispatch({"method": "unknown"})
        captured = capsys.readouterr()
        assert captured.out.endswith('\0')

    def test_missing_method(self, capsys):
        server = self._make_server()
        server._dispatch({})
        captured = capsys.readouterr()
        assert captured.out.endswith('\0')

    def test_capabilities_dispatch(self, capsys):
        server = self._make_server()
        server._dispatch({"method": "capabilities"})
        captured = capsys.readouterr()
        assert '"model_kind"' in captured.out
        assert captured.out.endswith('\0')

    def test_chat_missing_messages(self, capsys):
        server = self._make_server()
        server._dispatch({"method": "chat"})
        captured = capsys.readouterr()
        assert captured.out.endswith('\0')

    def test_completion_missing_prompt(self, capsys):
        server = self._make_server()
        server._dispatch({"method": "completion"})
        captured = capsys.readouterr()
        assert captured.out.endswith('\0')
