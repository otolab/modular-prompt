from abc import ABC, abstractmethod
from typing import Any, Iterator


class ModelBackend(ABC):
    """Abstract base class for model backends."""

    @abstractmethod
    def load(self, model_name: str) -> None:
        """Load the target model."""
        raise NotImplementedError

    @abstractmethod
    def get_tokenizer(self) -> Any:
        """Return the tokenizer or processor."""
        raise NotImplementedError

    @abstractmethod
    def stream_generate(
        self, prompt: str | list[int], options: dict, images: list | None = None,
        prompt_cache: Any | None = None,
    ) -> Iterator[Any]:
        """Stream generation results."""
        raise NotImplementedError

    @abstractmethod
    def supports_vision(self) -> bool:
        """Return whether image input is supported."""
        raise NotImplementedError

    @property
    @abstractmethod
    def model_kind(self) -> str:
        """Return "lm" or "vlm"."""
        raise NotImplementedError

    def load_drafter(self, drafter_model: str) -> None:
        """Load a drafter model for speculative decoding."""
        raise NotImplementedError(
            f"{type(self).__name__} does not support drafter models"
        )

    def has_drafter(self) -> bool:
        """Return whether a drafter model is loaded."""
        return False

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
        """Build a KV cache from a prompt prefix."""
        raise NotImplementedError(
            f"{type(self).__name__} does not support prompt caching"
        )

    def consume_cache_write_tokens(self, cache_path: str) -> int:
        """Return and clear write usage pending for a cache reference."""
        return 0

    def tokenize_prompt(
        self,
        prompt: str,
        images: list | None = None,
        max_image_size: int = 768,
    ) -> list[int]:
        """Tokenize a rendered prompt using the backend's prompt rules."""
        tokenizer = self.get_tokenizer()
        bos_token = getattr(tokenizer, "bos_token", None)
        add_special = bos_token is None or not prompt.startswith(bos_token or "")
        token_ids = tokenizer.encode(prompt, add_special_tokens=add_special)
        if hasattr(token_ids, "flatten"):
            token_ids = token_ids.flatten().tolist()
        return [int(token_id) for token_id in token_ids]

    def load_cache_from_file(
        self,
        cache_path: str,
        images: list | None = None,
        max_image_size: int = 768,
        prompt: str | list[int] | None = None,
    ) -> Any | None:
        """Load a prompt cache, or return None when it is unavailable."""
        return None

    def get_cache_offset(self, prompt_cache: Any) -> int:
        """Get the number of tokens stored in a loaded prompt cache."""
        if not prompt_cache:
            return 0

        get_seq_length = getattr(prompt_cache, "get_seq_length", None)
        if callable(get_seq_length):
            try:
                return int(get_seq_length())
            except Exception:
                pass

        keys = getattr(prompt_cache, "keys", None)
        if keys is not None:
            try:
                return int(keys.shape[-2])
            except Exception:
                pass

        layers = getattr(prompt_cache, "layers", None)
        if layers:
            return self.get_cache_offset(layers[0])

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
            key = layer0[0] if isinstance(layer0, (list, tuple)) else layer0
            shape = key.shape
            return int(shape[-2] if len(shape) >= 2 else shape[0])
        except Exception:
            pass
        if hasattr(layer0, 'keys') and layer0.keys is not None:
            return int(layer0.keys.shape[-2])
        return 0
