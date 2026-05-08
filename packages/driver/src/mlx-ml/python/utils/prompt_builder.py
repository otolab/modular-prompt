"""プロンプト生成ユーティリティ"""


def supports_chat_template(tokenizer) -> bool:
    return (hasattr(tokenizer, 'apply_chat_template') and
            hasattr(tokenizer, 'chat_template') and
            tokenizer.chat_template is not None)


def generate_merged_prompt(messages, capabilities):
    """apply_chat_templateがない場合のプロンプト生成"""
    prompt_parts = []
    special_tokens = capabilities.get('special_tokens', {})

    for msg in messages:
        role = msg['role']
        role_upper = role.upper()

        role_token = special_tokens.get(role)

        if role_token and isinstance(role_token, dict) and 'start' in role_token:
            start_token = role_token['start']['text']
            end_token = role_token['end']['text']
            prompt_parts.extend([
                start_token,
                msg['content'].strip(),
                end_token,
                ''
            ])
        else:
            block_token = None
            for candidate in ['block', 'context', 'quote', 'section']:
                token = special_tokens.get(candidate)
                if token and isinstance(token, dict) and 'start' in token:
                    block_token = token
                    break

            if block_token:
                start_token = block_token['start']['text']
                end_token = block_token['end']['text']
                prompt_parts.extend([
                    f'{start_token}{role_upper}:\n{msg["content"].strip()}',
                    end_token,
                    ''
                ])
            else:
                prompt_parts.extend([
                    f'<!-- begin of {role_upper} -->',
                    msg['content'].strip(),
                    f'<!-- end of {role_upper} -->',
                    ''
                ])

    return '\n'.join(prompt_parts[:-1])
