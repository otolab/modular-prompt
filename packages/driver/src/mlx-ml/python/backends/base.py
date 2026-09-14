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

    def tokenize_prompt(self, prompt: str) -> list[int]:
        """Tokenize a rendered prompt using this backend's prompt rules.

        A VLM backend returns a processor from ``get_tokenizer()``.  Keeping
        this operation on the backend prevents shared handlers from assuming
        that the returned object is a plain tokenizer.
        """
        tokenizer = self.get_tokenizer()
        tokenizer = getattr(tokenizer, "tokenizer", tokenizer)
        bos_token = getattr(tokenizer, "bos_token", None)
        add_special = bos_token is None or not prompt.startswith(bos_token or "")
        return list(tokenizer.encode(prompt, add_special_tokens=add_special))

    def trim_cache(self, prompt_cache: list, tokens: int) -> None:
        """Trim a backend-owned prompt cache in place.

        Cache implementations are backend-specific.  The default handles the
        cache objects exposed by mlx-vlm without importing mlx-lm into the
        shared generate handler.
        """
        if tokens <= 0:
            return

        for entry in prompt_cache:
            trim = getattr(entry, "trim", None)
            if callable(trim):
                trim(tokens)
                continue

            children = getattr(entry, "caches", None)
            if children is not None:
                for child in children:
                    child_trim = getattr(child, "trim", None)
                    if callable(child_trim):
                        child_trim(tokens)

    def load_cache_from_file(self, cache_path: str) -> list | None:
        """Load a prompt cache from file, or None."""
        return None

    def get_cache_offset(self, prompt_cache: list) -> int:
        """Get the number of tokens stored in a loaded prompt cache."""
        if not prompt_cache:
            return 0

        def offset_of(cache: Any) -> int:
            if hasattr(cache, "offset"):
                off = cache.offset
                return int(off.item() if hasattr(off, "item") else off)

            size = getattr(cache, "size", None)
            if callable(size):
                try:
                    return int(size())
                except Exception:
                    pass

            children = getattr(cache, "caches", None)
            if children is not None:
                return max((offset_of(child) for child in children), default=0)

            keys = getattr(cache, "keys", None)
            if keys is not None:
                try:
                    return int(keys.shape[-2])
                except Exception:
                    pass

            try:
                return int(cache[0].shape[2])
            except Exception:
                return 0

        return max((offset_of(layer) for layer in prompt_cache), default=0)
