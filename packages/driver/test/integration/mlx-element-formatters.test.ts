import { describe, it, expect } from 'vitest';
import type { MlxRuntimeInfo } from '../../src/mlx-ml/process/types.js';
import {
  MaterialElementFormatter,
  JSONElementFormatter,
  MessageElementFormatter
} from '../../src/formatter/element-formatters/index.js';

describe('MLX Element Formatters', () => {
  // Gemma-3風の特殊トークンモック
  const gemmaSpecialTokens: MlxRuntimeInfo['special_tokens'] = {
    'code_block_start': { text: '```', id: 1001 },
    'code_block_end': { text: '```', id: 1002 },
    'user': {
      start: { text: '<start_of_turn>user', id: 2001 },
      end: { text: '<end_of_turn>', id: 2002 }
    },
    'assistant': {
      start: { text: '<start_of_turn>model', id: 2003 },
      end: { text: '<end_of_turn>', id: 2004 }
    }
  };

  describe('MaterialElementFormatter', () => {
    it('should format material with default markdown quotes', async () => {
      const formatter = new MaterialElementFormatter();
      const result = await formatter.format({
        type: 'material',
        id: 'test',
        title: 'Test Material',
        content: 'Line 1\nLine 2'
      });

      expect(result).toContain('### Test Material');
      expect(result).toContain('> Line 1');
      expect(result).toContain('> Line 2');
    });

    it('should use quote tokens when available', async () => {
      const formatter = new MaterialElementFormatter();
      const tokensWithQuote: MlxRuntimeInfo['special_tokens'] = {
        'quote': {
          start: { text: '<quote>', id: 3001 },
          end: { text: '</quote>', id: 3002 }
        }
      };

      const result = await formatter.format({
        type: 'material',
        id: 'test',
        title: 'Quoted Material',
        content: 'Some quoted text'
      }, tokensWithQuote);

      expect(result).toContain('<quote>');
      expect(result).toContain('Quoted Material');
      expect(result).toContain('</quote>');
    });
  });

  describe('JSONElementFormatter', () => {
    it('should format JSON with code block tokens', async () => {
      const formatter = new JSONElementFormatter();
      const result = await formatter.format({
        type: 'json',
        content: { type: 'object', properties: { test: { type: 'string' } } }
      }, gemmaSpecialTokens);

      expect(result).toContain('JSON Schema:');
      expect(result).toContain('```json');
      expect(result).toContain('"type": "object"');
      expect(result).toContain('```');
    });

    it('should format JSON with default markdown', async () => {
      const formatter = new JSONElementFormatter();
      const result = await formatter.format({
        type: 'json',
        content: { test: 'value' }
      });

      expect(result).toContain('JSON Schema:');
      expect(result).toContain('```json');
      expect(result).toContain('"test": "value"');
    });
  });

  describe('MessageElementFormatter', () => {
    it('should use model-specific tokens for Gemma', async () => {
      const formatter = new MessageElementFormatter('gemma-3');
      const result = await formatter.format({
        type: 'message',
        role: 'user',
        content: 'Hello there'
      }, gemmaSpecialTokens);

      expect(result).toContain('<start_of_turn>user');
      expect(result).toContain('Hello there');
      expect(result).toContain('<end_of_turn>');
    });

    it('should handle system role mapping for Gemma', async () => {
      const formatter = new MessageElementFormatter('mlx-community/gemma-3-270m');
      const result = await formatter.format({
        type: 'message',
        role: 'system',
        content: 'System prompt'
      });

      // Gemma-3はsystemロールをuserにマップ
      expect(result).toContain('<start_of_turn>user');
      expect(result).toContain('System prompt');
    });
  });
});