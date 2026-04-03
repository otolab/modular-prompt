# Utilities

## 概要

`@modular-prompt/utils`パッケージは、Moduler Promptシステムで使用される共通ユーティリティを提供します。主要な機能として、ドライバレジストリとログシステムが含まれています。

## ログシステム (Logger System)

### 概要

`@modular-prompt/utils`のログシステムは、構造化ログ出力とログレベル制御機能を提供します。開発・本番環境での適切なログ出力を支援します。

### なぜログシステムが必要か

1. **環境別の出力制御**: 本番環境では最小限のログ、開発環境では詳細なデバッグ情報を出力
2. **構造化データの記録**: 文字列だけでなく、オブジェクトとして情報を記録し、後から解析しやすくする
3. **パフォーマンスへの配慮**: ログレベルによって出力を制御し、不要な処理を避ける
4. **モジュール識別**: プレフィックスにより、どのモジュールからのログかを明確にする

### 基本コンポーネント

1. **Logger**: メインのログ出力クラス
2. **ログレベル**: quiet, error, warn, info, verbose, debug の階層制御
3. **プレフィックス**: ログメッセージに自動的に付与される識別子
4. **コンテキスト**: ログの発生源を特定するための識別子（例: runner/evaluator/experiment）
5. **ログエントリ蓄積**: メモリ内にログを保持し、後から検索・分析できる機能
6. **JSONL出力**: ログをJSONL形式でファイルに出力する機能

### ログレベル階層

```typescript
import { LogLevel } from '@modular-prompt/utils';

type LogLevel = 'quiet' | 'error' | 'warn' | 'info' | 'verbose' | 'debug';
```

**ログレベルの詳細** (数値が小さいほど重要):

| レベル | 数値 | 用途 | 含まれる出力 |
|--------|------|------|--------------|
| `quiet` | 0 | 出力なし | - |
| `error` | 1 | エラーのみ | ERROR |
| `warn` | 2 | 警告以上 | ERROR + WARN |
| `info` | 3 | 情報以上（デフォルト） | ERROR + WARN + INFO |
| `verbose` | 4 | 詳細情報以上 | ERROR + WARN + INFO + VERBOSE |
| `debug` | 5 | すべて（デバッグ含む） | ERROR + WARN + INFO + VERBOSE + DEBUG |

**ログレベルの選び方**:
- **本番環境**: `quiet`または`error` - エラーのみ記録
- **ステージング環境**: `info` - 正常な動作も含めて記録（デフォルト）
- **詳細ログが必要な場合**: `verbose` - CLIツールの--verboseオプションに相当
- **開発環境**: `debug` - すべての情報を記録してデバッグに活用

**環境変数による設定**:
```bash
export MODULAR_PROMPT_LOG_LEVEL=debug
```

## API

### Loggerの初期化と設定

#### 基本的な初期化

```typescript
import { Logger, logger } from '@modular-prompt/utils';

// デフォルトインスタンスを使用（すぐに使える）
logger.info('Application started');

// カスタムインスタンスを作成
const customLogger = new Logger({
  level: 'debug',
  prefix: 'MyModule',
  context: 'runner',
  accumulate: true,
  maxEntries: 1000,
  logFile: './logs/app.jsonl'
});

// エイリアスを使ったインポートも可能
import { logger as defaultLogger } from '@modular-prompt/utils';
defaultLogger.info('Using default logger with alias');
```

#### 設定オプション

```typescript
interface LoggerConfig {
  level: LogLevel;              // 出力するログレベル（デフォルト: 'info'）
  accumulateLevel: LogLevel;    // 蓄積するログレベル（デフォルト: 'debug'）
  isMcpMode: boolean;           // MCPモード（stdout汚染防止、デフォルト: false）
  prefix?: string;              // ログプレフィックス
  context?: string;             // ログコンテキスト（runner/evaluator等）
  accumulate: boolean;          // ログ蓄積モード（デフォルト: false）
  maxEntries: number;           // 蓄積する最大エントリ数（デフォルト: 1000）
  logFile?: string;             // JSONL出力先パス
}
```

#### グローバル設定とインスタンス設定

Logger は2層の設定構造を持ちます:

1. **グローバル設定**: すべてのLoggerインスタンスで共有される設定
2. **インスタンス設定**: 特定のインスタンスのみに適用される設定（グローバル設定より優先）

