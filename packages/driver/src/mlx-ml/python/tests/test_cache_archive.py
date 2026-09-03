import importlib.util
import zipfile
from pathlib import Path

import pytest


def _load_cache_archive_module():
    module_path = Path(__file__).resolve().parents[1] / "backends" / "cache_archive.py"
    spec = importlib.util.spec_from_file_location("cache_archive_under_test", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cache_archive = _load_cache_archive_module()
CACHE_ENTRY_NAME = cache_archive.CACHE_ENTRY_NAME
load_prompt_cache_zip = cache_archive.load_prompt_cache_zip
save_prompt_cache_zip = cache_archive.save_prompt_cache_zip


def test_save_prompt_cache_zip_writes_compressed_member_directly(tmp_path):
    cache_path = tmp_path / "cache.safetensors.zip"
    payload = b"repeated safetensors data\n" * 4096
    writes = []

    def save_impl(cache_file, cache):
        assert cache == {"name": "test"}
        assert cache_file.name == CACHE_ENTRY_NAME
        assert {path.name for path in tmp_path.iterdir()} == {cache_path.name}
        writes.append(cache_file)
        for offset in range(0, len(payload), 257):
            cache_file.write(payload[offset:offset + 257])

    save_prompt_cache_zip(str(cache_path), {"name": "test"}, save_impl)

    assert cache_path.exists()
    assert not (tmp_path / "cache.safetensors").exists()
    assert len(writes) == 1
    assert writes[0].closed

    with zipfile.ZipFile(cache_path) as archive:
        assert archive.namelist() == [CACHE_ENTRY_NAME]
        member = archive.getinfo(CACHE_ENTRY_NAME)
        assert member.compress_type == zipfile.ZIP_DEFLATED
        assert member.file_size == len(payload)
        assert member.compress_size < member.file_size
        assert archive.read(CACHE_ENTRY_NAME) == payload


def test_save_load_and_reuse_prompt_cache_zip(tmp_path):
    cache_path = tmp_path / "cache.safetensors.zip"
    cache = b"serialized prompt cache"
    loaded_names = []

    def save_impl(cache_file, value):
        cache_file.write(value)

    def load_impl(cache_file):
        loaded_names.append(cache_file.name)
        return cache_file.read()

    save_prompt_cache_zip(str(cache_path), cache, save_impl)

    assert load_prompt_cache_zip(str(cache_path), load_impl) == cache
    assert load_prompt_cache_zip(str(cache_path), load_impl) == cache
    assert loaded_names == [CACHE_ENTRY_NAME, CACHE_ENTRY_NAME]


def test_load_prompt_cache_zip_does_not_accept_uncompressed_cache(tmp_path):
    cache_path = tmp_path / "cache.safetensors"
    cache_path.write_bytes(b"uncompressed cache")

    with pytest.raises(zipfile.BadZipFile):
        load_prompt_cache_zip(str(cache_path), lambda cache_file: cache_file.read())
