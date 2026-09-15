"""Cancel request handling for in-flight streaming generation."""

from __future__ import annotations

import json
import select
import sys

_cancel_requested = False


def request_cancel() -> None:
    global _cancel_requested
    _cancel_requested = True


def reset_cancel() -> None:
    global _cancel_requested
    _cancel_requested = False


def is_cancel_requested() -> bool:
    return _cancel_requested


def poll_cancel() -> bool:
    """Non-blocking check for a cancel command on stdin during streaming."""
    global _cancel_requested
    if _cancel_requested:
        return True

    try:
        ready, _, _ = select.select([sys.stdin], [], [], 0)
    except (ValueError, OSError):
        return False

    if not ready:
        return False

    line = sys.stdin.readline()
    if not line:
        return False

    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        return False

    if req.get("method") == "cancel":
        _cancel_requested = True
        return True

    return False
