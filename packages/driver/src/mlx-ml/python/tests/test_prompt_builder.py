from utils.prompt_builder import supports_chat_template, generate_merged_prompt


class _FakeTokenizer:
    def __init__(self, has_method=True, has_template=True, template_value="template"):
        if has_method:
            self.apply_chat_template = lambda *a, **kw: ""
        if has_template:
            self.chat_template = template_value


class TestSupportsChatTemplate:
    def test_all_present(self):
        assert supports_chat_template(_FakeTokenizer()) is True

    def test_no_method(self):
        assert supports_chat_template(_FakeTokenizer(has_method=False)) is False

    def test_no_template_attr(self):
        assert supports_chat_template(_FakeTokenizer(has_template=False)) is False

    def test_template_none(self):
        assert supports_chat_template(_FakeTokenizer(template_value=None)) is False

    def test_plain_object(self):
        assert supports_chat_template(object()) is False


class TestGenerateMergedPrompt:
    def test_html_fallback(self):
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]
        result = generate_merged_prompt(messages, {"special_tokens": {}})
        assert "<!-- begin of USER -->" in result
        assert "Hello" in result
        assert "<!-- end of USER -->" in result
        assert "<!-- begin of ASSISTANT -->" in result
        assert "Hi" in result

    def test_role_specific_tokens(self):
        caps = {
            "special_tokens": {
                "user": {
                    "start": {"text": "<|user|>"},
                    "end": {"text": "<|/user|>"},
                },
            }
        }
        messages = [{"role": "user", "content": "Hello"}]
        result = generate_merged_prompt(messages, caps)
        assert "<|user|>" in result
        assert "Hello" in result
        assert "<|/user|>" in result
        assert "<!-- begin" not in result

    def test_block_token_fallback(self):
        caps = {
            "special_tokens": {
                "context": {
                    "start": {"text": "<|context|>"},
                    "end": {"text": "<|/context|>"},
                },
            }
        }
        messages = [{"role": "system", "content": "Instructions"}]
        result = generate_merged_prompt(messages, caps)
        assert "<|context|>SYSTEM:" in result
        assert "Instructions" in result
        assert "<|/context|>" in result

    def test_strips_whitespace(self):
        messages = [{"role": "user", "content": "  padded  "}]
        result = generate_merged_prompt(messages, {"special_tokens": {}})
        assert "padded" in result
        assert "  padded  " not in result

    def test_empty_capabilities(self):
        messages = [{"role": "user", "content": "Hi"}]
        result = generate_merged_prompt(messages, {})
        assert "<!-- begin of USER -->" in result