```typescript
// グローバル設定を変更（全インスタンスに影響）
Logger.configure({ level: 'debug' });

// インスタンス設定を変更（このインスタンスのみに影響）
const logger = new Logger();
logger.configure({ level: 'verbose' }); // このインスタンスだけverbose
```

#### コンテキスト付きロガーの作成

```typescript
const baseLogger = new Logger({ prefix: 'app' });
const apiLogger = baseLogger.context('api');    // context: 'api'
const dbLogger = baseLogger.context('db');      // context: 'db'

// インスタンス設定は引き継がれ、contextのみが変更される
```

### ログ出力メソッド

#### logger.error()
**用途**: システムエラーや例外など、即座に対応が必要な問題を記録
**出力条件**: `error`レベル以上で出力（ほぼすべてのレベルで出力）
**出力先**: `console.error` (stderr)

```typescript
logger.error('Critical error occurred:', error);
logger.error('Database connection failed', { host: 'localhost', port: 5432 });
```

#### logger.warn()
**用途**: 非推奨機能の使用、設定の不備など、将来的に問題となる可能性がある事象を記録
**出力条件**: `warn`レベル以上で出力
**出力先**: `console.warn` (stderr)

```typescript
logger.warn('Deprecated API usage detected');
logger.warn('Configuration missing:', { key: 'API_KEY' });
```

#### logger.info()
**用途**: 正常な処理の開始・終了、重要な状態変化など、システムの動作を追跡するための情報
**出力条件**: `info`レベル以上で出力（デフォルト設定で出力される）
**出力先**: `console.log` (stdout)

```typescript
logger.info('Processing file:', fileName);
logger.info('Analysis completed successfully');
```

#### logger.verbose() / logger.log()
**用途**: より詳細な処理内容、中間状態など、通常運用では不要だが調査時に有用な情報（CLIの--verboseオプション相当）
**出力条件**: `verbose`レベル以上で出力
**出力先**: `console.log` (stdout)
**注意**: `log()`は`verbose()`のエイリアスです

```typescript
logger.verbose('Detailed processing information');
logger.verbose('Cache hit for key:', cacheKey);
logger.log('Module initialization complete with options:', options);
```

#### logger.debug()
**用途**: 変数の内容、関数の引数、内部状態など、開発・デバッグ時のみ必要な詳細情報
**出力条件**: `debug`レベルで出力
**出力先**: `console.log` (stdout)

```typescript
logger.debug('Function called with params:', { param1, param2 });
logger.debug('Internal state:', state);
```

### ログエントリの蓄積と取得

#### ログエントリの蓄積

```typescript
const logger = new Logger({
  accumulate: true,           // ログ蓄積を有効化
  accumulateLevel: 'debug',   // debugレベル以上を蓄積（デフォルト）
  maxEntries: 1000            // 最大1000エントリまで保持
});

logger.info('This will be accumulated');
logger.debug('This will also be accumulated');
```

#### ログエントリの取得

```typescript
// 全ログエントリを取得（現在のcontextのみ）
const entries = logger.getLogEntries();

// フィルタリングして取得
const errorEntries = logger.getLogEntries({
  level: 'error',                      // errorレベルのみ
  since: new Date('2024-01-01'),       // 指定日時以降
  limit: 100,                          // 最大100件
  search: 'database',                  // 'database'を含むもの
  filterByContext: true                // 現在のcontextのみ（デフォルト: true）
});

// 複数レベルを取得
const importantEntries = logger.getLogEntries({
  level: ['error', 'warn'],            // errorまたはwarnレベル
  filterByContext: false               // 全contextから取得
});
```

#### ログエントリの構造

```typescript
interface LogEntry {
  timestamp: string;    // ISO形式のタイムスタンプ
  level: LogLevel;      // ログレベル
  prefix?: string;      // パッケージ識別子（experiment/MLX等）
  context?: string;     // コンテキスト名
  message: string;      // メッセージ
  args?: any[];         // 追加引数
  formatted: string;    // フォーマット済みメッセージ
}
```

#### ログ統計情報の取得

```typescript
const stats = logger.getLogStats();
// {
//   totalEntries: 150,
//   entriesByLevel: {
//     quiet: 0,
//     error: 5,
//     warn: 10,
//     info: 80,
//     verbose: 30,
//     debug: 25
//   },
//   oldestEntry: '2024-01-01T10:00:00.000Z',
//   newestEntry: '2024-01-01T12:00:00.000Z'
// }
```

