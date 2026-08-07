import os
import sys

from backends import TransformersLmBackend
from server import Server
from utils.token_utils import get_capabilities

model_name = sys.argv[1] if len(sys.argv) > 1 else "gpt2"
device = os.environ.get("PYTORCH_DEVICE", "cpu")

if __name__ == "__main__":
    backend = TransformersLmBackend(device=device)
    backend.load(model_name)

    capabilities = get_capabilities(backend.get_tokenizer())
    capabilities["model_kind"] = "lm"

    server = Server(backend, capabilities)
    server.run()
