from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Thread
from typing import Any, Iterator

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

from backends.base import ModelBackend
from utils.token_utils import is_eod_token


@dataclass
class StreamChunk:
    text: str
    prompt_tokens: int | None = None
    generation_tokens: int | None = None
    finish_reason: str | None = None


class TransformersLmBackend(ModelBackend):
    """Transformers causal LM backend (text-only, CPU-first)."""

    def __init__(self, device: str | None = None) -> None:
        self.model: Any | None = None
        self.tokenizer: Any | None = None
        self._device_name = device or os.environ.get("PYTORCH_DEVICE", "cpu")
        self._device = torch.device(self._device_name)

    def load(self, model_name: str) -> None:
        trust_remote_code = os.environ.get("PYTORCH_TRUST_REMOTE_CODE", "").lower() in (
            "1",
            "true",
            "yes",
        )
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
            torch_dtype=dtype,
        )
        self.model.to(self._device)
        self.model.eval()

    def get_tokenizer(self) -> Any:
        return self.tokenizer

    def stream_generate(
        self,
        prompt: str | list[int],
        options: dict,
        images: list | None = None,
        prompt_cache: list | None = None,
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
            input_ids = torch.tensor([prompt], device=self._device)
            prompt_token_count = len(prompt)
        else:
            encoded = self.tokenizer(prompt, return_tensors="pt")
            input_ids = encoded["input_ids"].to(self._device)
            prompt_token_count = int(input_ids.shape[-1])

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

        streamer = TextIteratorStreamer(
            self.tokenizer,
            skip_special_tokens=True,
            skip_prompt=True,
        )
        gen_kwargs["streamer"] = streamer

        thread = Thread(target=self.model.generate, kwargs=gen_kwargs)
        thread.start()

        generation_tokens = 0
        for text in streamer:
            generation_tokens += 1
            chunk = StreamChunk(
                text=text,
                prompt_tokens=prompt_token_count if generation_tokens == 1 else None,
                generation_tokens=generation_tokens if generation_tokens == 1 else None,
            )
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
