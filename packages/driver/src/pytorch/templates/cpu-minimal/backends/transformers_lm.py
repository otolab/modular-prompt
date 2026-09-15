from __future__ import annotations

import copy
import os
import sys
from dataclasses import dataclass
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

    def __init__(self, device: str | None = None) -> None:
        self.model: Any | None = None
        self.tokenizer: Any | None = None
        self._device_name = device or os.environ.get("PYTORCH_DEVICE", "cpu")
        self._device = torch.device(self._device_name)
        self._caches: dict[str, Any] = {}
        self._cache_token_counts: dict[str, int] = {}
        self._cache_token_ids: dict[str, tuple[int, ...]] = {}
        self._cache_write_token_counts: dict[str, int] = {}

    def load(self, model_name: str) -> None:
        self._caches.clear()
        self._cache_token_counts.clear()
        self._cache_token_ids.clear()
        self._cache_write_token_counts.clear()

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
        if hasattr(prompt_cache, "keys") and hasattr(prompt_cache, "values"):
            try:
                cloned_layer = copy.copy(prompt_cache)
                cloned_layer.keys = TransformersLmBackend._clone_cache(prompt_cache.keys)
                cloned_layer.values = TransformersLmBackend._clone_cache(prompt_cache.values)
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

    def get_cache_offset(self, prompt_cache: Any) -> int:
        """Return the token count represented by a Transformers cache."""
        for cache_path, cached in self._caches.items():
            if cached is prompt_cache:
                return self._cache_token_counts.get(cache_path, 0)

        get_seq_length = getattr(prompt_cache, "get_seq_length", None)
        if callable(get_seq_length):
            try:
                return int(get_seq_length())
            except Exception:
                pass

        if isinstance(prompt_cache, (list, tuple)):
            for layer in prompt_cache:
                if isinstance(layer, (list, tuple)) and layer:
                    key = layer[0]
                else:
                    key = layer
                shape = getattr(key, "shape", None)
                if shape is not None and len(shape) >= 2:
                    return int(shape[-2])
        return super().get_cache_offset(prompt_cache)

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
        """Prefill and retain a Transformers KV cache in this process.

        ``cache_path`` is an opaque process-local reference in Phase 1.  No
        file is created; persistence and incremental prefill belong to Phase 2.
        """
        if images:
            raise ValueError("TransformersLmBackend does not support vision input")
        if base_cache_path is not None or trim_to_tokens is not None:
            raise ValueError(
                "TransformersLmBackend does not support incremental prefill in Phase 1"
            )
        if prefix_offsets is not None or prefix_hashes is not None:
            raise ValueError(
                "TransformersLmBackend does not support cache prefix metadata in Phase 1"
            )
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        token_ids = self.tokenize_prompt(prompt)
        if not token_ids:
            raise ValueError("Cannot prefill an empty prompt")

        input_ids = torch.tensor([token_ids], dtype=torch.long, device=self._device)
        with torch.no_grad():
            outputs = self.model(input_ids=input_ids, use_cache=True)

        past_key_values = getattr(outputs, "past_key_values", None)
        if past_key_values is None and isinstance(outputs, (tuple, list)) and len(outputs) > 1:
            past_key_values = outputs[1]
        if past_key_values is None:
            raise RuntimeError("Transformers model did not return past_key_values")

        self._caches[cache_path] = past_key_values
        self._cache_token_counts[cache_path] = len(token_ids)
        self._cache_token_ids[cache_path] = tuple(token_ids)
        self._cache_write_token_counts[cache_path] = len(token_ids)
        return {
            "cache_path": cache_path,
            "token_count": len(token_ids),
            "cache_write_tokens": len(token_ids),
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
        """Resolve a process-local cache reference; disk loading is Phase 2."""
        if images:
            sys.stderr.write(
                f"PyTorch cache does not support vision input: {cache_path}\n"
            )
            return None

        prompt_cache = self._caches.get(cache_path)
        if prompt_cache is None:
            sys.stderr.write(f"PyTorch cache not found in this process: {cache_path}\n")
            return None

        cached_token_ids = self._cache_token_ids.get(cache_path)
        if cached_token_ids is not None and isinstance(prompt, (str, list)):
            current_token_ids = (
                self.tokenize_prompt(prompt)
                if isinstance(prompt, str)
                else [int(token_id) for token_id in prompt]
            )
            if (
                len(current_token_ids) < len(cached_token_ids)
                or tuple(current_token_ids[: len(cached_token_ids)]) != cached_token_ids
            ):
                sys.stderr.write(
                    f"PyTorch cache prompt prefix mismatch: {cache_path}\n"
                )
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
            gen_kwargs["cache_position"] = torch.arange(
                cache_read_tokens,
                cache_read_tokens + prompt_token_count,
                dtype=torch.long,
                device=self._device,
            )
            gen_kwargs["attention_mask"] = torch.ones(
                (1, cache_read_tokens + prompt_token_count),
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
