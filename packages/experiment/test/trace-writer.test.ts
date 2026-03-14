/**
 * Trace writer tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, readFile, rm, access } from 'fs/promises';
import { Logger } from '@modular-prompt/utils';
import { writeTrace } from '../src/trace/writer.js';

describe('writeTrace', () => {
  let tempDir: string;

  beforeEach(async () => {
    // 各テスト前にLogger蓄積をクリア
    const logger = new Logger();
    logger.clearLogEntries();

    // 一時ディレクトリを作成
    const randomId = Math.random().toString(36).substring(2, 15);
    tempDir = join(tmpdir(), `trace-writer-test-${randomId}`);
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ディレクトリが存在しない場合は無視
    }

    // Logger設定を元に戻す
    Logger.configure({ accumulate: false });
  });

  it('蓄積エントリがない場合はディレクトリもファイルも作らない', async () => {
    // Logger蓄積を無効化
    Logger.configure({ accumulate: false });

    await writeTrace(tempDir);

    // ディレクトリが存在しないことを確認
    await expect(access(tempDir)).rejects.toThrow();
  });

  it('単一contextのログが正しく書き出される', async () => {
    // Logger蓄積を有効化
    Logger.configure({ accumulate: true });

    const logger = new Logger({ context: 'default' });
    logger.info('Test message 1');
    logger.warn('Test message 2');
    logger.error('Test message 3');

    await writeTrace(tempDir);

    // summary.jsonの検証
    const summaryContent = await readFile(join(tempDir, 'summary.json'), 'utf-8');
    const summary = JSON.parse(summaryContent);

    expect(summary.totalEntries).toBe(3);
    expect(summary.contexts).toContain('default');

    // default.logの検証
    const logContent = await readFile(join(tempDir, 'default.log'), 'utf-8');

    expect(logContent).toContain('Test message 1');
    expect(logContent).toContain('Test message 2');
    expect(logContent).toContain('Test message 3');
    expect(logContent).toContain('INFO');
    expect(logContent).toContain('WARN');
    expect(logContent).toContain('ERROR');
  });

  it('複数contextのログがファイルに分かれる', async () => {
    Logger.configure({ accumulate: true });

    const logger1 = new Logger({ context: 'agentic' });
    logger1.info('Agentic message');

    const logger2 = new Logger({ context: 'agentic:task:1:planning' });
    logger2.debug('Planning message');

    await writeTrace(tempDir);

    // summary.jsonの検証
    const summaryContent = await readFile(join(tempDir, 'summary.json'), 'utf-8');
    const summary = JSON.parse(summaryContent);

    expect(summary.totalEntries).toBe(2);
    expect(summary.contexts).toContain('agentic');
    expect(summary.contexts).toContain('agentic:task:1:planning');

    // agentic.logの検証
    const agenticLog = await readFile(join(tempDir, 'agentic.log'), 'utf-8');
    expect(agenticLog).toContain('Agentic message');
    expect(agenticLog).not.toContain('Planning message');

    // agentic_task_1_planning.logの検証
    const planningLog = await readFile(join(tempDir, 'agentic_task_1_planning.log'), 'utf-8');
    expect(planningLog).toContain('Planning message');
    expect(planningLog).not.toContain('Agentic message');
  });

  it('argsを含むログがpretty-printされる', async () => {
    Logger.configure({ accumulate: true });

    const logger = new Logger({ context: 'test' });
    const testObject = {
      prompt: 'Test prompt',
      options: {
        temperature: 0.7,
        maxTokens: 1000,
      },
    };

    logger.verbose('[prompt]', testObject);

    await writeTrace(tempDir);

    // test.logの検証
    const logContent = await readFile(join(tempDir, 'test.log'), 'utf-8');

    expect(logContent).toContain('[prompt]');
    // pretty-printされたJSONが含まれることを確認
    expect(logContent).toContain('"prompt": "Test prompt"');
    expect(logContent).toContain('"temperature": 0.7');
    expect(logContent).toContain('"maxTokens": 1000');
  });

  it('summary.jsonの内容が正しい', async () => {
    Logger.configure({ accumulate: true });

    const logger1 = new Logger({ context: 'context1' });
    const logger2 = new Logger({ context: 'context2' });

    logger1.info('Message 1');
    logger1.warn('Message 2');
    logger2.error('Message 3');
    logger2.debug('Message 4');
    logger2.verbose('Message 5');

    await writeTrace(tempDir);

    const summaryContent = await readFile(join(tempDir, 'summary.json'), 'utf-8');
    const summary = JSON.parse(summaryContent);

    expect(summary.totalEntries).toBe(5);
    expect(summary.contexts).toHaveLength(2);
    expect(summary.contexts).toContain('context1');
    expect(summary.contexts).toContain('context2');
    expect(summary.timestamp).toBeDefined();
    // timestampがISO形式であることを確認
    expect(() => new Date(summary.timestamp)).not.toThrow();
  });
});
