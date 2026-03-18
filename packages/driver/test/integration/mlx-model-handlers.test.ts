import { describe, it, expect } from 'vitest';
import {
  processTanukiChat,
  processCodeLlamaChat,
  processGemmaChat,
  processTanukiCompletion,
  processLlmJpCompletion,
  processGemmaCompletion
} from '../../src/mlx-ml/process/model-handlers.js';
import type { MlxMessage } from '../../src/mlx-ml/process/types.js';

describe('MLX Model Handlers', () => {
  describe('processTanukiChat', () => {
    it('should add exact prefix and suffix to system message', () => {
      const messages: MlxMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' }
      ];

      const result = processTanukiChat(messages);

      expect(result).toHaveLength(3); // system + user + user
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe(
        '以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。\n\n' +
        'You are a helpful assistant.'
      );
      expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[2].role).toBe('user');
      expect(result[2].content).toBe(
        'systemプロンプトで説明されたタスクを正確に実行し、Output Sectionに書かれるべき内容を出力してください。\n'
      );
    });

    it('should handle multiple system messages', () => {
      const messages: MlxMessage[] = [
        { role: 'system', content: 'First instruction.' },
        { role: 'system', content: 'Second instruction.' },
        { role: 'user', content: 'Question' }
      ];

      const result = processTanukiChat(messages);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('system');
      // Multiple system messages are merged with \n\n
      expect(result[0].content).toBe(
        '以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。\n\n' +
        'First instruction.\n\nSecond instruction.'
      );
    });

    it('should handle no system message', () => {
      const messages: MlxMessage[] = [
        { role: 'user', content: 'Hello' }
      ];

      const result = processTanukiChat(messages);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('system');
      expect(result[0].content).toBe(
        '以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。\n'
      );
      expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[2].content).toBe(
        'systemプロンプトで説明されたタスクを正確に実行し、Output Sectionに書かれるべき内容を出力してください。\n'
      );
    });
  });

  describe('processCodeLlamaChat', () => {
    it('should merge system messages', () => {
      const messages: MlxMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'assistant', content: 'Response' }
      ];

      const result = processCodeLlamaChat(messages);

      // userメッセージ補完はapplyChatSpecificProcessingの責務
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ role: 'system', content: 'System prompt' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Response' });
    });
  });

  describe('processGemmaChat', () => {
    it('should merge system messages', () => {
      const messages: MlxMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Question' },
        { role: 'assistant', content: 'Answer' }
      ];

      const result = processGemmaChat(messages);

      // userメッセージ補完はapplyChatSpecificProcessingの責務
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'system', content: 'System' });
      expect(result[1]).toEqual({ role: 'user', content: 'Question' });
      expect(result[2]).toEqual({ role: 'assistant', content: 'Answer' });
    });
  });

  describe('Completion processors', () => {
    it('should format Tanuki completion with exact markers', () => {
      const prompt = 'Generate content';
      const result = processTanukiCompletion(prompt);

      expect(result).toBe('### システム:\nGenerate content\n\n### 応答:\n');
    });

    it('should format LLM-JP completion with exact template', () => {
      const prompt = 'Task description';
      const result = processLlmJpCompletion(prompt);

      expect(result).toBe(
        '<s>以下は、タスクを説明する指示です。要求を適切に満たす応答を書きなさい。' +
        '\n\n### 指示:\n' +
        '指示は英語・日本語の混ぜ書きになっているが、どちらの言語も同等の指示として十分に理解すること。\n' +
        '出力は与えられたタスクに対してふさわしい言語を選択する。\n\n' +
        'Task description' +
        '\n\n### 応答:'
      );
    });

    it('should format Gemma completion with turn markers', () => {
      const prompt = 'User input';
      const result = processGemmaCompletion(prompt);

      expect(result).toBe('<start_of_turn>user\nUser input<end_of_turn>\n<start_of_turn>model\n');
    });
  });
});