"""
チャットテンプレートの制約検出

tokenizerのapply_chat_templateを使用して、
モデルがサポートするメッセージパターンの制約を検出する。
"""


def detect_chat_restrictions(tokenizer) -> dict:
    """
    チャットテンプレートの制約を検出

    Args:
        tokenizer: HuggingFace tokenizer (apply_chat_template対応)

    Returns:
        dict: chat_restrictions情報
            {
                "single_system_at_start": bool,
                "max_system_messages": int,
                "alternating_turns": bool,
                "requires_user_last": bool,
                "allow_empty_messages": bool
            }
    """
    if not hasattr(tokenizer, 'apply_chat_template'):
        return None

    # テストパターンを実行
    test_results = {}
    for pattern in _get_test_patterns():
        try:
            tokenizer.apply_chat_template(
                pattern['messages'],
                tokenize=False,
                add_generation_prompt=False
            )
            test_results[pattern['name']] = {'success': True}
        except Exception as e:
            test_results[pattern['name']] = {'error': str(e)}

    # テスト結果から制約を推論
    return _infer_restrictions_from_results(test_results)


def _get_test_patterns():
    """テストパターンの定義"""
    return [
        # 基本パターン
        {
            'name': 'basic',
            'messages': [
                {'role': 'user', 'content': 'Hello'}
            ]
        },

        # システムメッセージ付き
        {
            'name': 'with-system',
            'messages': [
                {'role': 'system', 'content': 'You are a helpful assistant.'},
                {'role': 'user', 'content': 'Hello'}
            ]
        },

        # 複数システムメッセージ
        {
            'name': 'multi-system',
            'messages': [
                {'role': 'system', 'content': 'First system message.'},
                {'role': 'system', 'content': 'Second system message.'},
                {'role': 'user', 'content': 'Hello'}
            ]
        },

        # 連続ユーザーメッセージ
        {
            'name': 'consecutive-user',
            'messages': [
                {'role': 'user', 'content': 'First question'},
                {'role': 'user', 'content': 'Second question'}
            ]
        },

        # アシスタントで終わる
        {
            'name': 'assistant-last',
            'messages': [
                {'role': 'user', 'content': 'Hello'},
                {'role': 'assistant', 'content': 'Hi there!'}
            ]
        },

        # 交互の会話
        {
            'name': 'alternating',
            'messages': [
                {'role': 'user', 'content': 'Question 1'},
                {'role': 'assistant', 'content': 'Answer 1'},
                {'role': 'user', 'content': 'Question 2'}
            ]
        },

        # 空メッセージ
        {
            'name': 'empty-message',
            'messages': [
                {'role': 'user', 'content': ''}
            ]
        },

        # システムメッセージが途中にある
        {
            'name': 'system-middle',
            'messages': [
                {'role': 'user', 'content': 'First'},
                {'role': 'system', 'content': 'System in middle'},
                {'role': 'user', 'content': 'Second'}
            ]
        }
    ]


def _infer_restrictions_from_results(test_results: dict) -> dict:
    """
    テスト結果から制約を推論

    Args:
        test_results: テストパターン名をキーとした結果の辞書

    Returns:
        dict: 検出された制約
    """
    restrictions = {}

    # システムメッセージの制約を検出
    with_system = test_results.get('with-system')
    multi_system = test_results.get('multi-system')

    if with_system and 'error' in with_system:
        # 単独のsystemメッセージもエラー → systemロール自体がサポートされていない
        restrictions['max_system_messages'] = 0
    elif multi_system and 'error' in multi_system:
        # 複数はエラーだが単独は成功 → 最大1つまで
        restrictions['single_system_at_start'] = True
        restrictions['max_system_messages'] = 1
    # それ以外（両方成功）→ max_system_messagesキーを設定しない（無制限）

    # 連続ユーザーメッセージのテスト
    consecutive_user = test_results.get('consecutive-user')
    if consecutive_user and 'error' in consecutive_user:
        restrictions['alternating_turns'] = True

    # アシスタントで終わるテスト
    assistant_last = test_results.get('assistant-last')
    if assistant_last and 'error' in assistant_last:
        restrictions['requires_user_last'] = True

    # 空メッセージのテスト
    empty_message = test_results.get('empty-message')
    if empty_message and 'error' in empty_message:
        restrictions['allow_empty_messages'] = False

    return restrictions if restrictions else None
