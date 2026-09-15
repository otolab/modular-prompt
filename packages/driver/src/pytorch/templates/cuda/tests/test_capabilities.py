from utils.token_utils import get_capabilities


class _Tokenizer:
    apply_chat_template = None
    chat_template = None
    special_tokens_map = {}
    added_tokens_encoder = {}


def test_capabilities_advertise_cache_prefill():
    capabilities = get_capabilities(_Tokenizer())

    assert "cache_prefill" in capabilities["methods"]
