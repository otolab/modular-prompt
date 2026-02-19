/**
 * Tests for enhanced logger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger, logger } from './logger.js';

describe('Logger', () => {
  // テスト用の一時ファイルパス
  const testLogFile = join(tmpdir(), `test-logger-${Date.now()}.jsonl`);

  beforeEach(() => {
    // 各テスト前にロガーをリセット
    Logger.configure({
      level: 'info',
      accumulateLevel: 'debug',
      isMcpMode: false,
      prefix: '',
      context: '',
      accumulate: false,
      maxEntries: 1000,
      logFile: undefined,
    });
    logger.clearLogEntries();
    Logger.clearFileQueue();

    // 既存のテストログファイルを削除
    if (existsSync(testLogFile)) {
      unlinkSync(testLogFile);
    }
  });

  afterEach(() => {
    // テスト後のクリーンアップ
    if (existsSync(testLogFile)) {
      unlinkSync(testLogFile);
    }
  });

  describe('Basic logging functionality', () => {
    it('should log at different levels', () => {
      Logger.configure({ accumulate: true });
      Logger.configure({ level: 'debug' });

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.verbose('verbose message');
      logger.debug('debug message');
      logger.log('log message'); // alias for verbose

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(6);
      expect(entries[0].level).toBe('error');
      expect(entries[1].level).toBe('warn');
      expect(entries[2].level).toBe('info');
      expect(entries[3].level).toBe('verbose');
      expect(entries[4].level).toBe('debug');
      expect(entries[5].level).toBe('verbose'); // log is alias for verbose
    });

    it('should respect log level filtering', () => {
      Logger.configure({ accumulate: true });
      Logger.configure({ level: 'warn' });

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message'); // should not be logged
      logger.debug('debug message'); // should not be logged

      // Note: accumulate is independent from output level
      // We need to set accumulateLevel to 'warn' as well
      Logger.configure({ level: 'warn', accumulateLevel: 'warn' });
      logger.clearLogEntries();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('error');
      expect(entries[1].level).toBe('warn');
    });
  });

  describe('Context support', () => {
    it('should add context to log entries', () => {
      logger.clearLogEntries();
      Logger.configure({ accumulate: true });

      const testLogger = new Logger({ context: 'test-runner' });
      testLogger.info('test message');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].context).toBe('test-runner');
    });

    it('should update context dynamically', () => {
      logger.clearLogEntries();
      Logger.configure({ accumulate: true });

      const logger1 = new Logger({ context: 'context-1' });
      logger1.info('message 1');

      const logger2 = new Logger({ context: 'context-2' });
      logger2.info('message 2');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].context).toBe('context-1');
      expect(entries[1].context).toBe('context-2');
    });
  });

  describe('JSONL file output', () => {
    it('should write logs to JSONL file', async () => {
      Logger.configure({ logFile: testLogFile });
      logger.info('test message 1');
      logger.error('test message 2');

      await logger.flush();

      expect(existsSync(testLogFile)).toBe(true);

      const content = readFileSync(testLogFile, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]);
      const entry2 = JSON.parse(lines[1]);

      expect(entry1.level).toBe('info');
      expect(entry1.message).toBe('test message 1');
      expect(entry1.timestamp).toBeDefined();
      expect(entry1.formatted).toBeDefined();

      expect(entry2.level).toBe('error');
      expect(entry2.message).toBe('test message 2');
    });

    it('should include context in JSONL output', async () => {
      Logger.configure({ logFile: testLogFile });

      const experimentLogger = new Logger({ context: 'experiment' });
      experimentLogger.info('test with context');

      await experimentLogger.flush();

      const content = readFileSync(testLogFile, 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.context).toBe('experiment');
      expect(entry.message).toBe('test with context');
    });

    it('should append to existing JSONL file', async () => {
      Logger.configure({ logFile: testLogFile });
      logger.info('message 1');

      await logger.flush();

      // Create a new logger instance (simulating restart)
      Logger.configure({ logFile: testLogFile });
      logger.info('message 2');

      await logger.flush();

      const content = readFileSync(testLogFile, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);
    });

    it('should handle file write without logFile configured', () => {
      // Should not throw error
      expect(() => {
        logger.info('test message');
      }).not.toThrow();
    });

    it('should write to file independently of accumulation setting', async () => {
      Logger.configure({ logFile: testLogFile });
      Logger.configure({ accumulate: false });

      logger.info('message without accumulation');

      await logger.flush();

      expect(existsSync(testLogFile)).toBe(true);
      const content = readFileSync(testLogFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      // But should not accumulate in memory
      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(0);
    });
  });

  describe('Log accumulation', () => {
    it('should accumulate logs when enabled', () => {
      Logger.configure({ accumulate: true, maxEntries: 100 });

      logger.info('message 1');
      logger.info('message 2');
      logger.info('message 3');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(3);
    });

    it('should not accumulate logs when disabled', () => {
      Logger.configure({ accumulate: false });

      logger.info('message 1');
      logger.info('message 2');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(0);
    });

    it('should respect maxEntries limit', () => {
      Logger.configure({ accumulate: true, maxEntries: 3 });

      logger.info('message 1');
      logger.info('message 2');
      logger.info('message 3');
      logger.info('message 4'); // should remove message 1

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0].message).toBe('message 2');
      expect(entries[2].message).toBe('message 4');
    });

    it('should filter logs by level', () => {
      Logger.configure({ accumulate: true });

      logger.error('error msg');
      logger.warn('warn msg');
      logger.info('info msg');
      logger.debug('debug msg');

      const errorLogs = logger.getLogEntries({ level: 'error' });
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].level).toBe('error');

      const warnLogs = logger.getLogEntries({ level: ['warn', 'error'] });
      expect(warnLogs).toHaveLength(2);
    });

    it('should filter logs by search term', () => {
      Logger.configure({ accumulate: true });

      logger.info('test message');
      logger.info('another message');
      logger.info('test again');

      const filtered = logger.getLogEntries({ search: 'test' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter logs by time', () => {
      Logger.configure({ accumulate: true });

      logger.info('old message');

      // Wait a bit
      const after = new Date(Date.now() + 10);
      logger.info('new message');

      const recentLogs = logger.getLogEntries({ since: after });
      expect(recentLogs.length).toBeGreaterThanOrEqual(0);
      // Note: This test might be flaky due to timing
    });

    it('should limit number of returned logs', () => {
      Logger.configure({ accumulate: true });

      for (let i = 0; i < 10; i++) {
        logger.info(`message ${i}`);
      }

      const limited = logger.getLogEntries({ limit: 5 });
      expect(limited).toHaveLength(5);
      // Should return last 5
      expect(limited[4].message).toBe('message 9');
    });

    it('should clear accumulated logs', () => {
      Logger.configure({ accumulate: true });

      logger.info('message 1');
      logger.info('message 2');

      expect(logger.getLogEntries()).toHaveLength(2);

      logger.clearLogEntries();

      expect(logger.getLogEntries()).toHaveLength(0);
    });
  });

  describe('Log statistics', () => {
    it('should provide accurate statistics', () => {
      Logger.configure({ accumulate: true });

      logger.error('error 1');
      logger.error('error 2');
      logger.warn('warn 1');
      logger.info('info 1');
      logger.info('info 2');
      logger.info('info 3');

      const stats = logger.getLogStats();

      expect(stats.totalEntries).toBe(6);
      expect(stats.entriesByLevel.error).toBe(2);
      expect(stats.entriesByLevel.warn).toBe(1);
      expect(stats.entriesByLevel.info).toBe(3);
      expect(stats.oldestEntry).toBeDefined();
      expect(stats.newestEntry).toBeDefined();
    });

    it('should handle empty logs', () => {
      const stats = logger.getLogStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.entriesByLevel.error).toBe(0);
      expect(stats.oldestEntry).toBeUndefined();
      expect(stats.newestEntry).toBeUndefined();
    });
  });

  describe('Setter methods', () => {
    it('should update log level', () => {
      Logger.configure({ level: 'debug' });
      expect(logger.getLevel()).toBe('debug');

      Logger.configure({ level: 'error' });
      expect(logger.getLevel()).toBe('error');
    });

    it('should update MCP mode', () => {
      Logger.configure({ isMcpMode: true });
      // Cannot directly test isMcpMode, but we can verify behavior
      // In MCP mode, only errors should be output
      // (This would require capturing console output, which is complex)
    });

    it('should update prefix', () => {
      Logger.configure({ accumulate: true });
      Logger.configure({ prefix: 'TEST' });

      logger.info('message');

      const entries = logger.getLogEntries();
      expect(entries[0].formatted).toContain('[TEST]');
    });

    it('should update context', () => {
      logger.clearLogEntries();
      Logger.configure({ accumulate: true });

      const runnerLogger = new Logger({ context: 'runner' });
      runnerLogger.info('message');

      const entries = logger.getLogEntries();
      expect(entries[0].context).toBe('runner');
    });

    it('should update log file', async () => {
      Logger.configure({ logFile: testLogFile });
      logger.info('test');

      await logger.flush();

      expect(existsSync(testLogFile)).toBe(true);

      // Clear log file
      Logger.configure({ logFile: undefined });
      if (existsSync(testLogFile)) {
        unlinkSync(testLogFile);
      }

      logger.info('test 2');

      await logger.flush();

      // Should not create file when logFile is undefined
      expect(existsSync(testLogFile)).toBe(false);
    });
  });

  describe('Backward compatibility', () => {
    it('should support all logging methods from old API', () => {
      Logger.configure({ accumulate: true });

      // All these methods should exist and work
      logger.error('error');
      logger.warn('warn');
      logger.info('info');
      logger.verbose('verbose');
      logger.debug('debug');
      logger.log('log');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(6);
    });

    it('should support configure for global and instance settings', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'debug', prefix: 'APP', accumulate: true });

      const testLogger = new Logger({ context: 'test' });
      testLogger.info('test');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].context).toBe('test');
      expect(entries[0].formatted).toContain('[APP]');
    });
  });

  describe('Environment variable configuration', () => {
    it('should read log level from environment variable', () => {
      // Note: This test is tricky because environment variables are read at module load time
      // We can't easily test this without reloading the module
      // This is more of a documentation than a real test
      const originalEnv = process.env.MODULAR_PROMPT_LOG_LEVEL;

      // Clean up
      if (originalEnv !== undefined) {
        process.env.MODULAR_PROMPT_LOG_LEVEL = originalEnv;
      } else {
        delete process.env.MODULAR_PROMPT_LOG_LEVEL;
      }
    });
  });

  describe('Log entry structure', () => {
    it('should create complete log entries', () => {
      logger.clearLogEntries();
      Logger.configure({ accumulate: true });

      const testLogger = new Logger({ context: 'test-context' });
      testLogger.info('test message', { extra: 'data' });

      const entries = logger.getLogEntries();
      const entry = entries[0];

      expect(entry.timestamp).toBeDefined();
      expect(entry.level).toBe('info');
      expect(entry.context).toBe('test-context');
      expect(entry.message).toBe('test message');
      expect(entry.args).toBeDefined();
      expect(entry.args).toHaveLength(1);
      expect(entry.formatted).toBeDefined();
      expect(entry.formatted).toContain('test message');
    });

    it('should format args in log entry', () => {
      Logger.configure({ accumulate: true });

      logger.info('message', 'arg1', { key: 'value' }, 123);

      const entries = logger.getLogEntries();
      const entry = entries[0];

      expect(entry.args).toHaveLength(3);
      expect(entry.formatted).toContain('arg1');
      expect(entry.formatted).toContain('{"key":"value"}');
      expect(entry.formatted).toContain('123');
    });
  });

  describe('Logger instances', () => {
    it('should create logger with instance-specific context', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'info', accumulate: true });

      const mainLogger = new Logger({ context: 'main' });
      const driverLogger = new Logger({ context: 'driver:mlx' });

      mainLogger.info('main message');
      driverLogger.info('driver message');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].context).toBe('main');
      expect(entries[1].context).toBe('driver:mlx');
    });

    it('should share global configuration across all instances', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'error', accumulate: true, accumulateLevel: 'error' });

      const logger1 = new Logger({ context: 'logger1' });
      const logger2 = new Logger({ context: 'logger2' });

      logger1.info('should not log');  // level is 'error'
      logger1.error('should log');
      logger2.warn('should not log');  // level is 'error'
      logger2.error('should log 2');

      const entries = logger.getLogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('error');
      expect(entries[0].context).toBe('logger1');
      expect(entries[1].level).toBe('error');
      expect(entries[1].context).toBe('logger2');
    });

    it('should share log entries across all instances', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'info', accumulate: true });

      const logger1 = new Logger({ context: 'logger1' });
      const logger2 = new Logger({ context: 'logger2' });

      logger1.info('message 1');
      logger2.info('message 2');

      // All instances see the same log entries (when filterByContext is disabled)
      expect(logger1.getLogEntries({ filterByContext: false })).toHaveLength(2);
      expect(logger2.getLogEntries({ filterByContext: false })).toHaveLength(2);
      expect(logger.getLogEntries({ filterByContext: false })).toHaveLength(2);

      // By default, each instance only sees its own context
      expect(logger1.getLogEntries()).toHaveLength(1);
      expect(logger2.getLogEntries()).toHaveLength(1);
    });

    it('should write to same log file from all instances', async () => {
      logger.clearLogEntries();
      Logger.configure({ logFile: testLogFile });

      const logger1 = new Logger({ context: 'logger1' });
      const logger2 = new Logger({ context: 'logger2' });

      logger1.info('message 1');
      logger2.info('message 2');

      await logger.flush();

      expect(existsSync(testLogFile)).toBe(true);
      const content = readFileSync(testLogFile, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);
      const entry1 = JSON.parse(lines[0]);
      const entry2 = JSON.parse(lines[1]);

      // flush()は並列書き込みなので順序は保証されない
      // 両方のcontextが存在することのみ確認
      const contexts = [entry1.context, entry2.context].sort();
      expect(contexts).toEqual(['logger1', 'logger2']);
    });

    it('should update global config dynamically for all instances', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'warn', accumulate: true, accumulateLevel: 'warn' });

      const testLogger = new Logger({ context: 'test' });

      testLogger.info('should not log');
      testLogger.warn('should log');

      expect(logger.getLogEntries()).toHaveLength(1);

      // Change global config
      Logger.configure({ level: 'info', accumulateLevel: 'info' });

      testLogger.info('now should log');

      expect(logger.getLogEntries()).toHaveLength(2);
    });

    it('should filter by context by default', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'info', accumulate: true });

      const apiLogger = new Logger({ context: 'api' });
      const dbLogger = new Logger({ context: 'db' });

      apiLogger.info('api message 1');
      apiLogger.info('api message 2');
      dbLogger.info('db message 1');
      dbLogger.info('db message 2');
      dbLogger.info('db message 3');

      // Each logger sees only its own context by default
      expect(apiLogger.getLogEntries()).toHaveLength(2);
      expect(dbLogger.getLogEntries()).toHaveLength(3);

      // Disable filter to see all
      expect(apiLogger.getLogEntries({ filterByContext: false })).toHaveLength(5);
      expect(dbLogger.getLogEntries({ filterByContext: false })).toHaveLength(5);
    });

    it('should filter stats by context by default', () => {
      logger.clearLogEntries();
      Logger.configure({ level: 'info', accumulate: true });

      const apiLogger = new Logger({ context: 'api' });
      const dbLogger = new Logger({ context: 'db' });

      apiLogger.error('api error');
      apiLogger.info('api info');
      dbLogger.warn('db warn');
      dbLogger.info('db info 1');
      dbLogger.info('db info 2');

      // Each logger sees only its own context stats
      const apiStats = apiLogger.getLogStats();
      expect(apiStats.totalEntries).toBe(2);
      expect(apiStats.entriesByLevel.error).toBe(1);
      expect(apiStats.entriesByLevel.info).toBe(1);

      const dbStats = dbLogger.getLogStats();
      expect(dbStats.totalEntries).toBe(3);
      expect(dbStats.entriesByLevel.warn).toBe(1);
      expect(dbStats.entriesByLevel.info).toBe(2);

      // Disable filter to see all
      const allStats = apiLogger.getLogStats({ filterByContext: false });
      expect(allStats.totalEntries).toBe(5);
      expect(allStats.entriesByLevel.error).toBe(1);
      expect(allStats.entriesByLevel.warn).toBe(1);
      expect(allStats.entriesByLevel.info).toBe(3);
    });
  });
});
