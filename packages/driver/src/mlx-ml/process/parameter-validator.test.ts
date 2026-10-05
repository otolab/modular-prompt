import { describe, it, expect } from 'vitest';
import { validateOptions, formatValidationResult, getParameterHelp } from './parameter-validator.js';

describe('MLX Parameter Validator', () => {
  describe('validateOptions', () => {
    it('should accept valid camelCase parameters', () => {
      const options = {
        maxTokens: 500,
        temperature: 0.7,
        topP: 0.9,
        topK: 50,
        minP: 0.05,
        repetitionPenalty: 1.1,
        repetitionContextSize: 30,
        presencePenalty: 1.5,
        presenceContextSize: 40
      };

      const result = validateOptions(options);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.validatedOptions).toEqual(options);
    });

    it('should reject snake_case parameters in strict mode', () => {
      const options = {
        max_tokens: 500,
        top_p: 0.9
      };

      const result = validateOptions(options, true);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].type).toBe('unknown_parameter');
      expect(result.errors[0].field).toBe('max_tokens');
      expect(result.errors[1].field).toBe('top_p');
    });

    it('should warn about snake_case parameters in non-strict mode', () => {
      const options = {
        max_tokens: 500,
        top_p: 0.9
      };

      const result = validateOptions(options, false);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0].field).toBe('max_tokens');
      expect(result.warnings[1].field).toBe('top_p');
    });

    it('should clamp values to valid ranges', () => {
      const options = {
        maxTokens: 200000,  // exceeds max
        temperature: -1,     // below min
        topP: 2.0           // exceeds max
      };

      const result = validateOptions(options);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(3);
      expect(result.validatedOptions?.maxTokens).toBe(100000);
      expect(result.validatedOptions?.temperature).toBe(0.0);
      expect(result.validatedOptions?.topP).toBe(1.0);
    });

    it('clamps minP and presencePenalty to their supported ranges', () => {
      const result = validateOptions({
        minP: 2.0,
        presencePenalty: -3.0,
      });

      expect(result.valid).toBe(true);
      expect(result.validatedOptions?.minP).toBe(1.0);
      expect(result.validatedOptions?.presencePenalty).toBe(-2.0);
    });

    it('should convert string numbers to numbers with warning', () => {
      const options = {
        maxTokens: '500' as any,
        temperature: '0.7' as any
      };

      const result = validateOptions(options);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.validatedOptions?.maxTokens).toBe(500);
      expect(result.validatedOptions?.temperature).toBe(0.7);
    });

    it('should reject invalid types', () => {
      const options = {
        maxTokens: true as any,
        temperature: 'invalid' as any
      };

      const result = validateOptions(options);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].type).toBe('invalid_type');
      expect(result.errors[1].type).toBe('invalid_type');
    });

    it('should reject unknown parameters in strict mode', () => {
      const options = {
        maxTokens: 500,
        unknownParam: 'value'
      };

      const result = validateOptions(options, true);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('unknown_parameter');
      expect(result.errors[0].field).toBe('unknownParam');
    });

    it('should return undefined validatedOptions when validation fails', () => {
      const options = {
        invalidParam: 'value'
      };

      const result = validateOptions(options, true);
      expect(result.valid).toBe(false);
      expect(result.validatedOptions).toBeUndefined();
    });
  });

  describe('formatValidationResult', () => {
    it('should format error messages', () => {
      const result = {
        valid: false,
        errors: [
          {
            field: 'max_tokens',
            value: 500,
            message: "Unknown parameter 'max_tokens'",
            type: 'unknown_parameter' as const
          }
        ],
        warnings: [],
        validatedOptions: undefined
      };

      const formatted = formatValidationResult(result);
      expect(formatted).toContain('❌ Validation failed:');
      expect(formatted).toContain("Unknown parameter 'max_tokens'");
    });

    it('should format warning messages', () => {
      const result = {
        valid: true,
        errors: [],
        warnings: [
          {
            field: 'maxTokens',
            value: 200000,
            message: 'Value exceeds maximum',
            correctedValue: 100000
          }
        ],
        validatedOptions: { maxTokens: 100000 }
      };

      const formatted = formatValidationResult(result);
      expect(formatted).toContain('⚠️  Warnings:');
      expect(formatted).toContain('corrected to: 100000');
    });
  });

  describe('getParameterHelp', () => {
    it('should list all available parameters in camelCase', () => {
      const help = getParameterHelp();
      expect(help).toContain('Available MLX parameters (use camelCase format):');
      expect(help).toContain('maxTokens');
      expect(help).toContain('temperature');
      expect(help).toContain('topP');
      expect(help).toContain('topK');
      expect(help).toContain('minP');
      expect(help).toContain('repetitionPenalty');
      expect(help).toContain('repetitionContextSize');
      expect(help).toContain('presencePenalty');
      expect(help).toContain('presenceContextSize');

      // Should NOT contain snake_case versions
      expect(help).not.toContain('max_tokens');
      expect(help).not.toContain('top_p');
      expect(help).not.toContain('top_k');
    });
  });
});
