/**
 * Enhanced logger for @modular-prompt packages
 * - Log level control
 * - Memory accumulation with filtering
 * - JSONL file output
 * - MCP mode support (stdout pollution prevention)
 */

import { appendFile } from 'fs/promises';

// ログレベル定数（型の元となる値）
const LOG_LEVEL_VALUES = ['quiet', 'error', 'warn', 'info', 'verbose', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVEL_VALUES)[number];

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context?: string; // runner/evaluator/experiment など
  message: string;
  args?: any[];
  formatted: string;
}

interface LoggerConfig {
  level: LogLevel;
  accumulateLevel: LogLevel; // 蓄積するログレベル（独立制御）
  isMcpMode: boolean; // MCPサーバーモード時はstdout出力を制限
  prefix?: string; // ログプレフィックス
  context?: string; // ログコンテキスト（runner/evaluator等）
  accumulate: boolean; // ログ蓄積モード
  maxEntries: number; // 蓄積する最大ログエントリ数
  logFile?: string; // JSONL出力先パス
}

const envLogLevel: LogLevel | false =
  LOG_LEVEL_VALUES.includes(process.env.MODULAR_PROMPT_LOG_LEVEL as any)
  && process.env.MODULAR_PROMPT_LOG_LEVEL as LogLevel;

export class Logger {
  // グローバル設定（全インスタンスで共有）
  private static config: LoggerConfig = {
    level: envLogLevel || 'info',
    accumulateLevel: 'debug', // デフォルトで全レベル蓄積
    isMcpMode: false,
    prefix: '',
    context: '',
    accumulate: false,
    maxEntries: 1000,
    logFile: undefined,
  };

  private instanceConfig: Partial<LoggerConfig> = {}; // インスタンス固有設定

  private static logEntries: LogEntry[] = []; // ログエントリ蓄積（全インスタンスで共有）
  private static fileQueue: LogEntry[] = []; // ファイル書き込み用キュー（accumulate設定と独立）

  // ログレベルの数値マッピング（小さいほど重要）
  private readonly LOG_LEVELS: Record<LogLevel, number> = {
    quiet: 0, // 出力なし
    error: 1, // エラーのみ
    warn: 2, // 警告以上
    info: 3, // 情報以上
    verbose: 4, // 詳細情報以上
    debug: 5, // すべて（デバッグ含む）
  };

  constructor(config: Partial<LoggerConfig> = {}) {
    // グローバル設定はクラス定義時に初期化済み
    // 引数で渡された設定はインスタンス設定として適用
    if (Object.keys(config).length > 0) {
      this.configure(config);
    }
  }

  /**
   * グローバル設定を変更（全インスタンスに影響）
   *
   * @example
   * Logger.configure({ level: 'debug' });
   * // または
   * configureLogger({ level: 'debug' });
   */
  static configure(config: Partial<LoggerConfig>): void {
    Logger.config = { ...Logger.config, ...config };
  }

  /**
   * このインスタンスの設定を変更（このインスタンスのみに影響）
   * インスタンス設定がグローバル設定より優先される
   *
   * @example
   * const logger = createLogger('driver');
   * logger.configure({ level: 'verbose' }); // このインスタンスだけverbose
   */
  configure(config: Partial<LoggerConfig>): void {
    this.instanceConfig = { ...this.instanceConfig, ...config };
  }

  /**
   * 新しいcontext付きloggerインスタンスを作成
   * 現在のインスタンス設定を引き継ぎ、contextのみを変更
   *
   * @param contextName - 新しいcontext名
   * @returns 新しいloggerインスタンス
   *
   * @example
   * const baseLogger = new Logger({ prefix: 'app' });
   * const apiLogger = baseLogger.context('api');
   * const dbLogger = baseLogger.context('db');
   */
  context(contextName: string): Logger {
    return new Logger({
      ...this.instanceConfig,
      context: contextName,
    });
  }

  // Computed設定値取得（インスタンス設定 → グローバル設定の優先順位）
  private computedLevel(): LogLevel {
    return this.instanceConfig.level ?? Logger.config.level;
  }

  private computedAccumulateLevel(): LogLevel {
    return this.instanceConfig.accumulateLevel ?? Logger.config.accumulateLevel;
  }

