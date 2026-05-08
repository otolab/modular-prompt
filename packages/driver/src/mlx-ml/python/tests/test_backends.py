from backends.base import ModelBackend


class TestModelBackendInterface:
    def test_cannot_instantiate(self):
        try:
            ModelBackend()
            assert False, "Should not be able to instantiate ABC"
        except TypeError:
            pass

    def test_subclass_must_implement_all(self):
        class Incomplete(ModelBackend):
            pass

        try:
            Incomplete()
            assert False, "Should not instantiate incomplete subclass"
        except TypeError:
            pass

    def test_complete_subclass(self):
        class Complete(ModelBackend):
            def load(self, model_name): pass
            def get_tokenizer(self): return None
            def stream_generate(self, prompt, options, images=None): yield from []
            def supports_vision(self): return False
            @property
            def model_kind(self): return "lm"

        backend = Complete()
        assert backend.model_kind == "lm"
        assert backend.supports_vision() is False
        assert list(backend.stream_generate("test", {})) == []