#### ログエントリのクリア

```typescript
logger.clearLogEntries();  // メモリ内のログエントリをクリア
```

### 命名規約

プロジェクト全体でログを区別しやすくするため、`prefix`と`context`の命名規約を定めます。

#### prefix の規約

**目的**: パッケージを識別する
**形式**: パッケージごとに1つの`prefix`を持つ
**推奨される prefix**:

| パッケージ | prefix |
|-----------|--------|
| `@modular-prompt/experiment` | `experiment` |
| `@modular-prompt/simple-chat` | `simple-chat` |
| `@modular-prompt/process` | `process` |
| `@modular-prompt/driver` (MLXドライバー) | `MLX` |
| `@modular-prompt/utils` (DriverRegistry) | `DriverRegistry` |

#### context の規約

**目的**: モジュール/機能を識別する
**形式**: フラット形式または階層形式

**フラット形式**: `{モジュール名}`
```typescript
// 例:
context: 'runner'
context: 'driver'
context: 'default'
context: 'evaluator'
```

**階層形式**: `{ベース}:{区分}:{識別子}:{タイプ}`
```typescript
// 例:
context: 'agentic:task:1:planning'
context: 'agentic:task:2:outputMessage'
context: 'experiment:run:baseline:evaluation'
```

階層形式では、コロン(`:`)で区切ることで後からフィルタリングや集計が容易になります。

**制約**:
- 同一パッケージ内で`context`名が重複しないこと
- 異なるパッケージ間では`prefix`で区別されるため、`context`の重複は許容される

#### ベースロガーパターン

各パッケージでは、以下のパターンでLoggerを使用することを推奨します：

1. **パッケージごとのベースロガーを作成** (`logger.ts`等で定義)
   ```typescript
   // packages/experiment/src/logger.ts
   import { Logger } from '@modular-prompt/utils';

   export const logger = new Logger({
     prefix: 'experiment',
     context: 'main'
   });
   ```

2. **各モジュールで`.context()`を使って派生インスタンスを作成**
   ```typescript
   // packages/experiment/src/run-comparison.ts
   import { logger as baseLogger } from './logger';

   const logger = baseLogger.context('runner');
   logger.info('Runner started');
   ```

3. **ワークフロー関数では独自のLoggerインスタンスを作成してもよい**
   その場合も`prefix`は必ず設定すること。
   ```typescript
   const logger = new Logger({
     prefix: 'process',
     context: 'default'
   });
   ```

#### 現状の課題

プロジェクト全体でLoggerの使用状況を調査した結果、以下の課題が確認されています：

**未整備の箇所**:
- `DriverRegistry`で`context`が使われていない
- trace writerで設定なしのLoggerが使われている

**改善済みの項目**:
- ~~MLXドライバーの`context: 'process'`が紛らわしい問題~~ → trace writerがprefixを考慮するようになったため、`MLX_process.log`として出力され、区別可能になりました
- ~~`@modular-prompt/process` パッケージで`prefix`が設定されていない問題~~ → 全ワークフローに `prefix: 'process'` を追加済み

**trace出力のファイル名ルール**:
- trace writerは `prefix` と `context` を組み合わせてファイル名を生成します
- prefix あり + context あり: `{prefix}_{context}.log` (例: `MLX_driver.log`, `MLX_process.log`)
- prefix あり + context なし: `{prefix}.log` (例: `DriverRegistry.log`)
- prefix なし + context あり: `{context}.log` (例: `default.log`, `agentic.log`)
- prefix なし + context なし: `unknown.log`
- context の `:` は `_` に置換されます（例: `agentic:task:1:planning` → `agentic_task_1_planning.log`）

これらの課題は今後段階的に修正する予定です。

### JSONL形式でのファイル出力

#### ファイル出力の設定

```typescript
const logger = new Logger({
  logFile: './logs/application.jsonl'  // JSONL出力先
});

logger.info('This will be queued for file output');
logger.error('This will also be queued');

// ファイルに書き出す（非同期）
await logger.flush();
```

#### フラッシュオプション

```typescript
// 全contextのログをファイルに書き出す（デフォルト）
await logger.flush({ filterByContext: false });

// 現在のcontextのみファイルに書き出す
await logger.flush({ filterByContext: true });
```

#### JSONL形式の例

