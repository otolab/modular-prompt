"""Helpful errors for model architectures not supported by the runtime."""

import re


MIN_TRANSFORMERS_VERSION = "5.14.0"

_MODEL_TYPE_MESSAGE = re.compile(
    r"model type [`'\"](?P<model_type>[A-Za-z0-9_.-]+)[`'\"]",
    re.IGNORECASE,
)
_MODEL_TYPE_KEY = re.compile(r"[A-Za-z][A-Za-z0-9_.-]*")


def extract_unsupported_model_type(error: BaseException) -> str | None:
    """Extract a model type from Transformers' unknown-architecture errors.

    Transformers normally raises ``ValueError`` with a message containing the
    model type.  Older releases can leak the registry ``KeyError`` instead,
    so handle that form as well while leaving unrelated errors untouched.
    """

    match = _MODEL_TYPE_MESSAGE.search(str(error))
    if match:
        return match.group("model_type")

    if isinstance(error, KeyError) and len(error.args) == 1:
        candidate = error.args[0]
        if (
            isinstance(candidate, str)
            and candidate != "model_type"
            and _MODEL_TYPE_KEY.fullmatch(candidate)
        ):
            return candidate

    return None


def unsupported_model_type_error(
    model_name: str,
    model_type: str,
    transformers_version: str,
) -> RuntimeError:
    """Build the actionable load error shown to PyTorch runtime users."""

    return RuntimeError(
        f"Cannot load model '{model_name}': Transformers does not recognize "
        f"model_type '{model_type}'. The PyTorch runtime is using transformers "
        f"{transformers_version}, but this model requires transformers>="
        f"{MIN_TRANSFORMERS_VERSION}. Run `setup-pytorch` again after updating "
        "@modular-prompt/driver. If the runtime already has a Python project, "
        "update its transformers requirement and run "
        "`modular-prompt-runtime sync pytorch`."
    )
