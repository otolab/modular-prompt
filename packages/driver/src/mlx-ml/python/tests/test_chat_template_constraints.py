from utils.chat_template_constraints import _infer_restrictions_from_results


class TestInferRestrictions:
    def test_no_restrictions(self):
        results = {
            "basic": {"success": True},
            "with-system": {"success": True},
            "multi-system": {"success": True},
            "consecutive-user": {"success": True},
            "assistant-last": {"success": True},
            "empty-message": {"success": True},
        }
        assert _infer_restrictions_from_results(results) is None

    def test_system_not_supported(self):
        results = {
            "with-system": {"error": "system not supported"},
            "multi-system": {"error": "system not supported"},
        }
        r = _infer_restrictions_from_results(results)
        assert r["max_system_messages"] == 0
        assert "single_system_at_start" not in r

    def test_single_system_only(self):
        results = {
            "with-system": {"success": True},
            "multi-system": {"error": "only one system allowed"},
        }
        r = _infer_restrictions_from_results(results)
        assert r["single_system_at_start"] is True
        assert r["max_system_messages"] == 1

    def test_alternating_turns(self):
        results = {
            "consecutive-user": {"error": "must alternate"},
        }
        r = _infer_restrictions_from_results(results)
        assert r["alternating_turns"] is True

    def test_requires_user_last(self):
        results = {
            "assistant-last": {"error": "must end with user"},
        }
        r = _infer_restrictions_from_results(results)
        assert r["requires_user_last"] is True

    def test_empty_messages_disallowed(self):
        results = {
            "empty-message": {"error": "empty not allowed"},
        }
        r = _infer_restrictions_from_results(results)
        assert r["allow_empty_messages"] is False

    def test_combined_restrictions(self):
        results = {
            "with-system": {"success": True},
            "multi-system": {"error": "only one"},
            "consecutive-user": {"error": "must alternate"},
            "assistant-last": {"error": "no"},
            "empty-message": {"success": True},
        }
        r = _infer_restrictions_from_results(results)
        assert r["single_system_at_start"] is True
        assert r["alternating_turns"] is True
        assert r["requires_user_last"] is True
        assert "allow_empty_messages" not in r
