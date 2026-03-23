# AIService 完全ガイド

AIServiceは、Moduler Promptにおける動的なAIドライバー選択と管理を行うサービスです。アプリケーションの要求に応じて最適なAIモデルを自動選択し、統一されたインターフェースでアクセスできます。

## 目次

1. [概要](#概要)
2. [基本概念](#基本概念)
3. [クイックスタート](#クイックスタート)
4. [ModelSpec（モデル仕様）](#modelspecモデル仕様)
5. [DriverCapability（ドライバー能力）](#drivercapabilityドライバー能力)
6. [AIServiceの使用方法](#aiserviceの使用方法)
7. [選択アルゴリズム](#選択アルゴリズム)
8. [実装パターン](#実装パターン)
9. [ベストプラクティス](#ベストプラクティス)
10. [トラブルシューティング](#トラブルシューティング)

## 概要

### AIServiceとは

AIServiceは、以下の機能を提供する高レベルのサービスクラスです：

- **動的ドライバー選択**: 必要な能力（capability）に基づいて最適なドライバーを選択
- **統一インターフェース**: 異なるAIプロバイダーを統一的に扱う
- **フォールバック機能**: 条件を満たすモデルがない場合の緩和処理
- **優先度制御**: ローカル実行、高速応答、特定プロバイダーの優先

### なぜAIServiceが必要か

| 課題 | AIServiceの解決策 |
|------|------------------|
| モデルの固定的な選択 | 要件に応じた動的選択 |
| プロバイダー依存のコード | プロバイダー中立な実装 |
| フォールバック処理の複雑さ | 自動的な条件緩和 |
| コスト・速度の最適化 | 優先度による自動選択 |

## 基本概念

### 3つの核心要素

#### 1. ModelSpec（モデル仕様）
各AIモデルの詳細な仕様を定義。モデル名、プロバイダー、能力、制限、コストなどを含む。

#### 2. DriverCapability（ドライバー能力）
モデルが持つ機能や特性を表すフラグ。streaming、local、japanese、reasoningなど。

#### 3. SelectionOptions（選択オプション）
モデル選択時の優先条件。ローカル優先、高速優先、プロバイダー指定など。

## クイックスタート

### インストール

```bash
npm install @modular-prompt/driver
```

### 最小限の例

```typescript
import { AIService } from '@modular-prompt/driver';

const config = {
  models: [
    {
      model: 'gpt-4o-mini',
      provider: 'openai',
      capabilities: ['streaming', 'japanese', 'fast'],
      priority: 10
    }
  ],
  drivers: {
    openai: { apiKey: process.env.OPENAI_API_KEY }
  }
};

const aiService = new AIService(config);
const driver = await aiService.createDriverFromCapabilities(['japanese']);
```

## ModelSpec（モデル仕様）

### 型定義

```typescript
interface ModelSpec {
  model: string;                      // モデル識別子
  provider: DriverProvider;           // プロバイダー名
  capabilities: DriverCapability[];   // 能力フラグ
  maxInputTokens?: number;           // 最大入力トークン
  maxOutputTokens?: number;          // 最大出力トークン
  maxTotalTokens?: number;           // 合計最大トークン
  tokensPerMinute?: number;          // TPM制限
  requestsPerMinute?: number;        // RPM制限
  cost?: {                           // コスト情報
    input: number;                   // 入力コスト/1K
    output: number;                  // 出力コスト/1K
  };
  priority?: number;                 // 優先度
  enabled?: boolean;                 // 有効/無効
  metadata?: Record<string, unknown>; // カスタムデータ
}
```

### 主要フィールドの説明

| フィールド | 用途 | 例 |
|-----------|------|-----|
| model | モデルの識別子 | 'gpt-4o', 'claude-3-5-sonnet' |
| provider | プロバイダー識別子 | 'openai', 'anthropic', 'mlx' |
| capabilities | モデルの能力リスト | ['streaming', 'japanese'] |
| priority | 選択時の優先度（高いほど優先） | 10, 20, 30 |
| cost | トークンあたりのコスト | { input: 0.01, output: 0.03 } |

## DriverCapability（ドライバー能力）

### 利用可能な能力フラグ

| カテゴリ | 能力 | 説明 |
|---------|------|------|
| **実行環境** | `local` | ローカル実行可能 |
| | `streaming` | ストリーミング応答対応 |
| **性能** | `fast` | 高速応答 |
| | `large-context` | 大規模コンテキスト対応 |
| **言語** | `multilingual` | 多言語対応 |
| | `japanese` | 日本語特化 |
| **特化機能** | `coding` | コーディング特化 |
| | `reasoning` | 推論・思考特化 |
| | `chat` | チャット特化 |
| **拡張機能** | `tools` | ツール使用可能 |
| | `vision` | 画像認識可能 |
| | `audio` | 音声処理可能 |
| **出力形式** | `structured` | 構造化出力対応 |
| | `json` | JSON出力対応 |
| | `function-calling` | 関数呼び出し対応 |

### 能力の組み合わせ例

| 用途 | 能力の組み合わせ |
|------|----------------|
| ローカル日本語処理 | `['local', 'japanese']` |
| 高速コーディング支援 | `['streaming', 'fast', 'coding']` |
| 構造化推論 | `['reasoning', 'structured', 'json']` |

## AIServiceの使用方法

### 主要メソッド

| メソッド | 用途 | 戻り値 |
|---------|------|--------|
| `createDriverFromCapabilities` | 能力ベースでドライバー作成 | `Promise<AIDriver \| null>` |
| `createDriver` | ModelSpec指定でドライバー作成 | `Promise<AIDriver>` |
| `selectModels` | 条件に合うモデルを選択 | `ModelSpec[]` |

### 基本的な使用パターン

```typescript
// 1. 初期化
const aiService = new AIService(config);

// 2. 能力ベースの選択
const driver = await aiService.createDriverFromCapabilities(
  ['japanese', 'streaming'],
  { preferLocal: true, lenient: true }
);

// 3. 実行
if (driver) {
  const result = await driver.query(prompt);
}
```

### 全モデルの取得

`selectModels`メソッドに空の配列を渡すと、登録されている全モデルを取得できます：

```typescript
// 全モデルを取得
const allModels = aiService.selectModels([]);

// 特定プロバイダーを除外して全モデルを取得
const modelsWithoutOpenAI = aiService.selectModels([], {
  excludeProviders: ['openai']
});

// 優先度付きで全モデルを取得
const sortedModels = aiService.selectModels([], {
  preferLocal: true,
  preferFast: true
});
```

この機能は、利用可能なモデルの一覧表示やデバッグ時に便利です。

## 選択アルゴリズム

### 選択プロセス

1. **フィルタリング**: 必要な能力をすべて持つモデルを抽出
2. **除外処理**: excludeProvidersで指定されたプロバイダーを除外
3. **条件緩和**: lenientモードで条件を段階的に緩和
4. **ソート**: 優先条件に基づいて並び替え
5. **選択**: 最上位のモデルを選択

### SelectionOptions

```typescript
interface SelectionOptions {
  preferLocal?: boolean;           // ローカル実行優先
  preferProvider?: DriverProvider; // 特定プロバイダー優先
  excludeProviders?: DriverProvider[]; // 除外プロバイダー
  preferFast?: boolean;            // 高速応答優先
  lenient?: boolean;               // 条件緩和モード
}
```

### 条件緩和（lenient）モード

条件を満たすモデルがない場合、自動的に条件を後ろから減らして再検索します。

例: `['japanese', 'streaming', 'local']` → `['japanese', 'streaming']` → `['japanese']`

## 実装パターン

### パターン1: タスク別の動的選択

タスクの種類に応じて必要な能力を動的に決定し、適切なドライバーを選択します。

| タスク種別 | 必要な能力 |
|-----------|-----------|
| 翻訳 | `['multilingual', 'japanese']` |
| コーディング | `['coding', 'reasoning']` |
| 分析 | `['reasoning', 'structured']` |
| 一般チャット | `['chat']` |

### パターン2: フォールバック戦略

優先度の高い戦略から順に試行し、利用可能なドライバーで実行します。

1. ローカル＆高速を試行
2. 高速のみ（ローカル除外）を試行
3. 任意のドライバーを試行

### パターン3: コスト最適化

`ModelSpec.cost`フィールドを活用して、コスト制約内で最適なモデルを選択します。

## ベストプラクティス

### 推奨事項

| 項目 | 推奨 | 理由 |
|------|------|------|
| **設定の外部化** | JSONファイルやenv変数で管理 | 環境依存の分離 |
| **エラーハンドリング** | driver nullチェックとtry-catch | 確実な実行 |
| **能力指定** | 必要最小限＋lenientモード | 柔軟性の確保 |
| **結果のキャッシュ** | 選択結果をキャッシュ | パフォーマンス向上 |

## トラブルシューティング

### よくある問題と解決策

| 問題 | 原因 | 解決策 |
|------|------|--------|
| モデルが見つからない | 能力の過剰指定 | lenientモードを使用 |
| 予期しないモデル選択 | 優先度設定の誤り | priority値を調整 |
| APIキーエラー | 設定の不備 | drivers設定を確認 |
| パフォーマンス問題 | 不適切なモデル | preferFastオプション使用 |

### デバッグ方法

1. **選択結果の確認**: `selectModels()`で候補モデルを確認
2. **条件の段階的削除**: 条件を1つずつ減らして該当モデルを探索
3. **優先度の確認**: `ModelSpec.priority`フィールドを確認

## ApplicationConfig型

### 設定構造

```typescript
interface ApplicationConfig {
  models?: ModelSpec[];
  drivers?: {
    openai?: { apiKey?: string; baseURL?: string; organization?: string };
    anthropic?: { apiKey?: string; baseURL?: string };
    vertexai?: { project?: string; location?: string; region?: string };
    mlx?: { baseURL?: string; pythonPath?: string };
    ollama?: { baseURL?: string };
    vllm?: { socketPath?: string };
  };
  defaultOptions?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
  };
}
```

### ドライバー設定の詳細

| プロバイダー | 必須設定 | オプション設定 |
|------------|---------|--------------|
| openai | apiKey | baseURL, organization |
| anthropic | apiKey | baseURL |
| vertexai | project, location | region |
| mlx | なし | baseURL, pythonPath |
| ollama | なし | baseURL |
| vllm | socketPath | なし |

## まとめ

AIServiceは、Moduler Promptにおける高度なドライバー管理機能を提供します：

1. **動的選択**: 要件に応じた最適なモデルの自動選択
2. **統一インターフェース**: プロバイダーに依存しない実装
3. **柔軟な優先制御**: ローカル、速度、コストなどの考慮
4. **自動フォールバック**: 条件緩和による確実な実行

これらの機能により、アプリケーションは状況に応じて最適なAIモデルを活用でき、コストとパフォーマンスのバランスを自動的に最適化できます。

## 関連ドキュメント

- [Moduler Prompt 完全ガイド](./COMPLETE_GUIDE.md) - フレームワーク全体の仕様
- [Driver API](./DRIVER_API.md) - ドライバーインターフェースの詳細
- [Structured Outputs](./STRUCTURED_OUTPUTS.md) - 構造化出力の仕様