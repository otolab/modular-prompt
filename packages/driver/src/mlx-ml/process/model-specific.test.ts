/**
 * モデル固有処理のユニットテスト
 */
import { describe, it, expect } from 'vitest';
import { createModelSpecificProcessor, selectApi } from './model-specific.js';
import type { MlxMessage } from './types.js';

// ============================================================================
// selectApi - API選択ロジック
// ============================================================================
describe('selectApi', () => {
  describe('force-chat', () => {
    it('should always return chat regardless of other conditions', () => {
      expect(selectApi('force-chat', undefined, false, false)).toBe('chat');
      expect(selectApi('force-chat', undefined, true, true)).toBe('chat');
      expect(selectApi('force-chat', 'instruct', true, true)).toBe('chat');
    });
  });

  describe('force-completion', () => {
    it('should return completion when completion processor exists', () => {
      expect(selectApi('force-completion', undefined, true, true)).toBe('completion');
    });

    it('should return completion when no chat template (completion is only option)', () => {
      expect(selectApi('force-completion', undefined, false, false)).toBe('completion');
    });

    it('should fall back to chat when no completion processor and has chat template', () => {
      expect(selectApi('force-completion', undefined, true, false)).toBe('chat');
    });
  });

  describe('auto (default)', () => {
    it('should return chat when chat template is available', () => {
      expect(selectApi('auto', undefined, true, false)).toBe('chat');
      expect(selectApi('auto', undefined, true, true)).toBe('chat');
    });

    it('should return completion when no chat template', () => {
      expect(selectApi('auto', undefined, false, false)).toBe('completion');
    });
  });

  describe('mode-based selection', () => {
    it('should return completion for instruct mode', () => {
      expect(selectApi('auto', 'instruct', true, true)).toBe('completion');
    });

    it('should return chat for chat mode', () => {
      expect(selectApi('auto', 'chat', false, false)).toBe('chat');
    });

    it('should be overridden by force-chat', () => {
      expect(selectApi('force-chat', 'instruct', true, true)).toBe('chat');
    });
  });
});

