/**
 * MLX Driver モデル固有処理
 *
 * モデルごとの特殊なフォーマット処理、メッセージ変換、プロンプト生成を管理
 * Python側のapply_model_specific_processingをTypeScript側に移行
 */

import type { MlxMessage, MlxRuntimeInfo } from './types.js';
import { mergeSystemMessages, selectChatProcessor, selectCompletionProcessor } from './model-handlers.js';

type ChatRestrictions = MlxRuntimeInfo['chat_restrictions'];

/**
 * API選択ロジック（純粋関数）
 *
 * 判定優先順位:
 * 1. force-chat → 常にchat
 * 2. force-completion → completion（ただしプロセッサなし+chat templateありならchatにフォールバック）
 * 3. mode指定 → instruct=completion, chat=chat
 * 4. auto → chat templateがあればchat、なければcompletion
 */
export function selectApi(
  strategy: string,
  mode: string | undefined,
  hasChatTemplate: boolean,
  hasCompletionProc: boolean
): 'chat' | 'completion' {
  if (strategy === 'force-chat') return 'chat';

  if (strategy === 'force-completion') {
    // completion用プロセッサがないchat-tunedモデルはchatにフォールバック
    if (!hasCompletionProc && hasChatTemplate) return 'chat';
    return 'completion';
  }

  // mode-based selection (auto strategy)
  if (mode === 'instruct') return 'completion';
  if (mode === 'chat') return 'chat';

  // auto: use chat if chat template is available
  return hasChatTemplate ? 'chat' : 'completion';
}

export interface ModelSpecificProcessor {
  /**
   * Chat API用のモデル固有処理
   * メッセージ配列を受け取り、モデルに最適化されたメッセージ配列を返す
   */
  applyChatSpecificProcessing(messages: MlxMessage[]): MlxMessage[];

  /**
   * Completion API用のモデル固有処理（文字列ベース）
   * プロンプト文字列を受け取り、モデルに最適化されたプロンプトを返す
   */
  applyCompletionSpecificProcessing(prompt: string): string;

  /**
   * Completion API用のモデル固有プロセッサが存在するか
   */
  hasCompletionProcessor(): boolean;

  /**
   * runtimeInfo取得後に制約・モデル情報を反映
   */
  setRuntimeContext(context: { chatRestrictions?: ChatRestrictions; modelKind?: 'lm' | 'vlm' }): void;
}


export class DefaultModelSpecificProcessor implements ModelSpecificProcessor {
  private chatRestrictions: ChatRestrictions;
  private modelKind: 'lm' | 'vlm' | undefined;

  constructor(private modelName: string) {
  }

  setRuntimeContext(context: { chatRestrictions?: ChatRestrictions; modelKind?: 'lm' | 'vlm' }): void {
    this.chatRestrictions = context.chatRestrictions;
    this.modelKind = context.modelKind;
  }

  /**
   * systemメッセージのマージが必要か判定
   * - chat_restrictionsで検出された場合
   * - VLMモデルの場合（processorが複数systemを黙って落とすことがあるため）
   */
  private needsSystemMerge(): boolean {
    if (this.chatRestrictions?.single_system_at_start) return true;
    if (this.modelKind === 'vlm') return true;
    return false;
  }

  /**
   * Chat API用のモデル固有処理
   * モデルごとのチャットフォーマットに合わせるための処理
   */
  applyChatSpecificProcessing(messages: MlxMessage[]): MlxMessage[] {
    const processor = selectChatProcessor(this.modelName);
    let processed: MlxMessage[];
    if (processor) {
      // モデル固有ハンドラは内部でmergeSystemMessagesを呼ぶ
      processed = processor(messages);
    } else if (this.needsSystemMerge()) {
      // モデル固有ハンドラがない場合、制約に基づいて汎用処理
      processed = mergeSystemMessages(messages);
    } else {
      processed = [...messages];
    }

    // userメッセージがない場合は補完（chat APIはuserメッセージを要求するモデルが多い）
    if (!processed.some(m => m.role === 'user')) {
      processed.push({
        role: 'user',
        content: 'Read the system prompt and output the appropriate content.',
      });
    }

    return processed;
  }

  /**
   * Completion API用のモデル固有プロセッサが存在するか
   */
  hasCompletionProcessor(): boolean {
    return selectCompletionProcessor(this.modelName) !== null;
  }

  /**
   * Completion API用のモデル固有処理
   * モデルごとにブロック化トークンやプロンプトフォーマットを適用
   */
  applyCompletionSpecificProcessing(prompt: string): string {
    const processor = selectCompletionProcessor(this.modelName);
    return processor ? processor(prompt) : prompt;
  }
}

// ファクトリー関数
export function createModelSpecificProcessor(
  modelName: string
): ModelSpecificProcessor {
  // 将来的に異なるプロセッサーを返すことも可能
  return new DefaultModelSpecificProcessor(modelName);
}