  private computedIsMcpMode(): boolean {
    return this.instanceConfig.isMcpMode ?? Logger.config.isMcpMode;
  }

  private computedPrefix(): string {
    return this.instanceConfig.prefix ?? Logger.config.prefix ?? '';
  }

  private computedContext(): string {
    return this.instanceConfig.context ?? Logger.config.context ?? '';
  }

  private computedAccumulate(): boolean {
    return this.instanceConfig.accumulate ?? Logger.config.accumulate;
  }

  private computedMaxEntries(): number {
    return this.instanceConfig.maxEntries ?? Logger.config.maxEntries;
  }

  private computedLogFile(): string | undefined {
    return this.instanceConfig.logFile ?? Logger.config.logFile;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.LOG_LEVELS[level] <= this.LOG_LEVELS[this.computedLevel()];
  }

  private shouldLogAtLevel(level: LogLevel, targetLevel: LogLevel): boolean {
    return this.LOG_LEVELS[level] <= this.LOG_LEVELS[targetLevel];
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = this.computedPrefix() ? `[${this.computedPrefix()}] ` : '';
    const formattedArgs =
      args.length > 0
        ? ` ${args
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
            .join(' ')}`
        : '';

    return `${timestamp} ${level.toUpperCase()} ${prefix}${message}${formattedArgs}`;
  }

  private async writeToFile(entry: LogEntry): Promise<void> {
    const logFile = this.computedLogFile();
    if (!logFile) {
      return;
    }

    try {
      const jsonLine = JSON.stringify(entry) + '\n';
      await appendFile(logFile, jsonLine, 'utf-8');
    } catch (error) {
      // ファイル書き込みエラーは標準エラー出力に（無限ループ防止のためloggerを使わない）
      // eslint-disable-next-line no-console
      console.error(`Failed to write log file: ${error}`);
    }
  }

  private writeLog(level: LogLevel, message: string, ...args: any[]): void {
    const shouldOutput = this.shouldLog(level);
    const shouldAccumulate =
      this.computedAccumulate() && this.shouldLogAtLevel(level, this.computedAccumulateLevel());
    const shouldQueueForFile = !!this.computedLogFile();

    // 出力もせず蓄積もせずファイルキューにも追加しない場合は早期リターン
    if (!shouldOutput && !shouldAccumulate && !shouldQueueForFile) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, ...args);

