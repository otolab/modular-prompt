/**
 * Driver Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DriverRegistry } from './registry.js';
import type { ModelSpec, DriverSelectionCriteria, DriverProvider } from './types.js';

describe('DriverRegistry', () => {
  let registry: DriverRegistry;

  beforeEach(() => {
    registry = new DriverRegistry();
  });

  describe('registerModel', () => {
    it('should register a model specification', () => {
      const spec: ModelSpec = {
        model: 'test-model',
        provider: 'echo',
        capabilities: ['local', 'fast'],
        maxInputTokens: 1000,
        maxOutputTokens: 500,
      };

      registry.registerModel(spec);

      // selectModelを使って登録されたことを確認
      const result = registry.selectModel({
        requiredCapabilities: ['local', 'fast']
      });

      expect(result).toBeDefined();
      expect(result?.model.model).toBe('test-model');
      expect(result?.model.capabilities).toContain('local');
    });

    it('should set default values for priority', () => {
      const spec: ModelSpec = {
        model: 'test-model',
        provider: 'echo',
        capabilities: [],
      };

      registry.registerModel(spec);

      const result = registry.selectModel({});

      expect(result?.model.disabled).toBeUndefined();
      expect(result?.model.priority).toBe(0);
    });
  });

  describe('selectModel', () => {
    beforeEach(() => {
      // Register test models
      registry.registerModel({
        model: 'local-fast-model',
        provider: 'mlx',
        capabilities: ['local', 'fast', 'streaming'],
        priority: 10,
      });

      registry.registerModel({
        model: 'cloud-model',
        provider: 'openai',
        capabilities: ['streaming', 'tools', 'reasoning', 'large-context'],
        maxInputTokens: 128000,
        priority: 20,
      });

      registry.registerModel({
        model: 'japanese-model',
        provider: 'mlx',
        capabilities: ['local', 'japanese', 'chat'],
        priority: 15,
      });
    });

    it('should select model with required capabilities', () => {
      const criteria: DriverSelectionCriteria = {
        requiredCapabilities: ['local', 'fast'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.model.model).toBe('local-fast-model');
      expect(result?.model.capabilities).toContain('local');
      expect(result?.model.capabilities).toContain('fast');
    });

    it('should prefer model with higher priority', () => {
      const criteria: DriverSelectionCriteria = {
        requiredCapabilities: ['streaming'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      // cloud-model has priority 20, higher than local-fast-model's 10
      expect(result?.model.model).toBe('cloud-model');
      expect(result?.model.priority).toBe(20);
    });

    it('should exclude models with excluded capabilities', () => {
      const criteria: DriverSelectionCriteria = {
        requiredCapabilities: ['local'],
        excludeCapabilities: ['japanese'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.model.model).toBe('local-fast-model');
    });

    it('should filter by provider', () => {
      const criteria: DriverSelectionCriteria = {
        providers: ['openai'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.model.provider).toBe('openai');
    });

    it('should exclude specific providers', () => {
      const criteria: DriverSelectionCriteria = {
        excludeProviders: ['openai'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.model.provider).not.toBe('openai');
    });

    it('should check minimum token requirements', () => {
      const criteria: DriverSelectionCriteria = {
        minInputTokens: 100000,
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.model.model).toBe('cloud-model');
      expect(result?.model.maxInputTokens).toBeGreaterThanOrEqual(100000);
    });

    it('should prefer local when preferLocal is true', () => {
      const criteria: DriverSelectionCriteria = {
        preferLocal: true,
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.model.capabilities).toContain('local');
    });

    it('should return null when no model matches', () => {
      const criteria: DriverSelectionCriteria = {
        requiredCapabilities: ['non-existent-capability'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeNull();
    });

    it('should include warnings for missing preferred capabilities', () => {
      const criteria: DriverSelectionCriteria = {
        requiredCapabilities: ['local'],
        preferredCapabilities: ['fast', 'non-existent'],
      };

      const result = registry.selectModel(criteria);

      expect(result).toBeDefined();
      expect(result?.warnings).toBeDefined();
      expect(result?.warnings?.[0]).toContain('non-existent');
    });
  });

  describe('createDriver', () => {
    it('should throw error when no factory registered', async () => {
      const spec: ModelSpec = {
        model: 'test-model',
        provider: 'unknown-provider' as DriverProvider,
        capabilities: [],
      };

      await expect(registry.createDriver(spec)).rejects.toThrow(
        'No factory registered for provider: unknown-provider'
      );
    });

    it('should create driver when factory is registered', async () => {
      const spec: ModelSpec = {
        model: 'test-model',
        provider: 'echo',
        capabilities: [],
      };

      // Echo driver factory is registered by default
      const driver = await registry.createDriver(spec);

      expect(driver).toBeDefined();
      expect(driver.query).toBeDefined();
      expect(driver.streamQuery).toBeDefined();
    });
  });

  describe('selectAndCreateDriver', () => {
    it('should return null when no matching model', async () => {
      const driver = await registry.selectAndCreateDriver(
        ['non-existent-capability']
      );

      expect(driver).toBeNull();
    });

    it('should select and create driver when model matches', async () => {
      registry.registerModel({
        model: 'test-model',
        provider: 'echo',
        capabilities: ['test'],
      });

      const driver = await registry.selectAndCreateDriver(['test']);

      expect(driver).toBeDefined();
      expect(driver?.query).toBeDefined();
    });

    it('should return null when no factory registered', async () => {
      registry.registerModel({
        model: 'test-model',
        provider: 'unknown-provider' as DriverProvider,
        capabilities: ['test'],
      });

      const driver = await registry.selectAndCreateDriver(['test']);

      expect(driver).toBeNull();
    });
  });
});