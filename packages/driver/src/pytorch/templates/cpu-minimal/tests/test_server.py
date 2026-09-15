from unittest.mock import MagicMock, patch


def _make_server():
    from server import Server

    backend = MagicMock()
    return Server(backend, {"methods": ["capabilities"], "model_kind": "lm"})


def test_cache_prefill_dispatches_to_handler(capsys):
    server = _make_server()

    with patch("server.handle_cache_prefill") as mock_prefill:
        server._dispatch(
            {
                "method": "cache_prefill",
                "cache_path": "memory://prefix",
                "messages": [{"role": "user", "content": "hello"}],
            }
        )

    mock_prefill.assert_called_once()
    assert mock_prefill.call_args.args[2:] == (
        "memory://prefix",
        [{"role": "user", "content": "hello"}],
    )
    assert capsys.readouterr().out == ""


def test_cache_prefill_requires_path_and_messages(capsys):
    server = _make_server()

    server._dispatch({"method": "cache_prefill"})

    assert capsys.readouterr().out.endswith("\0")