```json
{"timestamp":"2024-01-01T10:00:00.000Z","level":"info","prefix":"experiment","context":"runner","message":"Processing started","formatted":"2024-01-01T10:00:00.000Z INFO [experiment] Processing started"}
{"timestamp":"2024-01-01T10:00:05.000Z","level":"error","prefix":"experiment","context":"runner","message":"Error occurred","args":[{"code":"ERR_001"}],"formatted":"2024-01-01T10:00:05.000Z ERROR [experiment] Error occurred {\"code\":\"ERR_001\"}"}
```

### MCPモードのサポート

MCPサーバーとして動作する際、stdout汚染を防ぐためのモードです。

```typescript
const logger = new Logger({
  isMcpMode: true  // MCPモードを有効化
});

// MCPモード時は、errorのみstderrに出力され、他のレベルは抑制される
logger.error('This will be output to stderr');
logger.info('This will be suppressed in MCP mode');

// ただし、accumulateやlogFileは通常通り動作する
```

## DriverRegistryでの使用例

DriverRegistryクラスは内部でLoggerを使用して、モデルの選択とドライバー作成プロセスを追跡します：

```typescript
import { DriverRegistry } from '@modular-prompt/driver';
import { Logger } from '@modular-prompt/utils';

// DriverRegistryは内部でLoggerを使用
const registry = new DriverRegistry();

// モデルを登録
registry.registerModel({
  model: 'llama-3.3-70b',
  provider: 'mlx',
  capabilities: ['local', 'fast', 'japanese']
});

// モデル選択時のログ出力例（prefix付き）
// 2024-01-01T10:00:00.000Z INFO [DriverRegistry] Selected model: llama-3.3-70b (mlx)
// 2024-01-01T10:00:00.000Z INFO [DriverRegistry] Reason: Local execution preferred
```

## 使用パターン

### 1. モジュール固有のロガー

```typescript
class MyModule {
  private logger: Logger;

  constructor() {
    this.logger = new Logger({
      prefix: 'MyModule',
      level: 'info'
    });
  }

  async process(data: any) {
    this.logger.info('Processing started');

    try {
      const result = await this.doWork(data);
      this.logger.info('Processing completed', { itemsProcessed: result.count });
      return result;

    } catch (error) {
      this.logger.error('Processing failed:', error);
      throw error;
    }
  }
}
```

### 2. コンテキスト別ロガーの使用

```typescript
class ExperimentRunner {
  private logger: Logger;

  constructor() {
    this.logger = new Logger({
      prefix: 'Experiment',
      context: 'runner',
      accumulate: true,
      accumulateLevel: 'verbose'
    });
  }

  async runExperiment(name: string) {
    const expLogger = this.logger.context(`experiment:${name}`);

    expLogger.info('Starting experiment');

    // 各コンポーネントに専用コンテキストを付与
    const evalLogger = expLogger.context('evaluator');
    evalLogger.verbose('Evaluator initialized');

    // 後からcontextでフィルタリング可能
    const expLogs = expLogger.getLogEntries({
      filterByContext: true  // このコンテキストのみ
    });
  }
}
```

### 3. デバッグ出力と詳細ログ

```typescript
function analyzeData(data: any, logger: Logger) {
  // 詳細情報（verbose）
  logger.verbose('Starting data analysis', {
    dataSize: data.length,
    dataType: typeof data
  });

  // デバッグ情報（debug）
  logger.debug('Input data structure:', {
    type: typeof data,
    keys: Object.keys(data),
    sample: data.slice(0, 3)
  });

  const result = performAnalysis(data);

  logger.debug('Analysis result:', {
    itemsAnalyzed: result.items.length,
    processingTime: result.duration
  });

  logger.verbose('Analysis completed successfully');
  return result;
}
```

### 4. エラーハンドリングとログ

```typescript
async function robustOperation(input: any) {
  const logger = new Logger({ prefix: 'RobustOp' });

  logger.info('Operation started');

  try {
    const result = await riskyOperation(input);
    logger.info('Operation succeeded');
    return result;

  } catch (error) {
    logger.error('Operation failed:', {
      error: error.message,
      input: typeof input,
      stack: error.stack
    });

    throw error;
  }
}
```

### 5. ログの蓄積と分析

