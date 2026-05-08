"""mlx-vlm モデル種別判定・画像処理ユーティリティ"""

import json
from pathlib import Path


def detect_model_kind(model_name: str) -> str:
    """config.json の model_type から mlx_vlm の対応可否を判定する。

    mlx_vlm.models.{model_type} が存在すれば "vlm"、なければ "lm" を返す。
    mlx-vlm 自体がインストールされていない場合も "lm" を返す。

    Args:
        model_name: HuggingFaceモデル名（例: "mlx-community/Qwen2-VL-2B-Instruct-4bit"）

    Returns:
        "vlm" or "lm"
    """
    model_type = _get_model_type(model_name)
    if not model_type:
        return "lm"

    try:
        import importlib
        importlib.import_module(f"mlx_vlm.models.{model_type}")
        return "vlm"
    except (ImportError, ModuleNotFoundError):
        return "lm"


def load_and_resize_images(paths: list[str], max_size: int = 768):
    """画像ファイルを読み込み、必要に応じてリサイズする。

    最大辺が max_size を超える場合、アスペクト比を維持して縮小する。

    Args:
        paths: 画像ファイルパスのリスト
        max_size: 最大辺ピクセル数（デフォルト: 768）

    Returns:
        PIL Image オブジェクトのリスト
    """
    from PIL import Image

    images = []
    for path in paths:
        img = Image.open(path)
        w, h = img.size
        if max(w, h) > max_size:
            scale = max_size / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        images.append(img)
    return images


def _get_model_type(model_name: str) -> str | None:
    """モデルのconfig.jsonからmodel_typeを取得する。

    huggingface_hubのキャッシュからローカルのconfig.jsonを探す。
    見つからない場合はNoneを返す。
    """
    try:
        from huggingface_hub import hf_hub_download
        config_path = hf_hub_download(model_name, "config.json")
        with open(config_path) as f:
            config = json.load(f)
        return config.get("model_type", "").lower()
    except Exception:
        return None
