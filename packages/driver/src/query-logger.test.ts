import { describe, it, expect, beforeEach } from 'vitest';
import { Logger } from '@modular-prompt/utils';
import { QueryLogger } from './query-logger.js';

describe('QueryLogger', () => {
  let ql: QueryLogger;

  beforeEach(() => {
    // 静的 logEntries をクリアして前テストの残留を防ぐ
    new Logger().clearLogEntries();
    ql = new QueryLogger('Test', 'query-logger-test');
  });

  it('should collect log entries after mark()', () => {
    ql.mark();
    ql.log.info('test message');
    const { logEntries, errors } = ql.collect();

    expect(logEntries).toHaveLength(1);
    expect(logEntries![0].message).toBe('test message');
    expect(logEntries![0].level).toBe('info');
    expect(errors).toBeUndefined();
  });

  it('should separate errors from logEntries', () => {
    ql.mark();
    ql.log.info('info message');
    ql.log.error('error message');
    const { logEntries, errors } = ql.collect();

    expect(logEntries).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors![0].message).toBe('error message');
    expect(errors![0].level).toBe('error');
  });

  it('should return undefined for empty collections', () => {
    ql.mark();
    const { logEntries, errors } = ql.collect();

    expect(logEntries).toBeUndefined();
    expect(errors).toBeUndefined();
  });

  it('should scope entries by mark() timing', async () => {
    ql.log.info('before mark');
    await new Promise(r => setTimeout(r, 10));

    ql.mark();
    ql.log.info('after mark');
    const { logEntries } = ql.collect();

    expect(logEntries).toHaveLength(1);
    expect(logEntries![0].message).toBe('after mark');
  });

  it('should not include warn in errors', () => {
    ql.mark();
    ql.log.warn('warning message');
    const { logEntries, errors } = ql.collect();

    expect(logEntries).toHaveLength(1);
    expect(errors).toBeUndefined();
  });
});
