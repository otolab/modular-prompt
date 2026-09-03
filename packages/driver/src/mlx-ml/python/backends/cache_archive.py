"""Streaming zip storage for MLX prompt caches."""

from __future__ import annotations

import zipfile
from collections.abc import Callable
from typing import Any


CACHE_ENTRY_NAME = "prompt_cache.safetensors"


def save_prompt_cache_zip(
    file_name: str,
    cache: Any,
    save_impl: Callable[[Any, Any], None],
) -> None:
    """Save a prompt cache into a compressed zip member as it is produced.

    ``save_impl`` receives the zip member's writable stream.  It must write
    the safetensors payload to that stream instead of creating an intermediate
    uncompressed file.
    """
    with zipfile.ZipFile(
        file_name,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        allowZip64=True,
    ) as archive:
        with archive.open(CACHE_ENTRY_NAME, mode="w", force_zip64=True) as cache_file:
            save_impl(cache_file, cache)


def load_prompt_cache_zip(
    file_name: str,
    load_impl: Callable[[Any], Any],
) -> Any:
    """Load a prompt cache from the safetensors member of a zip archive."""
    with zipfile.ZipFile(file_name, mode="r") as archive:
        with archive.open(CACHE_ENTRY_NAME, mode="r") as cache_file:
            return load_impl(cache_file)
