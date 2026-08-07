import json


def handle_capabilities(capabilities: dict) -> None:
    """capabilities API の処理。JSON出力してnull文字で終端"""
    print(json.dumps(capabilities), end="\0", flush=True)
