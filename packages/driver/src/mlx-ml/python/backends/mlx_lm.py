from __future__ import annotations

import json
import sys
from typing import Any, Iterator

from mlx_lm import load as mlx_lm_load
from mlx_lm import stream_generate as mlx_lm_stream_generate
from mlx_lm.models.cache import make_prompt_cache, save_prompt_cache, load_prompt_cache
from mlx_lm.sample_utils import make_sampler

from backends.base import ModelBackend
from utils.token_utils import is_eod_token


class MlxLmBackend(ModelBackend):
    """`mlx_lm` backend for text-only models."""

    def __init__(self) -> None:
        self.model: Any | None = None
        self.tokenizer: Any | None = None

    def load(self, model_name: str) -> None:
        self.model, self.tokenizer = mlx_lm_load(model_name)

    def get_tokenizer(self) -> Any:
        return self.tokenizer

    def stream_generate(
        self,
        prompt: str | list[int],
        options: dict,
        images: list | None = None,
        prompt_cache: list | None = None,
    ) -> Iterator[Any]:
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        final_options = {"max_tokens": 1000, **options}
        temperature = final_options.pop("temperature", 1.0)
        top_p = final_options.pop("top_p", 0.0)
        top_k = final_options.pop("top_k", 0)
        final_options["sampler"] = make_sampler(
            temp=temperature,
            top_p=top_p,
            top_k=top_k,
        )

        if prompt_cache is not None:
            final_options["prompt_cache"] = prompt_cache

        for response in mlx_lm_stream_generate(
            self.model,
            self.tokenizer,
            prompt,
            **final_options,
        ):
            if is_eod_token(response, self.tokenizer):
                break
            yield response

    def _get_cache_offset(self, prompt_cache: list) -> int:
        """Get the number of tokens stored in a loaded prompt cache."""
        if not prompt_cache:
            return 0
        layer0 = prompt_cache[0]
        if hasattr(layer0, 'offset'):
            off = layer0.offset
            return int(off.item() if hasattr(off, 'item') else off)
        if hasattr(layer0, 'caches'):
            for c in layer0.caches:
                if hasattr(c, 'offset'):
                    off = c.offset
                    return int(off.item() if hasattr(off, 'item') else off)
        try:
            return int(layer0[0].shape[2])
        except Exception:
            pass
        if hasattr(layer0, 'keys') and layer0.keys is not None:
            return int(layer0.keys.shape[2])
        return 0

    def _tokenize_prompt(self, prompt: str) -> list[int]:
        """Tokenize a prompt string using the same logic as stream_generate."""
        add_special = self.tokenizer.bos_token is None or not prompt.startswith(
            self.tokenizer.bos_token
        )
        return self.tokenizer.encode(prompt, add_special_tokens=add_special)

    @staticmethod
    def _write_cache_meta(cache_path: str, token_count: int) -> None:
        meta_path = cache_path + '.meta.json'
        try:
            with open(meta_path, 'w') as f:
                json.dump({"token_count": token_count}, f)
        except Exception as e:
            sys.stderr.write(f"Failed to write cache meta: {e}\n")

    @staticmethod
    def _read_cache_meta(cache_path: str) -> int | None:
        meta_path = cache_path + '.meta.json'
        try:
            with open(meta_path) as f:
                meta = json.load(f)
                count = meta.get('token_count')
                return int(count) if count is not None else None
        except (FileNotFoundError, json.JSONDecodeError, ValueError, TypeError):
            return None

    def cache_prefill(self, cache_path: str, prompt: str, base_cache_path: str | None = None) -> dict:
        if self.model is None or self.tokenizer is None:
            raise RuntimeError("Model is not loaded")

        full_tokens = self._tokenize_prompt(prompt)
        token_count = len(full_tokens)
        effective_prompt: str | list[int] = prompt

        if base_cache_path is not None:
            try:
                prompt_cache = load_prompt_cache(base_cache_path)
                cache_offset = self._read_cache_meta(base_cache_path) or 0

                if cache_offset > 0:
                    if cache_offset < token_count:
                        effective_prompt = full_tokens[cache_offset:]
                        sys.stderr.write(
                            f"Incremental prefill from: {base_cache_path} "
                            f"(skip {cache_offset}/{token_count} tokens)\n"
                        )
                    else:
                        sys.stderr.write(
                            f"Base cache covers entire prompt "
                            f"({cache_offset} >= {token_count}), saving as-is\n"
                        )
                        save_prompt_cache(cache_path, prompt_cache)
                        self._write_cache_meta(cache_path, token_count)
                        return {"cache_path": cache_path, "token_count": token_count}
                else:
                    sys.stderr.write(f"Incremental prefill from: {base_cache_path}\n")
            except Exception as e:
                sys.stderr.write(f"Base cache load failed, creating fresh: {e}\n")
                prompt_cache = make_prompt_cache(self.model)
        else:
            prompt_cache = make_prompt_cache(self.model)

        sys.stderr.write(f"Prefill prompt: {token_count} tokens\n")

        for _ in mlx_lm_stream_generate(
            self.model, self.tokenizer, effective_prompt,
            prompt_cache=prompt_cache, max_tokens=1,
        ):
            break

        save_prompt_cache(cache_path, prompt_cache)
        self._write_cache_meta(cache_path, token_count)
        sys.stderr.write(f"Cache created: {cache_path} ({token_count} tokens)\n")
        return {"cache_path": cache_path, "token_count": token_count}

    def load_cache_from_file(self, cache_path: str) -> list | None:
        try:
            return load_prompt_cache(cache_path)
        except FileNotFoundError:
            sys.stderr.write(f"Cache file not found: {cache_path}\n")
            return None
        except Exception as e:
            sys.stderr.write(f"Failed to load cache: {e}\n")
            return None

    def supports_vision(self) -> bool:
        return False

    @property
    def model_kind(self) -> str:
        return "lm"
