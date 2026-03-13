/**
 * モデル固有の処理ハンドラー
 *
 * 各モデル特有のメッセージ変換やプロンプト生成処理を管理
 */

import type { MlxMessage } from './types.js';

/**
 * システムメッセージをマージ（末尾の改行をtrim）
 */
export function mergeSystemMessages(msgs: MlxMessage[]): MlxMessage[] {
  const systemParts: string[] = [];
  const conversation: MlxMessage[] = [];

  for (const msg of msgs) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') {
        systemParts.push(msg.content);
      } else {
        // MlxContentPart[] → テキストのみ抽出
        systemParts.push(
          msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('\n')
        );
      }
    } else {
      conversation.push(msg);
    }
  }

  if (systemParts.length > 0) {
    const systemMessage: MlxMessage = { role: 'system', content: systemParts.join('\n\n') };
    return [systemMessage, ...conversation];
  }
  return conversation;
}

/**
 * システムメッセージをマージ（末尾の改行を保持）
 */
function mergeSystemMessagesRaw(msgs: MlxMessage[]): MlxMessage[] {
  const systemMessages: string[] = [];
  const conversation: MlxMessage[] = [];

  for (const msg of msgs) {
    if (msg.role === 'system') {
      systemMessages.push(typeof msg.content === 'string' ? msg.content : msg.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n'));
    } else {
      conversation.push(msg);
    }
  }

  if (systemMessages.length > 0) {
    const systemMessage: MlxMessage = {
      role: 'system',
      content: systemMessages.join('\n\n')
    };
    return [systemMessage, ...conversation];
  }
  return conversation;
}

/**
 * Tanuki-8B-dpo-v1用のChat処理
 */
export function processTanukiChat(messages: MlxMessage[]): MlxMessage[] {
  // まずsystemメッセージをマージ（改行を保持）
  const mergedMessages = mergeSystemMessagesRaw(messages);

  const result: MlxMessage[] = [];

  // systemメッセージにプレフィックスを追加
  if (mergedMessages.length > 0 && mergedMessages[0].role === 'system') {
    result.push({
      role: 'system',
      content: '以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。\n\n' + mergedMessages[0].content
    });
    result.push(...mergedMessages.slice(1));
  } else {
    // systemメッセージがない場合
    result.push({
      role: 'system',
      content: '以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。\n'
    });
    result.push(...mergedMessages);
  }

  // 最後にuserメッセージを追加
  result.push({
    role: 'user',
    content: 'systemプロンプトで説明されたタスクを正確に実行し、Output Sectionに書かれるべき内容を出力してください。\n'
  });

  return result;
}

/**
 * CodeLlama用のChat処理
 * userメッセージ補完は applyChatSpecificProcessing で汎用的に処理
 */
export function processCodeLlamaChat(messages: MlxMessage[]): MlxMessage[] {
  return mergeSystemMessages(messages);
}

/**
 * Gemma-3用のChat処理
 * userメッセージ補完は applyChatSpecificProcessing で汎用的に処理
 */
export function processGemmaChat(messages: MlxMessage[]): MlxMessage[] {
  return mergeSystemMessages(messages);
}

/**
 * llm-jp-3.1用のCompletion処理
 * chat_templateに厳密に準拠した形式
 * Note: llm-jp-3.1はforce-completion設定のため、chat APIは使用されない
 */
export function processLlmJpCompletion(prompt: string): string {
  // llm-jpは複数言語の混ぜ書きに弱い傾向があるため、特定の言語を優先しないよう明示的に指示
  const llmJpSpecificInstruction = '指示は英語・日本語の混ぜ書きになっているが、どちらの言語も同等の指示として十分に理解すること。\n出力は与えられたタスクに対してふさわしい言語を選択する。\n\n';

  // chat_templateのsystemメッセージと同じ固定文字列（良好な回答を得るために必要な固定プロンプト）
  return '<s>以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。' +
    '\n\n### 指示:\n' +
    llmJpSpecificInstruction +
    prompt +
    '\n\n### 応答:';
}

/**
 * Tanuki-8B用のCompletion処理
 */
export function processTanukiCompletion(prompt: string): string {
  // completion APIではブロック化トークンを使用可能
  return `### システム:\n${prompt}\n\n### 応答:\n`;
}

/**
 * Gemma-3用のCompletion処理
 */
export function processGemmaCompletion(prompt: string): string {
  // Gemma-3はchat形式に依存しないcompletion処理が可能
  return `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n`;
}

/**
 * ELYZA (Llama 2ベース) 用のCompletion処理
 *
 * ELYZAはLlama 2のinstruction formatを使用:
 * <s>[INST] <<SYS>>
 * システムプロンプト
 * <</SYS>>
 *
 * ユーザープロンプト [/INST]
 *
 * Note: <<SYS>>, [INST]などはspecial tokensではなく、複数トークンに分割される
 */
export function processElyzaCompletion(prompt: string): string {
  const B_INST = '[INST]';
  const E_INST = '[/INST]';
  const B_SYS = '<<SYS>>\n';
  const E_SYS = '\n<</SYS>>\n\n';
  const DEFAULT_SYSTEM = 'あなたは誠実で優秀な日本人のアシスタントです。';

  // Llama 2 instruction format
  // <s>は自動的に追加されるため含めない（add_bos_token: true）
  return `${B_INST} ${B_SYS}${DEFAULT_SYSTEM}${E_SYS}${prompt} ${E_INST} `;
}

/**
 * モデル名に基づいてChat処理を選択
 */
export function selectChatProcessor(modelName: string): ((messages: MlxMessage[]) => MlxMessage[]) | null {
  // Note: llm-jp-3.1はforce-completion設定のため、ここには含めない
  if (modelName.includes('Tanuki-8B-dpo-v1')) {
    return processTanukiChat;
  }
  if (modelName.includes('mlx-community/CodeLlama')) {
    return processCodeLlamaChat;
  }
  if (modelName.includes('mlx-community/gemma-3')) {
    return processGemmaChat;
  }
  return null;
}

/**
 * モデル名に基づいてCompletion処理を選択
 */
export function selectCompletionProcessor(modelName: string): ((prompt: string) => string) | null {
  if (modelName.includes('llm-jp-3.1')) {
    return processLlmJpCompletion;
  }
  if (modelName.includes('Tanuki-8B')) {
    return processTanukiCompletion;
  }
  if (modelName.includes('CodeLlama')) {
    // CodeLlamaはそのまま返す
    return (prompt: string) => prompt;
  }
  if (modelName.includes('gemma-3')) {
    return processGemmaCompletion;
  }
  // ELYZA models (elyza/ELYZA-japanese-Llama-2-*)
  if (modelName.toLowerCase().includes('elyza')) {
    return processElyzaCompletion;
  }
  return null;
}