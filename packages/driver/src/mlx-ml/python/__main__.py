import sys
import json
from mlx_lm import load, stream_generate
from mlx_lm.sample_utils import make_sampler
from token_utils import get_capabilities, is_eod_token

model_name = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/gemma-3-270m-it-qat-4bit"

model, tokenizer = load(model_name)

# Capabilities情報の取得
capabilities = get_capabilities(tokenizer)

def read():
    lines = []
    data = None
    eof = False
    while not eof:
        line = sys.stdin.readline()
        # sys.stderr.write('line:' + line + '\n')
        if not line:
            eof = True
        else:
            lines.append(line)
        try:
            data = json.loads(''.join(lines))
        except json.JSONDecodeError as e:
            data = None
            continue
        break
    return data


def supports_chat_template():
    """
    チャットテンプレートがサポートされているかを判定

    apply_chat_templateメソッドの存在と、tokenizer.chat_templateの両方を確認する。
    tokenizer.chat_templateが設定されていない場合、apply_chat_templateを呼んでも
    エラーになるため、両方の条件をチェックする必要がある。

    Returns:
        bool: チャットテンプレートがサポートされている場合True
    """
    return (hasattr(tokenizer, 'apply_chat_template') and
            hasattr(tokenizer, 'chat_template') and
            tokenizer.chat_template is not None)


def handle_capabilities():
    """capabilities API の処理"""
    print(json.dumps(capabilities), end='\0', flush=True)


def handle_format_test(messages, options=None, tools=None):
    """フォーマットテスト API の処理（実際に生成せずフォーマットのみ）"""
    if options is None:
        options = {}

    result = {
        "formatted_prompt": None,
        "template_applied": False,
        "model_specific_processing": None,
        "error": None
    }

    try:
        # チャットテンプレートが利用可能かチェック
        if supports_chat_template():
            # messagesはTypeScript側で既にモデル固有処理済み
            result["model_specific_processing"] = messages

            # プロンプト生成（フォーマットのみ）
            primer = options.get('primer')
            add_generation_prompt = True
            tokenize = False  # 常にテキストで返す

            if primer is not None:
                messages.append({'role': 'assistant', 'content': primer})
                add_generation_prompt = False

            # tools対応を試みる（テンプレートが対応していなければtools無しで実行）
            try:
                formatted_prompt = tokenizer.apply_chat_template(
                    messages,
                    tools=tools,
                    add_generation_prompt=add_generation_prompt,
                    tokenize=tokenize,
                )
            except TypeError:
                formatted_prompt = tokenizer.apply_chat_template(
                    messages,
                    add_generation_prompt=add_generation_prompt,
                    tokenize=tokenize,
                )

            if primer is not None:
                formatted_prompt = primer.join(formatted_prompt.split(primer)[0:-1]) + primer

            result["formatted_prompt"] = formatted_prompt
            result["template_applied"] = True
        else:
            # チャットテンプレートがない場合はcompletionフォーマット
            formatted_prompt = generate_merged_prompt(messages)
            primer = options.get('primer')
            if primer is not None:
                formatted_prompt += primer

            result["formatted_prompt"] = formatted_prompt
            result["template_applied"] = False

    except Exception as e:
        result["error"] = str(e)

    print(json.dumps(result), end='\0', flush=True)

def handle_chat(messages, primer=None, options=None, tools=None):
    """chat API の処理"""
    if options is None:
        options = {}

    # チャットテンプレートが利用可能かチェック
    if not supports_chat_template():
        # チャットテンプレートがない場合はcompletionフォーマットに変換
        prompt = generate_merged_prompt(messages)
        if primer is not None:
            print(primer, end='', flush=True)
        generate_text(prompt, options)
        return

    # プロンプト生成
    add_generation_prompt = True
    tokenize = False

    if primer is not None:
        messages.append({'role': 'assistant', 'content': primer})
        add_generation_prompt = False
        tokenize = False

    # tools対応を試みる（テンプレートが対応していなければtools無しで実行）
    try:
        prompt = tokenizer.apply_chat_template(
            messages,
            tools=tools,
            add_generation_prompt=add_generation_prompt,
            tokenize=tokenize,
        )
    except TypeError:
        prompt = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=add_generation_prompt,
            tokenize=tokenize,
        )

    if primer is not None:
        prompt = primer.join(prompt.split(primer)[0:-1]) + primer
        print(primer, end='', flush=True)

    generate_text(prompt, options)


