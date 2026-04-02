import { Logger, type LogEntry } from '@modular-prompt/utils';

/**
 * クエリ実行中のログを収集し、QueryResult に付与するためのヘルパー。
 *
 * 各ドライバーの query/streamQuery の冒頭で mark() を呼び、
 * 結果返却前に collect() で logEntries/errors を取得する。
 *
 * @example
 * ```typescript
 * const ql = new QueryLogger('OpenAI');
 *
 * async streamQuery(prompt, options) {
 *   ql.mark();
 *   try {
 *     // ... API呼び出し
 *     return { stream, result: resultPromise.then(r => ({ ...r, ...ql.collect() })) };
 *   } catch (error) {
 *     ql.log.error('Query error:', error);
 *     return { stream: emptyStream(), result: Promise.resolve({ content: '', finishReason: 'error', ...ql.collect() }) };
 *   }
 * }
 * ```
 */
export class QueryLogger {
  private readonly logger: Logger;
  private startTime: Date;

  constructor(prefix: string, context: string = 'driver') {
    this.logger = new Logger({
      prefix,
      context,
      accumulate: true,
    });
    this.startTime = new Date();
  }

  /** ログ収集の開始時刻をリセット（各 query 呼び出しの冒頭で呼ぶ） */
  mark(): void {
    this.startTime = new Date();
  }

  /** Logger インスタンスへのアクセス */
  get log(): Logger {
    return this.logger;
  }

  /** クエリスコープのログエントリを収集し、QueryResult にスプレッドできる形で返す */
  collect(): { logEntries?: LogEntry[]; errors?: LogEntry[] } {
    const logEntries = this.logger.getLogEntries({
      since: this.startTime,
      filterByContext: true,
    });
    const errors = logEntries.filter(e => e.level === 'error');

    return {
      logEntries: logEntries.length > 0 ? logEntries : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
