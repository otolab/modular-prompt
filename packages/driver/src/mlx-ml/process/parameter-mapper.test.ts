import { describe, it, expect } from 'vitest';
import { mapOptionsToPython } from './parameter-mapper.js';

describe('MLX Parameter Mapper', () => {
  describe('mapOptionsToPython', () => {
    it('should convert camelCase to snake_case parameters', () => {
      const options = {
        maxTokens: 500,
        topP: 0.9,
        topK: 50,
        minP: 0.05,
        repetitionPenalty: 1.1,
        repetitionContextSize: 30,
        presencePenalty: 1.5,
        presenceContextSize: 40,
      };

      const result = mapOptionsToPython(options);

      expect(result).toEqual({
        max_tokens: 500,
        top_p: 0.9,
        top_k: 50,
        min_p: 0.05,
        repetition_penalty: 1.1,
        repetition_context_size: 30,
        presence_penalty: 1.5,
        presence_context_size: 40,
      });
    });

    it('should keep temperature as temperature', () => {
      const options = {
        temperature: 0.7
      };

      const result = mapOptionsToPython(options);

      expect(result).toEqual({
        temperature: 0.7  // temperature is passed as-is
      });
    });

    it('should validate and correct out-of-range values', () => {
      const options = {
        maxTokens: 200000,  // exceeds max (100000)
        temperature: -1,     // below min (0.0)
        topP: 2.0           // exceeds max (1.0)
      };

      const result = mapOptionsToPython(options);

      expect(result).toEqual({
        max_tokens: 100000,  // clamped to max
        temperature: 0.0,    // clamped to min
        top_p: 1.0          // clamped to max
      });
    });

    it('should handle undefined options', () => {
      const result = mapOptionsToPython(undefined);
      expect(result).toBeUndefined();
    });

    it('should handle empty options', () => {
      const result = mapOptionsToPython({});
      expect(result).toBeUndefined();
    });

    it('should throw error for unknown parameters in strict mode', () => {
      const options = {
        unknownParam: 'value',
        maxTokens: 500
      };

      expect(() => mapOptionsToPython(options, true)).toThrow('MLX Driver parameter validation failed');
    });

    it('should filter unknown parameters in non-strict mode', () => {
      const options = {
        unknownParam: 'value',
        maxTokens: 500
      };

      const result = mapOptionsToPython(options, false);

      expect(result).toEqual({
        max_tokens: 500
      });
      expect(result).not.toHaveProperty('unknownParam');
      expect(result).not.toHaveProperty('unknown_param');
    });

    it('should throw error for invalid types in strict mode', () => {
      const options = {
        maxTokens: 'not a number' as any
      };

      expect(() => mapOptionsToPython(options, true)).toThrow('MLX Driver parameter validation failed');
    });

    it('should convert string numbers with warning', () => {
      const options = {
        maxTokens: '500' as any,
        temperature: '0.7' as any
      };

      const result = mapOptionsToPython(options, false);

      expect(result).toEqual({
        max_tokens: 500,
        temperature: 0.7
      });
    });

    it('should reject snake_case input parameters', () => {
      const options = {
        max_tokens: 500,
        top_p: 0.9
      } as any;

      expect(() => mapOptionsToPython(options, true)).toThrow('Unknown parameter');
    });

    it('should preserve only supported parameters', () => {
      const options = {
        maxTokens: 500,
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        minP: 0.05,
        repetitionPenalty: 1.1,
        repetitionContextSize: 30,
        presencePenalty: 1.5,
        presenceContextSize: 40,
        unsupportedParam: 'should be filtered'
      } as any;

      const result = mapOptionsToPython(options, false);

      expect(result).toEqual({
        max_tokens: 500,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 50,
        min_p: 0.05,
        repetition_penalty: 1.1,
        repetition_context_size: 30,
        presence_penalty: 1.5,
        presence_context_size: 40
      });
      expect(result).not.toHaveProperty('unsupportedParam');
    });
  });
});
