import { describe, it, expect } from 'vitest';
import { hasMessageElement } from './mlx-driver.js';
import { convertMessages } from './mlx-message-utils.js';
import type { CompiledPrompt } from '@modular-prompt/core';
import type { ChatMessage } from '../formatter/types.js';

describe('MLXDriver Utility Functions', () => {
  describe('hasMessageElement', () => {
    it('should detect message element in instructions', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'message', role: 'system', content: 'test' }],
        data: [],
        output: []
      };
      expect(hasMessageElement(prompt)).toBe(true);
    });

    it('should detect message element in data', () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [{ type: 'message', role: 'user', content: 'test' }],
        output: []
      };
      expect(hasMessageElement(prompt)).toBe(true);
    });

    it('should detect message element in output', () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [],
        output: [{ type: 'message', role: 'assistant', content: 'test' }]
      };
      expect(hasMessageElement(prompt)).toBe(true);
    });

    it('should return false when no message elements', () => {
      const prompt: CompiledPrompt = {
        instructions: [{ type: 'text', content: 'text' }],
        data: [{ type: 'section', title: 'Data', items: [] }],
        output: []
      };
      expect(hasMessageElement(prompt)).toBe(false);
    });

    it('should handle empty prompt', () => {
      const prompt: CompiledPrompt = {
        instructions: [],
        data: [],
        output: []
      };
      expect(hasMessageElement(prompt)).toBe(false);
    });
  });

  describe('convertMessages', () => {
    it('should convert ChatMessage to MlxMessage format', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' }
      ];

      const result = convertMessages(messages);

      expect(result).toEqual([
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'User message' },
        { role: 'assistant', content: 'Assistant message' }
      ]);
    });

    it('should handle empty messages array', () => {
      const messages: ChatMessage[] = [];
      const result = convertMessages(messages);
      expect(result).toEqual([]);
    });
  });
});