/**
 * Driver manager for caching and cleanup
 */

import type { AIService, ModelSpec, AIDriver } from '@modular-prompt/driver';
import type { DriverSet } from '@modular-prompt/process';
import { logger as baseLogger } from '../logger.js';

const logger = baseLogger.context('driver-manager');

export class DriverManager {
  private cache = new Map<string, AIDriver>();

  /**
   * Get or create driver for a model
   *
   * Drivers are cached by model name.
   * Reuses existing driver if available.
   *
   * @param aiService - AIService instance
   * @param modelName - Model name for caching
   * @param modelSpec - Model spec
   * @returns Driver instance
   */
  async getOrCreate(aiService: AIService, modelName: string, modelSpec: ModelSpec): Promise<AIDriver> {
    if (this.cache.has(modelName)) {
      logger.verbose(`Using cached driver for ${modelName}`);
      return this.cache.get(modelName)!;
    }

    logger.info(`Creating new driver for ${modelName} (${modelSpec.provider}:${modelSpec.model})`);
    const driver = await aiService.createDriver(modelSpec);
    this.cache.set(modelName, driver);
    return driver;
  }

  /**
   * Get or create DriverSet
   *
   * @param aiService - AIService instance
   * @param roleMapping - Role to model name mapping
   * @param allModels - All model configurations
   * @returns DriverSet instance
   */
  async getOrCreateDriverSet(
    aiService: AIService,
    roleMapping: Record<string, string>,
    allModels: Record<string, ModelSpec>
  ): Promise<DriverSet> {
    const result: Record<string, AIDriver> = {};
    for (const [role, modelName] of Object.entries(roleMapping)) {
      const spec = allModels[modelName];
      result[role] = await this.getOrCreate(aiService, modelName, spec);
    }
    return result as unknown as DriverSet;
  }

  /**
   * Close and remove a specific driver from cache
   *
   * @param modelName - Model name to close
   */
  async close(modelName: string): Promise<void> {
    const driver = this.cache.get(modelName);

    if (!driver) {
      return;
    }

    try {
      if (typeof driver.close === 'function') {
        await driver.close();
        logger.verbose(`Closed driver: ${modelName}`);
      }
      this.cache.delete(modelName);
    } catch (error) {
      logger.warn(`Failed to close driver ${modelName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Close all cached drivers
   */
  async cleanup(): Promise<void> {
    console.log();
    console.log('🧹 Cleaning up...');

    for (const [key, driver] of this.cache.entries()) {
      try {
        if (driver && typeof driver.close === 'function') {
          await driver.close();
          logger.verbose(`Closed driver: ${key}`);
        }
      } catch (error) {
        logger.warn(`Failed to close driver ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log('✅ Cleanup completed');
  }
}