def generate_merged_prompt(messages):
    """apply_chat_templateがない場合のプロンプト生成"""
    # messagesはTypeScript側で既にmergeSystemMessages処理済み
    # TypeScript側のformatterと同じフォーマットを維持

    prompt_parts = []
    special_tokens = capabilities.get('special_tokens', {})

    for msg in messages:
        role = msg['role']  # 小文字のまま
        role_upper = role.upper()

        # 1. 専用のspecial_tokenを探す
        role_token = special_tokens.get(role)

        if role_token and isinstance(role_token, dict) and 'start' in role_token:
            # 専用トークンがある場合
            start_token = role_token['start']['text']
            end_token = role_token['end']['text']
            prompt_parts.extend([
                start_token,
                msg['content'].strip(),
                end_token,
                ''  # 空行で区切る
            ])
        else:
            # 2. 専用トークンがない場合、汎用blockトークンを探す
            # blockやcontextなどの汎用的なペアトークンを探す
            block_token = None
            for candidate in ['block', 'context', 'quote', 'section']:
                token = special_tokens.get(candidate)
                if token and isinstance(token, dict) and 'start' in token:
                    block_token = token
                    break

            if block_token:
                # 汎用blockトークンがある場合: {block_begin}{role}:\n...{block_end}
                start_token = block_token['start']['text']
                end_token = block_token['end']['text']
                prompt_parts.extend([
                    f'{start_token}{role_upper}:\n{msg["content"].strip()}',
                    end_token,
                    ''  # 空行で区切る
                ])
            else:
                # 3. どちらもない場合は、HTMLコメント形式（フォールバック）
                prompt_parts.extend([
                    f'<!-- begin of {role_upper} -->',
                    msg['content'].strip(),
                    f'<!-- end of {role_upper} -->',
                    ''  # 空行で区切る
                ])

    # 最後の空行を削除して、ダブル改行で結合
    return '\n'.join(prompt_parts[:-1])


def handle_completion(prompt, options=None):
    """completion API の処理"""
    if options is None:
        options = {}
    
    # promptはTypeScript側で既にモデル固有処理済み
    
    generate_text(prompt, options)


def generate_text(prompt, options):
    """テキスト生成の共通処理

    注意: optionsはTypeScript側で事前にバリデーション済み
    - temperatureパラメータはsamplerオブジェクトに変換
    - サポートされていないパラメータはTS側でフィルタリング
    """
    # デフォルトオプションの設定
    default_options = {'max_tokens': 1000}

    # temperatureパラメータを抽出してsamplerを作成
    temperature = options.pop('temperature', 1.0) if 'temperature' in options else 1.0
    top_p = options.pop('top_p', 0.0) if 'top_p' in options else 0.0
    top_k = options.pop('top_k', 0) if 'top_k' in options else 0

    # samplerオブジェクトを作成
    sampler = make_sampler(temp=temperature, top_p=top_p, top_k=top_k)

    # 残りのオプションとマージ
    final_options = {**default_options, **options, 'sampler': sampler}

    if isinstance(prompt, list):  # tokenized
        sys.stderr.write(f"--- prompt: len={len(prompt)}\n")
    else:
        sys.stderr.write(f"--- prompt\n{prompt}\n")

    eos_detected = False
    for response in stream_generate(model, tokenizer, prompt, **final_options):
        # トークンIDによるEOS判定（より確実）
        if is_eod_token(response, tokenizer):
            eos_detected = True
            print('\n', end='\0', flush=True)
            break
        if not eos_detected:
            print(response.text.replace('\0', ''), end='', flush=True)
    
    if not eos_detected:
        print('\n', end='\0', flush=True)

def main():
    while True:
        req = read()
        if req is None:
            break
        
        method = req.get('method')
        if not method:
            sys.stderr.write("Error: 'method' field is required\n")
            print('\n', end='\0', flush=True)
            continue
        
        try:
            if method == 'capabilities':
                handle_capabilities()
            
            elif method == 'format_test':
                messages = req.get('messages')
                if not messages:
                    sys.stderr.write("Error: 'messages' field is required for format_test method\n")
                    print('\n', end='\0', flush=True)
                    continue

                options = req.get('options', {})
                tools = req.get('tools')
                handle_format_test(messages, options, tools)

            elif method == 'chat':
                messages = req.get('messages')
                if not messages:
                    sys.stderr.write("Error: 'messages' field is required for chat method\n")
                    print('\n', end='\0', flush=True)
                    continue

                primer = req.get('primer')
                options = req.get('options', {})
                tools = req.get('tools')
                handle_chat(messages, primer, options, tools)
            
            elif method == 'completion':
                prompt = req.get('prompt')
                if not prompt:
                    sys.stderr.write("Error: 'prompt' field is required for completion method\n")
                    print('\n', end='\0', flush=True)
                    continue
                
                options = req.get('options', {})
                handle_completion(prompt, options)
            
            else:
                sys.stderr.write(f"Error: Unknown method '{method}'\n")
                print('\n', end='\0', flush=True)
        
        except Exception as e:
            sys.stderr.write(f"Error processing request: {e}\n")
            print('\n', end='\0', flush=True)


if __name__ == "__main__":
    main()