// ============================================================================
// ModelSpecificProcessor
// ============================================================================
describe('ModelSpecificProcessor', () => {
  // --------------------------------------------------------------------------
  // hasCompletionProcessor
  // --------------------------------------------------------------------------
  describe('hasCompletionProcessor', () => {
    it('should return true for models with completion processors', () => {
      expect(createModelSpecificProcessor('llm-jp-3.1').hasCompletionProcessor()).toBe(true);
      expect(createModelSpecificProcessor('Tanuki-8B-dpo-v1').hasCompletionProcessor()).toBe(true);
      expect(createModelSpecificProcessor('mlx-community/CodeLlama-7b').hasCompletionProcessor()).toBe(true);
      expect(createModelSpecificProcessor('mlx-community/gemma-3-2b').hasCompletionProcessor()).toBe(true);
    });

    it('should return false for models without completion processors', () => {
      expect(createModelSpecificProcessor('unknown-model').hasCompletionProcessor()).toBe(false);
      expect(createModelSpecificProcessor('mlx-community/Qwen3.5-27B-4bit').hasCompletionProcessor()).toBe(false);
      expect(createModelSpecificProcessor('LiquidAI/LFM2.5-1.2B-JP').hasCompletionProcessor()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // userメッセージ自動補完
  // --------------------------------------------------------------------------
  describe('user message auto-insertion', () => {
    it('should add user message when only system messages exist (unknown model)', () => {
      const processor = createModelSpecificProcessor('unknown-model');
      const messages: MlxMessage[] = [
        { role: 'system', content: 'You are an assistant' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      expect(result[result.length - 1].role).toBe('user');
      expect(result[result.length - 1].content).toBe(
        'Read the system prompt and output the appropriate content.'
      );
    });

    it('should not add user message when one already exists', () => {
      const processor = createModelSpecificProcessor('unknown-model');
      const messages: MlxMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hello' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      const userMessages = result.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe('Hello');
    });

    it('should add user message for CodeLlama when no user message exists', () => {
      const processor = createModelSpecificProcessor('mlx-community/CodeLlama-7b');
      const messages: MlxMessage[] = [
        { role: 'system', content: 'You are a coder.' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      expect(result[result.length - 1].role).toBe('user');
    });

    it('should not add user message for CodeLlama when user message exists', () => {
      const processor = createModelSpecificProcessor('mlx-community/CodeLlama-7b');
      const messages: MlxMessage[] = [
        { role: 'system', content: 'You are a coder.' },
        { role: 'user', content: 'Write a function' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      const userMessages = result.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe('Write a function');
    });

    it('should add user message for Gemma-3 when no user message exists', () => {
      const processor = createModelSpecificProcessor('mlx-community/gemma-3-2b');
      const messages: MlxMessage[] = [
        { role: 'system', content: 'System message' },
        { role: 'assistant', content: 'Assistant response' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      expect(result[result.length - 1].role).toBe('user');
    });

    it('should keep Tanuki model-specific user message', () => {
      const processor = createModelSpecificProcessor('Tanuki-8B-dpo-v1');
      const messages: MlxMessage[] = [
        { role: 'system', content: 'Instructions' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      // Tanukiは常にモデル固有のuserメッセージを追加する
      const userMessages = result.filter(m => m.role === 'user');
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      expect(userMessages[userMessages.length - 1].content).toContain(
        'systemプロンプトで説明されたタスクを正確に実行し'
      );
    });

    it('should add user message when systemMerge is needed (VLM model)', () => {
      const processor = createModelSpecificProcessor('unknown-vlm-model');
      processor.setRuntimeContext({ modelKind: 'vlm' });
      const messages: MlxMessage[] = [
        { role: 'system', content: 'Describe this image' },
        { role: 'system', content: 'Be detailed' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      // system messages merged + user message added
      const systemMessages = result.filter(m => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
      expect(result[result.length - 1].role).toBe('user');
    });
  });

  // --------------------------------------------------------------------------
  // モデル固有Chat処理
  // --------------------------------------------------------------------------
  describe('Tanuki-8B-dpo-v1 processing', () => {
    const processor = createModelSpecificProcessor('Tanuki-8B-dpo-v1');

    it('should add system and user messages', () => {
      const messages: MlxMessage[] = [
        { role: 'user', content: 'Hello' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toContain('以下は、タスクを説明する指示です');
      expect(result[1].role).toBe('user');
      expect(result[1].content).toBe('Hello');
      expect(result[2].role).toBe('user');
      expect(result[2].content).toContain('systemプロンプトで説明されたタスクを正確に実行し');
    });
  });

  describe('CodeLlama processing', () => {
    const processor = createModelSpecificProcessor('mlx-community/CodeLlama-7b');

    it('should merge system messages', () => {
      const messages: MlxMessage[] = [
        { role: 'system', content: 'System 1' },
        { role: 'system', content: 'System 2' },
        { role: 'user', content: 'Write code' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      const systemMessages = result.filter(m => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].content).toContain('System 1');
      expect(systemMessages[0].content).toContain('System 2');
    });
  });

  describe('Gemma-3 processing', () => {
    const processor = createModelSpecificProcessor('mlx-community/gemma-3-2b');

    it('should merge system messages', () => {
      const messages: MlxMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hello' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      const systemMessages = result.filter(m => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
    });
  });

  describe('Unknown model processing', () => {
    const processor = createModelSpecificProcessor('unknown-model');

    it('should return messages unchanged when user message exists', () => {
      const messages: MlxMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];

      const result = processor.applyChatSpecificProcessing(messages);

      expect(result).toEqual(messages);
    });
  });

  // --------------------------------------------------------------------------
  // Completion固有処理
  // --------------------------------------------------------------------------
  describe('Completion specific processing', () => {
    it('should format llm-jp-3.1 prompt correctly', () => {
      const processor = createModelSpecificProcessor('llm-jp-3.1');
      const prompt = 'Generate a summary';

      const result = processor.applyCompletionSpecificProcessing(prompt);

      expect(result).toContain('<s>');
      expect(result).toContain('### 指示:');
      expect(result).toContain('Generate a summary');
      expect(result).toContain('### 応答:');
    });

    it('should format Tanuki-8B prompt with block tokens', () => {
      const processor = createModelSpecificProcessor('Tanuki-8B-dpo-v1');
      const prompt = 'Generate a story';

      const result = processor.applyCompletionSpecificProcessing(prompt);

      expect(result).toContain('### システム:');
      expect(result).toContain('Generate a story');
      expect(result).toContain('### 応答:');
    });

    it('should format Gemma-3 prompt with turn markers', () => {
      const processor = createModelSpecificProcessor('mlx-community/gemma-3-2b');
      const prompt = 'Answer this question';

      const result = processor.applyCompletionSpecificProcessing(prompt);

      expect(result).toContain('<start_of_turn>user');
      expect(result).toContain('Answer this question');
      expect(result).toContain('<start_of_turn>model');
    });

    it('should pass through CodeLlama prompt unchanged', () => {
      const processor = createModelSpecificProcessor('mlx-community/CodeLlama-7b');
      const prompt = 'Complete this code';

      const result = processor.applyCompletionSpecificProcessing(prompt);

      expect(result).toBe(prompt);
    });

    it('should return prompt unchanged for other models', () => {
      const processor = createModelSpecificProcessor('other-model');
      const prompt = 'Test prompt';

      const result = processor.applyCompletionSpecificProcessing(prompt);

      expect(result).toBe(prompt);
    });
  });
});
