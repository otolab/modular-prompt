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
        self, prompt: str | list[int], options: dict, images: list | None = None
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