```typescript
async function processWithLogging() {
  const logger = new Logger({
    prefix: 'Processor',
    accumulate: true,
    accumulateLevel: 'debug',
    maxEntries: 5000,
    logFile: './logs/process.jsonl'
  });

  // 処理実行
  await performHeavyWork(logger);

  // ログ統計を取得
  const stats = logger.getLogStats();
  console.log(`Total logs: ${stats.totalEntries}`);
  console.log(`Errors: ${stats.entriesByLevel.error}`);

  // エラーのみ抽出
  const errors = logger.getLogEntries({ level: 'error' });

  // ファイルに書き出し
  await logger.flush();

  return stats;
}
```

### 6. グローバル設定とインスタンス設定の組み合わせ

```typescript
// アプリケーション起動時にグローバル設定
Logger.configure({
  level: 'info',
  isMcpMode: process.env.MCP_MODE === 'true'
});

// 各モジュールは独自の設定を追加
const driverLogger = new Logger({ prefix: 'Driver' });
const apiLogger = new Logger({ prefix: 'API', level: 'verbose' });  // このインスタンスのみverbose

// テスト時だけデバッグモードに
if (process.env.NODE_ENV === 'test') {
  Logger.configure({ level: 'debug' });
}
```

### 7. QueryLogger（ドライバー実装用）

`QueryLogger` は Logger の accumulate 機能を活用し、クエリ実行中のログをスコープして `QueryResult` に付与するヘルパーです。

```typescript
import { QueryLogger } from '@modular-prompt/driver';

class MyDriver implements AIDriver {
  private queryLogger = new QueryLogger('MyDriver');

  async query(prompt, options) {
    this.queryLogger.mark();  // クエリ開始を記録
    try {
      const result = await callApi(prompt);
      return { ...result, ...this.queryLogger.collect() };
    } catch (error) {
      this.queryLogger.log.error('Query error:', error.message);
      return { content: '', finishReason: 'error', ...this.queryLogger.collect() };
    }
  }
}
```

- `mark()`: ログ収集の開始時刻をリセット
- `log`: 内部の Logger インスタンスへのアクセス（`error()`, `warn()`, `info()` 等）
- `collect()`: `mark()` 以降のログエントリを `{ logEntries?, errors? }` として返却

詳細は [Driver APIリファレンス](./DRIVER_API.md) のドライバー実装者向けログ規約を参照してください。

## 設定とベストプラクティス

### 1. 環境別ログレベル設定

```typescript
// 本番環境
const productionLogger = new Logger({
  level: 'error',        // エラーのみ
  accumulate: false
});

// ステージング環境
const stagingLogger = new Logger({
  level: 'info',         // 情報レベル以上
  accumulate: true,
  accumulateLevel: 'warn',  // 警告以上を蓄積
  logFile: './logs/staging.jsonl'
});

// 開発環境
const developmentLogger = new Logger({
  level: 'debug',        // すべてのログ
  accumulate: true,
  accumulateLevel: 'debug'
});

// テスト環境
const testLogger = new Logger({
  level: 'quiet',        // 出力なし
  accumulate: true,      // ただし蓄積はする
  accumulateLevel: 'info'
});
```

### 2. 構造化ログの活用

```typescript
// ❌ 避けるべき：文字列での情報埋め込み
logger.info(`User ${userId} performed action ${action} at ${timestamp}`);

// ✅ 推奨：構造化されたデータ
logger.info('User action performed', {
  userId,
  action,
  timestamp,
  metadata: {
    sessionId,
    userAgent
  }
});
```

JSONL出力時、構造化データはそのまま`args`フィールドに保存されます：

```json
{
  "timestamp": "2024-01-01T10:00:00.000Z",
  "level": "info",
  "message": "User action performed",
  "args": [{"userId": "123", "action": "login", "timestamp": "2024-01-01T10:00:00Z"}]
}
```

### 3. パフォーマンス考慮

```typescript
// ⭕ 通常のケース - メソッドを直接呼び出す
logger.debug('User action:', { userId, action, timestamp });
logger.verbose('Cache status:', { hits: cacheHits, misses: cacheMisses });

// ログレベルによって自動的に出力が制御される
// レベル外の場合、内部で早期リターンされるため、パフォーマンスへの影響は最小限
```

**推奨事項**:
- ログメソッドは直接呼び出す（内部で出力判定が行われる）
- 巨大データは要約やサンプルのみログに出力
- 出力レベルと蓄積レベルを分けて設定可能（例: 出力は`info`、蓄積は`debug`）

