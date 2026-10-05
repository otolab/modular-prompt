import { describe, it, expect } from 'vitest';
import type { MlxMlModelOptions } from './types.js';

describe('MlxMlModelOptions Type Definition', () => {
  it('should use camelCase for all option properties', () => {
    // This test verifies that the type definition uses camelCase
    const validOptions: MlxMlModelOptions = {
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

    // Verify all properties are defined
    expect(validOptions.maxTokens).toBe(500);
    expect(validOptions.temperature).toBe(0.7);
    expect(validOptions.topP).toBe(0.9);
    expect(validOptions.topK).toBe(50);
    expect(validOptions.minP).toBe(0.05);
    expect(validOptions.repetitionPenalty).toBe(1.1);
    expect(validOptions.repetitionContextSize).toBe(30);
    expect(validOptions.presencePenalty).toBe(1.5);
    expect(validOptions.presenceContextSize).toBe(40);
  });

  it('should allow undefined values for all options', () => {
    const emptyOptions: MlxMlModelOptions = {};

    expect(emptyOptions.maxTokens).toBeUndefined();
    expect(emptyOptions.temperature).toBeUndefined();
    expect(emptyOptions.topP).toBeUndefined();
    expect(emptyOptions.topK).toBeUndefined();
    expect(emptyOptions.minP).toBeUndefined();
    expect(emptyOptions.repetitionPenalty).toBeUndefined();
    expect(emptyOptions.repetitionContextSize).toBeUndefined();
    expect(emptyOptions.presencePenalty).toBeUndefined();
    expect(emptyOptions.presenceContextSize).toBeUndefined();
  });

  it('should allow partial options', () => {
    const partialOptions: MlxMlModelOptions = {
      maxTokens: 1000,
      temperature: 0.5
    };

    expect(partialOptions.maxTokens).toBe(1000);
    expect(partialOptions.temperature).toBe(0.5);
    expect(partialOptions.topP).toBeUndefined();
    expect(partialOptions.topK).toBeUndefined();
  });

  it('should support dynamic property access via index signature', () => {
    const options: MlxMlModelOptions = {
      maxTokens: 500
    };

    // Should be able to access via string index
    expect(options['maxTokens']).toBe(500);
    expect(options['temperature']).toBeUndefined();

    // Can dynamically set properties
    options['temperature'] = 0.8;
    expect(options.temperature).toBe(0.8);
  });
});
