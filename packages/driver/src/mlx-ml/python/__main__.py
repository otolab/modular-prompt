import sys

from backends import MlxLmBackend, MlxVlmBackend
from utils.token_utils import get_capabilities
from utils.vlm_utils import detect_model_kind
from server import Server

model_name = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/gemma-3-270m-it-qat-4bit"
text_only = "--text-only" in sys.argv


def create_backend(model_name: str, text_only: bool = False):
    model_kind = "lm" if text_only else detect_model_kind(model_name)

    if model_kind == "vlm":
        backend = MlxVlmBackend()
        try:
            backend.load(model_name)
            return backend, "vlm"
        except (ValueError, Exception) as e:
            sys.stderr.write(f"VLM load failed, falling back to LM: {e}\n")

    backend = MlxLmBackend()
    backend.load(model_name)
    return backend, "lm"


if __name__ == "__main__":
    backend, model_kind = create_backend(model_name, text_only)

    capabilities = get_capabilities(backend.get_tokenizer())
    capabilities["model_kind"] = model_kind

    server = Server(backend, capabilities)
    server.run()
