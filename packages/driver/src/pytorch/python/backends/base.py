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
        prompt_cache: list | None = None,
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
    ) -> dict:
        """Build a KV cache from a prompt prefix."""
        raise NotImplementedError(
            f"{type(self).__name__} does not support prompt caching"
        )

    def load_cache_from_file(self, cache_path: str) -> list | None:
        """Load a prompt cache from file, or None."""
        return None

    def get_cache_offset(self, prompt_cache: list) -> int:
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