    // ログエントリを作成
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.computedContext(),
      message,
      args: args.length > 0 ? args : undefined,
      formatted: formattedMessage,
    };

    // ログエントリを蓄積モードで保存（蓄積レベルで独立判定）
    if (shouldAccumulate) {
      Logger.logEntries.push(logEntry);

      // 最大エントリ数を超えた場合、古いものを削除
      if (Logger.logEntries.length > this.computedMaxEntries()) {
        Logger.logEntries.shift();
      }
    }

    // ファイル書き込み用キューに追加（accumulate設定と独立）
    if (shouldQueueForFile) {
      Logger.fileQueue.push(logEntry);
    }

    // 出力判定に基づいて実際の出力を行う
    if (shouldOutput) {
      // MCPモード時は重要なエラーのみstderrに出力、その他は抑制
      if (this.computedIsMcpMode()) {
        if (level === 'error') {
          // eslint-disable-next-line no-console
          console.error(formattedMessage);
        }
        // MCPモード時はerror以外は出力しない（stdout汚染防止）
        return;
      }

      // 通常モード時の出力先振り分け
      switch (level) {
        case 'error':
          // eslint-disable-next-line no-console
          console.error(formattedMessage);
          break;
        case 'warn':
          // eslint-disable-next-line no-console
          console.warn(formattedMessage);
          break;
        case 'debug':
        case 'verbose':
        case 'info':
        default:
          // eslint-disable-next-line no-console
          console.log(formattedMessage);
          break;
      }
    }
  }

  // ログレベル別メソッド
  error(message: string, ...args: any[]): void {
    this.writeLog('error', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    this.writeLog('warn', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    this.writeLog('info', message, ...args);
  }

  verbose(message: string, ...args: any[]): void {
    this.writeLog('verbose', message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    this.writeLog('debug', message, ...args);
  }

  // verboseのエイリアスとしてlogメソッドを追加
  log(message: string, ...args: any[]): void {
    this.writeLog('verbose', message, ...args);
  }

  // 設定取得（publicメソッド）
  // Note: getterはcomputed値を返す（インスタンス設定 || グローバル設定）

  getLevel(): LogLevel {
    return this.computedLevel();
  }

  isAccumulating(): boolean {
    return this.computedAccumulate();
  }

  // ログエントリ取得メソッド
  getLogEntries(
    options: {
      level?: LogLevel | LogLevel[];
      since?: Date;
      limit?: number;
      search?: string;
      filterByContext?: boolean; // デフォルト: true（このインスタンスのcontextのみ）
    } = {}
  ): LogEntry[] {
    let filtered = [...Logger.logEntries];

    // コンテキストフィルタ（デフォルト有効）
    const filterByContext = options.filterByContext ?? true;
    if (filterByContext) {
      const currentContext = this.computedContext();
      if (currentContext) {
        filtered = filtered.filter(entry => entry.context === currentContext);
      }
    }

    // レベルフィルタ
    if (options.level) {
      const levels = Array.isArray(options.level) ? options.level : [options.level];
      filtered = filtered.filter(entry => levels.includes(entry.level));
    }

    // 時刻フィルタ
    if (options.since) {
      const sinceTime = options.since.getTime();
      filtered = filtered.filter(entry => new Date(entry.timestamp).getTime() >= sinceTime);
    }

    // 検索フィルタ
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(
        entry =>
          entry.message.toLowerCase().includes(searchLower) ||
          entry.formatted.toLowerCase().includes(searchLower)
      );
    }

    // 制限
    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  // ログエントリクリア
  clearLogEntries(): void {
    Logger.logEntries = [];
  }

  // ファイル書き込みキューをクリア
  static clearFileQueue(): void {
    Logger.fileQueue = [];
  }

  // インスタンス設定をクリア（テスト用）
  clearInstanceConfig(): void {
    this.instanceConfig = {};
  }

  // ログ統計情報
  getLogStats(options: { filterByContext?: boolean } = {}): {
    totalEntries: number;
    entriesByLevel: Record<LogLevel, number>;
    oldestEntry?: string;
    newestEntry?: string;
  } {
    // コンテキストフィルタ（デフォルト有効）
    const filterByContext = options.filterByContext ?? true;
    let entries = Logger.logEntries;

    if (filterByContext) {
      const currentContext = this.computedContext();
      if (currentContext) {
        entries = entries.filter(entry => entry.context === currentContext);
      }
    }

    const stats = {
      totalEntries: entries.length,
      entriesByLevel: {
        quiet: 0,
        error: 0,
        warn: 0,
        info: 0,
        verbose: 0,
        debug: 0,
      } as Record<LogLevel, number>,
      oldestEntry: entries[0]?.timestamp,
      newestEntry: entries[entries.length - 1]?.timestamp,
    };

    entries.forEach(entry => {
      stats.entriesByLevel[entry.level]++;
    });

    return stats;
  }

  /**
   * ファイル書き込み用キューの内容をファイルに書き出す（非同期）
   *
   * @param options - フラッシュオプション
   * @param options.filterByContext - コンテキストで絞り込むか（デフォルト: false、全エントリを書き出す）
   * @returns 書き込み完了Promise
   */
  async flush(options: { filterByContext?: boolean } = {}): Promise<void> {
    const logFile = this.computedLogFile();
    if (!logFile || Logger.fileQueue.length === 0) {
      return;
    }

    // 書き込むエントリを取得
    const filterByContext = options.filterByContext ?? false;
    let entries = Logger.fileQueue;

    if (filterByContext) {
      const currentContext = this.computedContext();
      if (currentContext) {
        entries = entries.filter(entry => entry.context === currentContext);
      }
    }

    // 全エントリを順序を保持してファイルに書き込み
    for (const entry of entries) {
      await this.writeToFile(entry);
    }

    // 書き込み完了後、キューから削除
    if (!filterByContext) {
      Logger.fileQueue = [];
    } else {
      // コンテキストフィルタ時は、書き込んだエントリのみ削除
      const currentContext = this.computedContext();
      Logger.fileQueue = Logger.fileQueue.filter(
        entry => entry.context !== currentContext
      );
    }
  }
}

// デフォルトインスタンスをエクスポート
export const logger = new Logger();