### 4. 大量データのログ

```typescript
// ❌ 大量データの直接ログ
logger.debug('All data:', massiveArray);

// ✅ サマリー情報のみログ
logger.debug('Data summary:', {
  count: massiveArray.length,
  sample: massiveArray.slice(0, 3),
  types: [...new Set(massiveArray.map(item => typeof item))]
});
```

### 5. ログの蓄積容量管理

```typescript
const logger = new Logger({
  accumulate: true,
  maxEntries: 1000,           // 最大1000エントリ
  accumulateLevel: 'info'     // infoレベル以上を蓄積
});

// 古いエントリは自動的に削除される（FIFO）
// 必要に応じて手動でクリア
logger.clearLogEntries();
```

### 6. MCPモードとファイル出力の組み合わせ

MCPサーバーとして動作する際、stdoutを汚染せずにログを記録できます：

```typescript
const logger = new Logger({
  isMcpMode: true,                    // stdout汚染を防ぐ
  accumulate: true,                   // メモリに蓄積
  logFile: './logs/mcp-server.jsonl'  // ファイルにも出力
});

// errorのみstderrに出力され、他は抑制される
logger.error('Critical error');       // stderr出力 + 蓄積 + ファイル
logger.info('Processing...');         // 蓄積 + ファイルのみ（stdout出力なし）

// 定期的にファイルに書き出し
setInterval(() => logger.flush(), 5000);
```

## 実装ファイル

- **Logger実装**: `packages/utils/src/logger/logger.ts`
- **Loggerエクスポート**: `packages/utils/src/logger/index.ts`
- **Loggerテスト**: `packages/utils/src/logger/logger.test.ts`
- **利用例**:
  - `packages/driver/src/driver-registry/registry.ts` - DriverRegistry
  - `packages/driver/src/mlx-ml/mlx-driver.ts` - MLXドライバー
  - `packages/experiment/src/run-comparison.ts` - 実験フレームワーク
  - `packages/simple-chat/src/cli.ts` - チャットCLI

## Usage集計ユーティリティ

`@modular-prompt/process` パッケージは、複数のクエリやタスクのusage情報を集計するためのユーティリティ関数を提供します。

### aggregateUsage()

複数の usage オブジェクトを合算します。リトライや複数タスクのusageを集計する際に使用します。

```typescript
import { aggregateUsage } from '@modular-prompt/process/workflows/usage-utils';

const usage1 = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
const usage2 = { promptTokens: 200, completionTokens: 80, totalTokens: 280 };

const total = aggregateUsage([usage1, usage2]);
// { promptTokens: 300, completionTokens: 130, totalTokens: 430 }

// undefined は無視される
const partialTotal = aggregateUsage([usage1, undefined, usage2]);
// { promptTokens: 300, completionTokens: 130, totalTokens: 430 }

// すべて undefined の場合は undefined を返す
const noUsage = aggregateUsage([undefined, undefined]);
// undefined
```

### aggregateLogEntries()

複数の LogEntry 配列をフラット化します。全タスク・全クエリのログを1つの配列にまとめる際に使用します。

```typescript
import { aggregateLogEntries } from '@modular-prompt/process/workflows/usage-utils';

const logs1 = [
  { level: 'info', message: 'Task 1 started', timestamp: '...' },
  { level: 'info', message: 'Task 1 completed', timestamp: '...' }
];
const logs2 = [
  { level: 'info', message: 'Task 2 started', timestamp: '...' }
];

const allLogs = aggregateLogEntries([logs1, logs2]);
// [
//   { level: 'info', message: 'Task 1 started', ... },
//   { level: 'info', message: 'Task 1 completed', ... },
//   { level: 'info', message: 'Task 2 started', ... }
// ]

// undefined は無視される
const partialLogs = aggregateLogEntries([logs1, undefined]);
// logs1 のコピー

// すべて undefined の場合は undefined を返す
const noLogs = aggregateLogEntries([undefined, undefined]);
// undefined
```

**実装ファイル**: `packages/process/src/workflows/usage-utils.ts`

## 関連ドキュメント

- [Architecture](./ARCHITECTURE.md) - システム全体のアーキテクチャ
- [Driver API](./DRIVER_API.md) - ドライバAPIの詳細
- [Process Module Guide](./PROCESS_MODULE_GUIDE.md) - WorkflowResultの詳細