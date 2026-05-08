from unittest.mock import patch, MagicMock

from utils.vlm_utils import detect_model_kind


class TestDetectModelKind:
    @patch("utils.vlm_utils._get_model_type", return_value=None)
    def test_no_model_type(self, mock_get):
        assert detect_model_kind("some/model") == "lm"

    @patch("utils.vlm_utils._get_model_type", return_value="qwen2_vl")
    def test_vlm_module_exists(self, mock_get):
        with patch("importlib.import_module") as mock_import:
            mock_import.return_value = MagicMock()
            assert detect_model_kind("some/vlm-model") == "vlm"

    @patch("utils.vlm_utils._get_model_type", return_value="llama")
    def test_vlm_module_not_found(self, mock_get):
        with patch("importlib.import_module", side_effect=ImportError):
            assert detect_model_kind("some/lm-model") == "lm"
