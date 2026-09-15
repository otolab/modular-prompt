from __future__ import annotations

import copy
import inspect
import json
import os
import sys
from dataclasses import dataclass
from tempfile import mkstemp
from threading import Thread
from typing import Any, Iterator

import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

from backends.base import ModelBackend
from utils.token_utils import is_eod_token
from utils.transformers_errors import (
    extract_unsupported_model_type,
    unsupported_model_type_error,
)


class _TokenCountingTextIteratorStreamer(TextIteratorStreamer):
    """TextIteratorStreamer that counts generated token IDs, not text chunks."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.generated_token_count = 0

    def put(self, value: torch.Tensor) -> None:
        is_prompt = self.skip_prompt and self.next_tokens_are_prompt
        if not is_prompt:
            token_count = value[0].numel() if value.ndim > 1 else value.numel()
            self.generated_token_count += int(token_count)
        super().put(value)

    def on_finalized_text(self, text: str, stream_end: bool = False) -> None:
        """Queue text together with the token count at its emission point."""
        self.text_queue.put((text, self.generated_token_count), timeout=self.timeout)
        if stream_end:
            self.text_queue.put(self.stop_signal, timeout=self.timeout)

    def __next__(self) -> tuple[str, int]:
        value = self.text_queue.get(timeout=self.timeout)
        if value == self.stop_signal:
            raise StopIteration()
        return value


@dataclass
class StreamChunk:
    text: str
    prompt_tokens: int | None = None
    generation_tokens: int | None = None
    finish_reason: str | None = None
    cache_read_tokens: int | None = None


class TransformersLmBackend(ModelBackend):
    """Transformers causal LM backend (text-only, CPU-first)."""

    CACHE_LAYOUT = "pytorch_kv_v1"
    CACHE_META_SUFFIX = ".meta.json"

    def __init__(self, device: str | None = None) -> None:
        self.model: Any | None = None
        self.tokenizer: Any | None = None
        self._device_name = device or os.environ.get("PYTORCH_DEVICE", "cpu")
        self._device = torch.device(self._device_name)
        self._model_id: str | None = None
        self._model_dtype: str | None = None
        self._caches: dict[str, Any] = {}
        self._cache_token_counts: dict[str, int] = {}
        self._cache_token_ids: dict[str, tuple[int, ...]] = {}
        self._cache_write_token_counts: dict[str, int] = {}
        self._cache_meta: dict[str, dict[str, Any]] = {}

    def load(self, model_name: str) -> None:
        self._caches.clear()
        self._cache_token_counts.clear()
        self._cache_token_ids.clear()
        self._cache_write_token_counts.clear()
        self._cache_meta.clear()
        self._model_id = None
        self._model_dtype = None

        trust_remote_code = os.environ.get("PYTORCH_TRUST_REMOTE_CODE", "").lower() in (
            "1",
            "true",
            "yes",
        )
        try:
            self.tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                trust_remote_code=trust_remote_code,
            )
            if self.tokenizer.pad_token is None and self.tokenizer.eos_token is not None:
                self.tokenizer.pad_token = self.tokenizer.eos_token

            dtype = torch.float32 if self._device.type == "cpu" else torch.float16
            self.model = AutoModelForCausalLM.from_pretrained(
                model_name,
                trust_remote_code=trust_remote_code,
                dtype=dtype,
            )
        except (KeyError, ValueError) as error:
            model_type = extract_unsupported_model_type(error)
            if model_type is None:
                raise
            raise unsupported_model_type_error(
                model_name,
                model_type,
                getattr(transformers, "__version__", "unknown"),
            ) from error

        self.model.to(self._device)
        self.model.eval()
        self._model_id = model_name
        self._model_dtype = self._dtype_name(dtype)

    def get_tokenizer(self) -> Any:
        return self.tokenizer

    def tokenize_prompt(
        self,
        prompt: str,
        images: list | None = None,
        max_image_size: int = 768,
    ) -> list[int]:
        if images:
            raise ValueError("TransformersLmBackend does not support vision input")
        if self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        bos_token = getattr(self.tokenizer, "bos_token", None)
        add_special = bos_token is None or not prompt.startswith(bos_token or "")
        token_ids = self.tokenizer.encode(prompt, add_special_tokens=add_special)
        if hasattr(token_ids, "flatten"):
            token_ids = token_ids.flatten().tolist()
        return [int(token_id) for token_id in token_ids]

    @staticmethod
    def _clone_cache(prompt_cache: Any) -> Any:
        """Clone model-owned cache state before generation mutates it."""
        if isinstance(prompt_cache, torch.Tensor):
            return prompt_cache.clone()
        if isinstance(prompt_cache, tuple):
            return tuple(TransformersLmBackend._clone_cache(item) for item in prompt_cache)
        if isinstance(prompt_cache, list):
            return [TransformersLmBackend._clone_cache(item) for item in prompt_cache]
        if isinstance(prompt_cache, dict):
            return {
                key: TransformersLmBackend._clone_cache(value)
                for key, value in prompt_cache.items()
            }
        if hasattr(prompt_cache, "layers"):
            try:
                cloned_cache = copy.copy(prompt_cache)
                cloned_cache.layers = [
                    TransformersLmBackend._clone_cache(layer)
                    for layer in prompt_cache.layers
                ]
                return cloned_cache
            except Exception:
                pass
        if (
            hasattr(prompt_cache, "keys")
            and hasattr(prompt_cache, "values")
        ) or any(
            hasattr(prompt_cache, attribute)
            for attribute in ("conv_states", "recurrent_states")
        ):
            try:
                cloned_layer = copy.copy(prompt_cache)
                for attribute in (
                    "keys",
                    "values",
                    "indexer_keys",
                    "indexer_cumulative_length",
                    "cumulative_length",
                    "cumulative_length_int",
                    "conv_states",
                    "recurrent_states",
                ):
                    if hasattr(prompt_cache, attribute):
                        setattr(
                            cloned_layer,
                            attribute,
                            TransformersLmBackend._clone_cache(
                                getattr(prompt_cache, attribute)
                            ),
                        )
                return cloned_layer
            except Exception:
                pass
        if hasattr(prompt_cache, "get_seq_length"):
            try:
                return copy.deepcopy(prompt_cache)
            except Exception:
                # Some third-party Cache implementations cannot be deep-copied.
                # Keep the request usable; those implementations must tolerate
                # in-place generation updates.
                return prompt_cache
        return prompt_cache

    @staticmethod
    def _dtype_name(dtype: Any) -> str:
        """Return a stable, human-readable dtype name for cache metadata."""
        value = str(dtype)
        return value.removeprefix("torch.")

    def _current_model_id(self) -> str:
        if self._model_id:
            return self._model_id

        for candidate in (
            getattr(self.model, "name_or_path", None),
            getattr(getattr(self.model, "config", None), "_name_or_path", None),
            getattr(getattr(self.model, "config", None), "name_or_path", None),
        ):
            if candidate:
                return str(candidate)
        return "unknown"

    def _current_dtype(self) -> str:
        if self._model_dtype:
            return self._model_dtype

        if self.model is not None:
            try:
                parameter = next(self.model.parameters())
                return self._dtype_name(parameter.dtype)
            except (AttributeError, RuntimeError, StopIteration, TypeError):
                pass

        return "float32" if self._device.type == "cpu" else "float16"

    def _supports_model_kwarg(self, name: str) -> bool:
        """Check whether Transformers exposes a kwarg on the model forward."""
        if self.model is None:
            return False
        try:
            parameters = inspect.signature(self.model.forward).parameters
        except (AttributeError, TypeError, ValueError):
            # Test doubles and custom remote-code models may not expose a
            # useful signature.  Preserve the existing kwargs in that case.
            return True
        return name in parameters

    def _cache_meta_for(
        self,
        token_count: int,
        prefix_offsets: list[int] | None = None,
        prefix_hashes: list[str] | None = None,
    ) -> dict[str, Any]:
        if (prefix_offsets is None) != (prefix_hashes is None):
            raise ValueError("prefix_offsets and prefix_hashes must be provided together")
        if prefix_offsets is not None and len(prefix_offsets) != len(prefix_hashes or []):
            raise ValueError("prefix_offsets and prefix_hashes must have the same length")

        return {
            "layout": self.CACHE_LAYOUT,
            "token_count": int(token_count),
            "prefix_offsets": list(prefix_offsets or []),
            "prefix_hashes": list(prefix_hashes or []),
            "model_id": self._current_model_id(),
            "dtype": self._current_dtype(),
            "device": str(self._device),
        }

    @classmethod
    def _is_memory_cache_path(cls, cache_path: str) -> bool:
        return cache_path.startswith("memory://")

    @classmethod
    def _meta_path(cls, cache_path: str) -> str:
        return cache_path + cls.CACHE_META_SUFFIX

    @staticmethod
    def _atomic_torch_save(payload: dict[str, Any], cache_path: str) -> None:
        directory = os.path.dirname(os.path.abspath(cache_path))
        os.makedirs(directory, exist_ok=True)
        fd, temporary_path = mkstemp(
            prefix=f".{os.path.basename(cache_path)}.",
            suffix=".tmp",
            dir=directory,
        )
        try:
            with os.fdopen(fd, "wb") as output:
                torch.save(payload, output)
            os.replace(temporary_path, cache_path)
        except Exception:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            raise

    @staticmethod
    def _atomic_json_save(meta: dict[str, Any], meta_path: str) -> None:
        directory = os.path.dirname(os.path.abspath(meta_path))
        os.makedirs(directory, exist_ok=True)
        fd, temporary_path = mkstemp(
            prefix=f".{os.path.basename(meta_path)}.",
            suffix=".tmp",
            dir=directory,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(meta, output)
            os.replace(temporary_path, meta_path)
        except Exception:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            raise

    @staticmethod
    def _serialize_cache_value(value: Any) -> Any:
        if isinstance(value, torch.Tensor):
            return {"kind": "tensor", "value": value.detach().cpu()}
        if isinstance(value, torch.dtype):
            return {
                "kind": "dtype",
                "value": str(value).removeprefix("torch."),
            }
        if isinstance(value, torch.device):
            return {"kind": "device", "value": str(value)}
        if value is None or isinstance(value, (bool, int, float, str)):
            return {"kind": "value", "value": value}
        if isinstance(value, dict):
            return {
                "kind": "mapping",
                "items": [
                    [
                        TransformersLmBackend._serialize_cache_value(key),
                        TransformersLmBackend._serialize_cache_value(item),
                    ]
                    for key, item in value.items()
                ],
            }
        if isinstance(value, tuple):
            return {
                "kind": "sequence",
                "sequence_type": "tuple",
                "items": [TransformersLmBackend._serialize_cache_value(item) for item in value],
            }
        if isinstance(value, list):
            return {
                "kind": "sequence",
                "sequence_type": "list",
                "items": [TransformersLmBackend._serialize_cache_value(item) for item in value],
            }
        raise TypeError(f"Unsupported PyTorch cache value: {type(value).__name__}")

    @classmethod
    def _serialize_cache_layer(cls, layer: Any) -> dict[str, Any]:
        keys = getattr(layer, "keys", None)
        values = getattr(layer, "values", None)
        attributes = getattr(layer, "__dict__", None)
        if not isinstance(attributes, dict):
            attributes = {}
        serialized = {
            "kind": "layer",
            "class_name": type(layer).__name__,
            "attributes": {
                name: cls._serialize_cache_value(value)
                for name, value in attributes.items()
            },
            "token_count": cls._cache_offset_from_value(layer),
        }
        if not attributes and not (
            isinstance(keys, torch.Tensor) and isinstance(values, torch.Tensor)
        ):
            raise TypeError(f"Unsupported PyTorch cache layer: {type(layer).__name__}")
        return serialized

    @classmethod
    def _serialize_cache(cls, prompt_cache: Any) -> Any:
        if isinstance(prompt_cache, torch.Tensor):
            return cls._serialize_cache_value(prompt_cache)
        if isinstance(prompt_cache, (tuple, list)):
            return cls._serialize_cache_value(prompt_cache)
        if hasattr(prompt_cache, "layers"):
            return {
                "kind": "cache",
                "cache_type": type(prompt_cache).__name__,
                "layers": [
                    cls._serialize_cache_layer(layer)
                    for layer in prompt_cache.layers
                ],
            }
        if hasattr(prompt_cache, "keys") and hasattr(prompt_cache, "values"):
            return cls._serialize_cache_layer(prompt_cache)
        raise TypeError(f"Unsupported PyTorch cache: {type(prompt_cache).__name__}")

    @classmethod
    def _deserialize_cache_value(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("Invalid PyTorch cache payload")

        kind = value.get("kind")
        if kind == "tensor":
            tensor = value.get("value")
            if not isinstance(tensor, torch.Tensor):
                raise ValueError("Invalid tensor in PyTorch cache payload")
            return tensor
        if kind == "dtype":
            try:
                return getattr(torch, value["value"])
            except (KeyError, AttributeError):
                raise ValueError("Invalid dtype in PyTorch cache payload")
        if kind == "device":
            try:
                return torch.device(value["value"])
            except (KeyError, RuntimeError, TypeError):
                raise ValueError("Invalid device in PyTorch cache payload")
        if kind == "value":
            return value.get("value")
        if kind == "mapping":
            items = value.get("items", [])
            if not isinstance(items, list):
                raise ValueError("Invalid mapping in PyTorch cache payload")
            return {
                cls._deserialize_cache_value(key): cls._deserialize_cache_value(item)
                for key, item in items
            }
        if kind == "sequence":
            items = [cls._deserialize_cache_value(item) for item in value.get("items", [])]
            return tuple(items) if value.get("sequence_type") == "tuple" else items
        if kind == "layer":
            if "attributes" in value:
                return cls._deserialize_cache_layer(value)
            return (
                cls._deserialize_cache_value(value["keys"]),
                cls._deserialize_cache_value(value["values"]),
            )
        raise ValueError(f"Unknown PyTorch cache payload kind: {kind!r}")

    @classmethod
    def _deserialize_cache_layer(cls, value: Any) -> Any:
        if not isinstance(value, dict) or value.get("kind") != "layer":
            raise ValueError("Invalid PyTorch cache layer payload")
        if "attributes" in value:
            attributes = value["attributes"]
            if not isinstance(attributes, dict):
                raise ValueError("Invalid PyTorch cache layer attributes")
            return {
                "class_name": value.get("class_name"),
                "token_count": value.get("token_count"),
                "attributes": {
                    name: cls._deserialize_cache_value(item)
                    for name, item in attributes.items()
                },
            }
        return (
            cls._deserialize_cache_value(value["keys"]),
            cls._deserialize_cache_value(value["values"]),
        )

    def _deserialize_cache(self, value: Any) -> Any:
        if not isinstance(value, dict):
            raise ValueError("Invalid PyTorch cache payload")

        if value.get("kind") != "cache":
            return self._deserialize_cache_value(value)

        raw_layers = value.get("layers")
        if not isinstance(raw_layers, list):
            raise ValueError("Invalid PyTorch cache layers")
        layers = [self._deserialize_cache_layer(layer) for layer in raw_layers]
        legacy_layers = []
        for layer in layers:
            if isinstance(layer, tuple):
                legacy_layers.append(layer)
                continue
            if not isinstance(layer, dict):
                break
            attributes = layer["attributes"]
            keys = attributes.get("keys")
            values = attributes.get("values")
            if (
                not isinstance(keys, torch.Tensor)
                or not isinstance(values, torch.Tensor)
                or "conv_states" in attributes
                or "recurrent_states" in attributes
                or "indexer_keys" in attributes
                or "cumulative_length" in attributes
                or "max_cache_len" in attributes
            ):
                break
            layer_token_count = layer.get("token_count")
            if layer_token_count is not None:
                try:
                    layer_token_count = int(layer_token_count)
                except (TypeError, ValueError):
                    break
                if layer_token_count < 0:
                    break
                if keys.ndim >= 2 and layer_token_count < keys.shape[-2]:
                    keys = keys[..., :layer_token_count, :]
                    values = values[..., :layer_token_count, :]
            legacy_layers.append((keys, values))
        if len(legacy_layers) == len(layers):
            try:
                from transformers.cache_utils import DynamicCache

                return DynamicCache(legacy_layers)
            except Exception:
                return tuple(legacy_layers)

        config = getattr(self.model, "config", None)
        if config is None:
            raise ValueError(
                "A model config is required to restore a non-KV Transformers cache"
            )
        try:
            from transformers.cache_utils import DynamicCache

            prompt_cache = DynamicCache(config=config)
        except Exception:
            raise ValueError("Unable to initialize the Transformers cache")

        if len(prompt_cache.layers) != len(layers):
            raise ValueError("Transformers cache layer count does not match model")
        for target_layer, source_layer in zip(prompt_cache.layers, layers):
            if not isinstance(source_layer, dict):
                raise ValueError("Invalid Transformers cache layer")
            class_name = source_layer.get("class_name")
            if class_name and type(target_layer).__name__ != class_name:
                raise ValueError("Transformers cache layer type does not match model")
            for name, item in source_layer["attributes"].items():
                setattr(target_layer, name, item)
        return prompt_cache

    @staticmethod
    def _cache_offset_from_value(prompt_cache: Any) -> int:
        get_seq_length = getattr(prompt_cache, "get_seq_length", None)
        if callable(get_seq_length):
            try:
                value = get_seq_length()
                return int(value.item() if hasattr(value, "item") else value)
            except Exception:
                pass

        if isinstance(prompt_cache, torch.Tensor):
            shape = getattr(prompt_cache, "shape", None)
            if shape is not None and len(shape) >= 2:
                return int(shape[-2])

        if isinstance(prompt_cache, (list, tuple)):
            offsets = [
                TransformersLmBackend._cache_offset_from_value(item)
                for item in prompt_cache
            ]
            return max(offsets, default=0)

        keys = getattr(prompt_cache, "keys", None)
        shape = getattr(keys, "shape", None)
        if shape is not None and len(shape) >= 2:
            return int(shape[-2])

        layers = getattr(prompt_cache, "layers", None)
        if layers is not None:
            offsets = [TransformersLmBackend._cache_offset_from_value(item) for item in layers]
            return max(offsets, default=0)
        return 0

    def _write_cache_meta(
        self,
        cache_path: str,
        token_count: int,
        prefix_offsets: list[int] | None = None,
        prefix_hashes: list[str] | None = None,
    ) -> dict[str, Any]:
        meta = self._cache_meta_for(token_count, prefix_offsets, prefix_hashes)
        self._atomic_json_save(meta, self._meta_path(cache_path))
        self._cache_meta[cache_path] = meta
        return meta

    @classmethod
    def _read_cache_meta(cls, cache_path: str) -> dict[str, Any] | None:
        try:
            with open(cls._meta_path(cache_path), encoding="utf-8") as input_file:
                meta = json.load(input_file)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None

        if not isinstance(meta, dict) or meta.get("layout") != cls.CACHE_LAYOUT:
            return None
        try:
            token_count = int(meta["token_count"])
        except (KeyError, TypeError, ValueError):
            return None
        if token_count < 0:
            return None
        return meta

    def _cache_meta_matches_current(self, meta: dict[str, Any]) -> bool:
        expected = {
            "layout": self.CACHE_LAYOUT,
            "model_id": self._current_model_id(),
            "dtype": self._current_dtype(),
            "device": str(self._device),
        }
        return all(meta.get(key) == value for key, value in expected.items())

    @staticmethod
    def _token_ids_from_payload(value: Any) -> tuple[int, ...]:
        if isinstance(value, torch.Tensor):
            value = value.flatten().tolist()
        if not isinstance(value, (list, tuple)):
            raise ValueError("Invalid token IDs in PyTorch cache payload")
        return tuple(int(token_id) for token_id in value)

    def _prompt_matches_cache(
        self,
        prompt: str | list[int] | None,
        cached_token_ids: tuple[int, ...],
    ) -> bool:
        if prompt is None:
            return True
        current_token_ids = (
            self.tokenize_prompt(prompt)
            if isinstance(prompt, str)
            else [int(token_id) for token_id in prompt]
        )
        return (
            len(current_token_ids) >= len(cached_token_ids)
            and tuple(current_token_ids[: len(cached_token_ids)]) == cached_token_ids
        )

    def _load_disk_cache(
        self,
        cache_path: str,
        prompt: str | list[int] | None = None,
    ) -> Any | None:
        meta = self._read_cache_meta(cache_path)
        if meta is None:
            sys.stderr.write(f"PyTorch cache metadata not found or invalid: {cache_path}\n")
            return None
        if not self._cache_meta_matches_current(meta):
            sys.stderr.write(f"PyTorch cache metadata mismatch: {cache_path}\n")
            return None

        try:
            try:
                payload = torch.load(
                    cache_path,
                    map_location=self._device,
                    weights_only=True,
                )
            except TypeError:
                payload = torch.load(cache_path, map_location=self._device)
            if not isinstance(payload, dict) or payload.get("layout") != self.CACHE_LAYOUT:
                raise ValueError("unsupported cache layout")
            cached_token_ids = self._token_ids_from_payload(payload["token_ids"])
            token_count = int(meta["token_count"])
            if len(cached_token_ids) != token_count:
                raise ValueError("cache token count does not match metadata")
            prompt_cache = self._deserialize_cache(payload["cache"])
            cache_offset = self._cache_offset_from_value(prompt_cache)
            if cache_offset not in (0, token_count):
                raise ValueError("cache offset does not match metadata")
            if not self._prompt_matches_cache(prompt, cached_token_ids):
                sys.stderr.write(f"PyTorch cache prompt prefix mismatch: {cache_path}\n")
                return None
        except Exception as error:
            sys.stderr.write(f"Failed to load PyTorch cache {cache_path}: {error}\n")
            return None

        self._caches[cache_path] = prompt_cache
        self._cache_token_counts[cache_path] = token_count
        self._cache_token_ids[cache_path] = cached_token_ids
        self._cache_meta[cache_path] = meta
        return prompt_cache

    def get_cache_offset(self, prompt_cache: Any) -> int:
        """Return the token count represented by a Transformers cache."""
        offset = self._cache_offset_from_value(prompt_cache)
        if offset > 0:
            return offset

        for cache_path, cached in self._caches.items():
            if cached is prompt_cache:
                return self._cache_token_counts.get(cache_path, 0)

        return super().get_cache_offset(prompt_cache)

    def _update_registered_cache_offset(
        self,
        prompt_cache: Any,
        token_count: int,
    ) -> None:
        for cache_path, cached in self._caches.items():
            if cached is prompt_cache:
                self._cache_token_counts[cache_path] = token_count

    @staticmethod
    def _trim_tensor(tensor: torch.Tensor, target_tokens: int) -> torch.Tensor:
        if tensor.ndim < 2:
            return tensor
        return tensor[..., :target_tokens, :]

    @staticmethod
    def _set_cache_layer_length(layer: Any, token_count: int) -> None:
        for attribute in (
            "cumulative_length",
            "cumulative_length_int",
            "indexer_cumulative_length",
        ):
            if not hasattr(layer, attribute):
                continue
            value = getattr(layer, attribute)
            try:
                if isinstance(value, torch.Tensor):
                    value.fill_(token_count)
                else:
                    setattr(layer, attribute, token_count)
            except (AttributeError, RuntimeError, TypeError):
                pass

    def _trim_cache_layer(self, layer: Any, target_tokens: int, tokens: int) -> bool:
        keys = getattr(layer, "keys", None)
        values = getattr(layer, "values", None)
        has_auxiliary_state = hasattr(layer, "conv_states") or hasattr(
            layer, "recurrent_states"
        )
        if has_auxiliary_state:
            trim = getattr(layer, "trim", None)
            if callable(trim):
                trim(tokens)
                return True
            crop = getattr(layer, "crop", None)
            if callable(crop):
                crop(-tokens)
                return True

        # Sliding-window layers may retain only the working window while
        # tracking a larger logical sequence.  Their crop implementation
        # knows how to select the corresponding suffix and update that
        # logical length; slicing keys directly would keep the wrong window.
        crop = getattr(layer, "crop", None)
        if callable(crop) and getattr(layer, "is_sliding", False):
            crop(-tokens)
            return True

        if isinstance(keys, torch.Tensor) and isinstance(values, torch.Tensor):
            current_tokens = self._cache_offset_from_value(layer)
            physical_tokens = keys.shape[-2] if keys.ndim >= 2 else current_tokens
            if target_tokens < current_tokens and current_tokens > physical_tokens:
                raise ValueError(
                    "Cannot trim a sliding-window cache after its prefix was discarded"
                )

            get_max_length = getattr(layer, "get_max_length", None)
            max_length = None
            if callable(get_max_length):
                try:
                    max_length = int(get_max_length())
                except (TypeError, ValueError, RuntimeError):
                    pass
            is_static = max_length is not None and max_length > 0 and physical_tokens >= max_length
            if is_static:
                # StaticCache owns a fixed-capacity tensor.  Keep the capacity and
                # move only the logical length; generation will overwrite the tail.
                self._set_cache_layer_length(layer, target_tokens)
            else:
                layer.keys = self._trim_tensor(keys, target_tokens)
                layer.values = self._trim_tensor(values, target_tokens)
                self._set_cache_layer_length(layer, target_tokens)

            indexer_keys = getattr(layer, "indexer_keys", None)
            if (
                not is_static
                and isinstance(indexer_keys, torch.Tensor)
                and indexer_keys.ndim >= 2
            ):
                layer.indexer_keys = indexer_keys[:, :target_tokens, ...]
            return True

        trim = getattr(layer, "trim", None)
        if callable(trim):
            trim(tokens)
            return True
        crop = getattr(layer, "crop", None)
        if callable(crop):
            # Transformers 5.x uses a negative value for the number of tokens
            # to remove; the positive absolute-length form is deprecated.
            crop(-tokens)
            return True
        return False

    def _trim_cache_sequence(self, prompt_cache: Any, target_tokens: int) -> Any:
        if isinstance(prompt_cache, torch.Tensor):
            return self._trim_tensor(prompt_cache, target_tokens)
        if isinstance(prompt_cache, tuple):
            return tuple(
                self._trim_cache_sequence(item, target_tokens)
                for item in prompt_cache
            )
        if isinstance(prompt_cache, list):
            return [
                self._trim_cache_sequence(item, target_tokens)
                for item in prompt_cache
            ]
        return prompt_cache

    def trim_cache(self, prompt_cache: Any, tokens: int) -> Any:
        """Remove trailing tokens from a Transformers KV cache.

        Legacy tuple caches are immutable and therefore returned as a trimmed
        copy.  Transformers ``Cache`` instances are trimmed in place and are
        returned for callers that use the same code path for both layouts.
        """
        tokens = int(tokens)
        if tokens < 0:
            raise ValueError("tokens to trim must be non-negative")
        if tokens == 0:
            return prompt_cache

        current_tokens = self.get_cache_offset(prompt_cache)
        target_tokens = max(0, current_tokens - tokens)
        if target_tokens == current_tokens:
            return prompt_cache

        if isinstance(prompt_cache, (torch.Tensor, tuple, list)):
            return self._trim_cache_sequence(prompt_cache, target_tokens)

        layers = getattr(prompt_cache, "layers", None)
        if layers is not None:
            cache_crop = getattr(prompt_cache, "crop", None)
            requires_cache_crop = any(
                (
                    not callable(getattr(layer, "trim", None))
                    and not callable(getattr(layer, "crop", None))
                    and (
                        not (
                            isinstance(getattr(layer, "keys", None), torch.Tensor)
                            and isinstance(getattr(layer, "values", None), torch.Tensor)
                        )
                        or hasattr(layer, "conv_states")
                        or hasattr(layer, "recurrent_states")
                    )
                )
                for layer in layers
            )
            if requires_cache_crop:
                if not callable(cache_crop):
                    raise ValueError(
                        "Unsupported Transformers cache layer for trimming"
                    )
                # Transformers 5.x interprets a negative value as the number
                # of tokens to remove.
                cache_crop(-tokens)
                self._update_registered_cache_offset(prompt_cache, target_tokens)
                return prompt_cache

            for layer in layers:
                layer_tokens = self._cache_offset_from_value(layer)
                if layer_tokens <= 0:
                    continue
                self._trim_cache_layer(
                    layer,
                    max(0, layer_tokens - tokens),
                    tokens,
                )
            self._update_registered_cache_offset(prompt_cache, target_tokens)
            return prompt_cache

        crop = getattr(prompt_cache, "crop", None)
        if callable(crop):
            crop(-tokens)
            self._update_registered_cache_offset(prompt_cache, target_tokens)
            return prompt_cache
        raise ValueError(f"Unsupported Transformers cache: {type(prompt_cache).__name__}")

    def cache_prefill(
        self,
        cache_path: str,
        prompt: str,
        base_cache_path: str | None = None,
        trim_to_tokens: int | None = None,
        prefix_offsets: list[int] | None = None,
        prefix_hashes: list[str] | None = None,
        images: list | None = None,
        max_image_size: int = 768,
    ) -> dict:
        """Prefill and persist a Transformers KV cache.

        ``memory://`` refs retain the Phase 1 process-local behavior.  Other
        refs use the backend-owned ``pytorch_kv_v1`` disk layout.
        """
        if images:
            raise ValueError("TransformersLmBackend does not support vision input")
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")
        if trim_to_tokens is not None and trim_to_tokens < 0:
            raise ValueError("trim_to_tokens must be non-negative")
        if base_cache_path is None and trim_to_tokens is not None:
            raise ValueError("trim_to_tokens requires base_cache_path")

        token_ids = self.tokenize_prompt(prompt)
        if not token_ids:
            raise ValueError("Cannot prefill an empty prompt")

        prompt_cache = None
        cache_offset = 0
        cache_write_tokens = len(token_ids)
        if base_cache_path is not None:
            base_cache = self.load_cache_from_file(
                base_cache_path,
                prompt=token_ids,
            )
            if base_cache is not None:
                prompt_cache = self._clone_cache(base_cache)
                cache_offset = self.get_cache_offset(base_cache)
                if trim_to_tokens is not None and cache_offset > trim_to_tokens:
                    prompt_cache = self.trim_cache(
                        prompt_cache,
                        cache_offset - trim_to_tokens,
                    )
                    cache_offset = trim_to_tokens
                else:
                    cloned_offset = self.get_cache_offset(prompt_cache)
                    if cloned_offset > 0:
                        cache_offset = cloned_offset

                if cache_offset <= 0:
                    prompt_cache = None
                    cache_offset = 0
                elif cache_offset >= len(token_ids):
                    cache_write_tokens = 0

        if prompt_cache is None:
            input_token_ids = token_ids
            model_kwargs: dict[str, Any] = {"use_cache": True}
            cache_offset = 0
        elif cache_offset >= len(token_ids):
            input_token_ids = []
            model_kwargs = {}
        else:
            input_token_ids = token_ids[cache_offset:]
            cache_write_tokens = len(input_token_ids)
            model_kwargs = {
                "use_cache": True,
                "past_key_values": prompt_cache,
                "attention_mask": torch.ones(
                    (1, len(token_ids)),
                    dtype=torch.long,
                    device=self._device,
                ),
            }
            if self._supports_model_kwarg("cache_position"):
                model_kwargs["cache_position"] = torch.arange(
                    cache_offset,
                    cache_offset + len(input_token_ids),
                    dtype=torch.long,
                    device=self._device,
                )

        if input_token_ids:
            input_ids = torch.tensor(
                [input_token_ids],
                dtype=torch.long,
                device=self._device,
            )
            with torch.no_grad():
                outputs = self.model(input_ids=input_ids, **model_kwargs)

            past_key_values = getattr(outputs, "past_key_values", None)
            if past_key_values is None and isinstance(outputs, (tuple, list)) and len(outputs) > 1:
                past_key_values = outputs[1]
            if past_key_values is None:
                raise RuntimeError("Transformers model did not return past_key_values")
            prompt_cache = past_key_values

        if prompt_cache is None:
            raise RuntimeError("Transformers model did not return past_key_values")

        token_count = len(token_ids)
        cache_path = os.fspath(cache_path)
        self._caches[cache_path] = prompt_cache
        self._cache_token_counts[cache_path] = token_count
        self._cache_token_ids[cache_path] = tuple(token_ids)
        self._cache_write_token_counts[cache_path] = cache_write_tokens

        if not self._is_memory_cache_path(cache_path):
            payload = {
                "layout": self.CACHE_LAYOUT,
                "cache": self._serialize_cache(prompt_cache),
                "token_ids": torch.tensor(token_ids, dtype=torch.long),
            }
            self._atomic_torch_save(payload, cache_path)
            self._write_cache_meta(
                cache_path,
                token_count,
                prefix_offsets,
                prefix_hashes,
            )
        else:
            self._cache_meta[cache_path] = self._cache_meta_for(
                token_count,
                prefix_offsets,
                prefix_hashes,
            )

        return {
            "cache_path": cache_path,
            "token_count": token_count,
            "cache_write_tokens": cache_write_tokens,
        }

    def consume_cache_write_tokens(self, cache_path: str) -> int:
        """Attribute each prefill write to the first generate using the cache."""
        return self._cache_write_token_counts.pop(cache_path, 0)

    def load_cache_from_file(
        self,
        cache_path: str,
        images: list | None = None,
        max_image_size: int = 768,
        prompt: str | list[int] | None = None,
    ) -> Any | None:
        """Load a process-local or ``pytorch_kv_v1`` disk cache."""
        if images:
            sys.stderr.write(
                f"PyTorch cache does not support vision input: {cache_path}\n"
            )
            return None

        cache_path = os.fspath(cache_path)

        prompt_cache = self._caches.get(cache_path)
        if prompt_cache is None and not self._is_memory_cache_path(cache_path):
            return self._load_disk_cache(cache_path, prompt=prompt)
        if prompt_cache is None:
            sys.stderr.write(f"PyTorch cache not found in this process: {cache_path}\n")
            return None

        cached_token_ids = self._cache_token_ids.get(cache_path)
        if cached_token_ids is not None and not self._prompt_matches_cache(
            prompt,
            cached_token_ids,
        ):
            sys.stderr.write(f"PyTorch cache prompt prefix mismatch: {cache_path}\n")
            return None
        return prompt_cache

    def stream_generate(
        self,
        prompt: str | list[int],
        options: dict,
        images: list | None = None,
        prompt_cache: Any | None = None,
    ) -> Iterator[StreamChunk]:
        if images:
            raise ValueError("TransformersLmBackend does not support vision input")
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        final_options = {"max_tokens": 256, **options}
        max_new_tokens = int(final_options.pop("max_tokens", 256))
        temperature = float(final_options.pop("temperature", 1.0))
        top_p = final_options.pop("top_p", None)
        top_k = final_options.pop("top_k", None)

        if isinstance(prompt, list):
            token_ids = [int(token_id) for token_id in prompt]
        else:
            token_ids = self.tokenize_prompt(prompt)
        if not token_ids:
            raise ValueError("Cannot generate from an empty prompt")

        input_ids = torch.tensor([token_ids], dtype=torch.long, device=self._device)
        prompt_token_count = len(token_ids)
        cache_read_tokens = 0

        do_sample = temperature > 0
        gen_kwargs: dict[str, Any] = {
            "input_ids": input_ids,
            "max_new_tokens": max_new_tokens,
            "do_sample": do_sample,
        }
        if do_sample:
            gen_kwargs["temperature"] = temperature
        if top_p is not None:
            gen_kwargs["top_p"] = float(top_p)
        if top_k is not None:
            gen_kwargs["top_k"] = int(top_k)
        if prompt_cache is not None:
            cache_read_tokens = self.get_cache_offset(prompt_cache)
            gen_kwargs["past_key_values"] = self._clone_cache(prompt_cache)
            gen_kwargs["attention_mask"] = torch.ones(
                (1, cache_read_tokens + prompt_token_count),
                dtype=torch.long,
                device=self._device,
            )
            if self._supports_model_kwarg("cache_position"):
                gen_kwargs["cache_position"] = torch.arange(
                    cache_read_tokens,
                    cache_read_tokens + prompt_token_count,
                    dtype=torch.long,
                    device=self._device,
                )

        streamer = _TokenCountingTextIteratorStreamer(
            self.tokenizer,
            skip_special_tokens=True,
            skip_prompt=True,
        )
        gen_kwargs["streamer"] = streamer

        thread = Thread(target=self.model.generate, kwargs=gen_kwargs)
        thread.start()

        first_chunk = True
        for text, generation_tokens in streamer:
            chunk = StreamChunk(
                text=text,
                prompt_tokens=(prompt_token_count + cache_read_tokens)
                if first_chunk
                else None,
                generation_tokens=generation_tokens,
                cache_read_tokens=cache_read_tokens if first_chunk else None,
            )
            first_chunk = False
            if is_eod_token(chunk, self.tokenizer):
                chunk.finish_reason = "stop"
                yield chunk
                break
            yield chunk

        thread.join()

    def supports_vision(self) -> bool:
        return False

    @property
    def model_kind(self) -> str:
        return "lm"
