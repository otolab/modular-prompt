# ModelSpec 比較分析

> **ステータス**: 完了・反映済み（2025-11-25）
> **結果**: MLX専用ModelSpecの複雑性を整理し、リファクタリングの方針決定に貢献。最終的にModelSpecManagerの削除により問題解決。

## 概要

2つの`ModelSpec`型が存在し、同名だが目的と内容が異なる。

---

## 1. MLX専用ModelSpec

**ファイル**: `packages/driver/src/mlx-ml/model-spec/types.ts`

**目的**: MLXドライバー内部でのchat/completion API選択制御

### 保持項目

| 項目 | 型 | 説明 | データソース |
|------|-----|------|------------|
| `modelName` | `string` | モデル名/ID | 必須、ユーザー指定 |
| `capabilities` | `object` | 機能情報 | Pythonランタイムから動的取得 |
| `capabilities.hasApplyChatTemplate` | `boolean?` | chat template利用可能か | Python |
| `capabilities.supportsCompletion` | `boolean?` | completion API対応か | Python |
| `capabilities.specialTokens` | `Record<string, any>?` | 特殊トークン情報 | Python |
| `apiStrategy` | `ApiStrategy?` | API選択戦略 | プリセット/カスタム設定 |
| `chatRestrictions` | `ChatRestrictions?` | chat制限 | プリセット/カスタム設定 |
| `customProcessor` | `ModelCustomProcessor?` | カスタム処理 | カスタム設定のみ |
| `validatedPatterns` | `Map?` | 検証済みパターンキャッシュ | 実行時生成 |

### ApiStrategy（5種類）
- `auto` - 自動判定
- `prefer-chat` - chat優先
- `prefer-completion` - completion優先
- `force-chat` - 常にchat
- `force-completion` - 常にcompletion

### ChatRestrictions（5項目）
- `singleSystemAtStart` - systemメッセージは先頭に1つだけ
- `alternatingTurns` - user/assistant交互
- `requiresUserLast` - 最後はuser
- `maxSystemMessages` - systemメッセージ最大数
- `allowEmptyMessages` - 空メッセージ許可

### ModelCustomProcessor（4メソッド）
- `preprocessMessages` - メッセージ前処理
- `preprocessCompletion` - completionプロンプト前処理
- `validateMessages` - メッセージ検証
- `determineApi` - カスタムAPI選択ロジック（削除予定）

### 特徴
- **MLX固有**: chat/completion選択に特化
- **動的検出**: Pythonプロセスから実行時に機能を取得
- **制約管理**: 各モデルのchat制限を詳細に管理
- **プリセット**: よく知られたモデルの設定を事前定義
- **実行時最適化**: メッセージパターンに基づいて最適なAPIを選択

---

## 2. 汎用ModelSpec（ドライバーレジストリ）

**ファイル**: `packages/driver/src/driver-registry/types.ts`

**目的**: 全ドライバー横断的なモデル選択・管理

### 保持項目

| 項目 | 型 | 説明 | データソース |
|------|-----|------|------------|
| `model` | `string` | モデル識別子 | 必須、設定ファイル |
| `provider` | `DriverProvider` | プロバイダー名 | 必須、設定ファイル |
| `capabilities` | `DriverCapability[]` | 能力フラグ配列 | 設定ファイル |
| `maxInputTokens` | `number?` | 最大入力トークン数 | 設定ファイル |
| `maxOutputTokens` | `number?` | 最大出力トークン数 | 設定ファイル |
| `maxTotalTokens` | `number?` | 合計最大トークン数 | 設定ファイル |
| `tokensPerMinute` | `number?` | TPM制限 | 設定ファイル |
| `requestsPerMinute` | `number?` | RPM制限 | 設定ファイル |
| `cost.input` | `number?` | 入力コスト（$/1Kトークン） | 設定ファイル |
| `cost.output` | `number?` | 出力コスト（$/1Kトークン） | 設定ファイル |
| `priority` | `number?` | 優先度 | 設定ファイル |
| `enabled` | `boolean?` | 有効/無効 | 設定ファイル |
| `metadata` | `Record<string, unknown>?` | カスタムメタデータ | 設定ファイル |

### DriverCapability（15種類）
- `streaming` - ストリーミング対応
- `local` - ローカル実行可能
- `fast` - 高速応答
- `large-context` - 大規模コンテキスト
- `multilingual` - 多言語対応
- `japanese` - 日本語特化
- `coding` - コーディング特化
- `reasoning` - 推論・思考特化
- `chat` - チャット特化
- `tools` - ツール使用可能
- `vision` - 画像認識可能
- `audio` - 音声処理可能
- `structured` - 構造化出力対応
- `json` - JSON出力対応
- `function-calling` - 関数呼び出し対応

### DriverProvider（7種類）
- `openai`
- `anthropic`
- `vertexai`
- `mlx`
- `ollama`
- `echo`（テスト用）
- `test`（ユニットテスト用）

### 特徴
- **ドライバー横断**: 全プロバイダー共通の情報
- **静的定義**: 設定ファイルで事前定義
- **リソース管理**: token制限、コスト、レート制限
- **モデル選択**: 条件に基づいて最適なモデルを選択
- **ビジネスロジック**: コスト最適化、優先度管理

---

## 比較表

| 観点 | MLX専用ModelSpec | 汎用ModelSpec |
|------|------------------|--------------|
| **スコープ** | MLXドライバー内部のみ | 全ドライバー横断 |
| **目的** | API選択制御（chat vs completion） | モデル選択・管理 |
| **データソース** | 動的検出（Python）+ プリセット | 静的設定（設定ファイル） |
| **更新頻度** | 実行時に動的変化 | 基本的に静的 |
| **管理対象** | 技術的制約（chat制限など） | ビジネス的属性（コスト、制限など） |
| **詳細度** | 実行時の詳細な挙動 | モデルの一般的特性 |
| **粒度** | モデル実装レベル | モデル選択レベル |

---

## 項目の重複/類似性

### 重複している概念

1. **モデル識別子**
   - MLX: `modelName: string`
   - 汎用: `model: string`
   - **内容**: 同じ（モデルのID）

2. **capabilities（能力）**
   - MLX: `capabilities: { hasApplyChatTemplate?, supportsCompletion?, ... }`
   - 汎用: `capabilities: DriverCapability[]`
   - **内容**: 異なる
     - MLX: 技術的な機能有無（boolean）
     - 汎用: 高レベルな能力フラグ（文字列配列）

### 独自の項目

**MLX専用のみ**:
- `apiStrategy` - API選択戦略
- `chatRestrictions` - chat制限の詳細
- `customProcessor` - カスタム処理
- `validatedPatterns` - キャッシュ
- `capabilities.specialTokens` - 特殊トークン

**汎用のみ**:
- `provider` - プロバイダー名
- `maxInputTokens / maxOutputTokens` - トークン制限
- `tokensPerMinute / requestsPerMinute` - レート制限
- `cost` - コスト情報
- `priority` - 優先度
- `enabled` - 有効/無効フラグ
- `metadata` - カスタムメタデータ

---

## 使用コンテキスト

### MLX専用ModelSpec

**生成タイミング**:
1. `MlxDriver`のコンストラクタ
2. プリセットとカスタム設定をマージ
3. `initialize()`で動的検出結果をマージ

**使用箇所**:
- `ModelSpecManager` - API選択の判断
- `MlxProcess` - メッセージ検証
- `createModelSpecificProcessor()` - モデル固有処理

**ライフサイクル**: ドライバーインスタンスのライフタイム

### 汎用ModelSpec

**生成タイミング**:
- 設定ファイル読み込み時
- プログラマティックな登録時

**使用箇所**:
- `DriverRegistry` - モデル登録・選択
- `DriverFactory` - ドライバー生成の引数
- `selectModel()` - 条件に基づくモデル選択

**ライフサイクル**: アプリケーション全体（通常は静的）

---

## 統一 vs 名前変更の検討

### オプション1: 統一する

**メリット**:
- 型の一貫性
- インターフェースの統一
- 理解しやすい

**デメリット**:
- 用途が異なる情報を1つの型に混在させる
- MLX固有の詳細情報が他のドライバーには不要
- 動的vs静的の性質の違いを無視することになる

**実現方法**:
```typescript
// 統一されたModelSpec
export interface ModelSpec {
  // 共通項目
  model: string;
  provider?: DriverProvider;

  // 汎用ドライバー情報
  capabilities?: DriverCapability[];
  maxInputTokens?: number;
  cost?: { input: number; output: number };
  // ...

  // MLX固有情報（mlxの場合のみ使用）
  mlxConfig?: {
    apiStrategy?: ApiStrategy;
    chatRestrictions?: ChatRestrictions;
    // ...
  };
}
```

### オプション2: 名前を変更する

**メリット**:
- 用途が明確
- 責務の分離
- それぞれ独立して進化可能

**デメリット**:
- 名前の選定が必要
- 既存コードの修正が必要

**候補案**:

1. **役割ベース命名**
   - MLX: `MlxRuntimeConfig` または `MlxBehaviorSpec`
   - 汎用: `ModelSpec`（そのまま）

2. **レイヤーベース命名**
   - MLX: `ModelRuntimeSpec` または `ModelExecutionSpec`
   - 汎用: `ModelRegistrySpec` または `ModelCatalogSpec`

3. **スコープベース命名**
   - MLX: `MlxModelSpec`
   - 汎用: `DriverModelSpec`

---

## 推奨案

### 推奨: **オプション2 - 名前変更**

**理由**:
1. **関心の分離**: 2つは全く異なる目的を持つ
   - MLX: 実行時のAPI選択制御
   - 汎用: モデルカタログ管理

2. **データソースの違い**:
   - MLX: 動的検出（実行時に変化）
   - 汎用: 静的設定（変化しない）

3. **スコープの違い**:
   - MLX: ドライバー内部実装の詳細
   - 汎用: ドライバー横断的な抽象

4. **将来性**: 他のドライバーも同様の実行時設定が必要になる可能性は低い

### 具体的な提案

**MLX専用**:
```typescript
// packages/driver/src/mlx-ml/model-spec/types.ts
export interface MlxModelConfig {  // ModelSpec → MlxModelConfig
  modelName: string;
  capabilities?: MlxCapabilities;  // より具体的な名前
  apiStrategy?: ApiStrategy;
  chatRestrictions?: ChatRestrictions;
  customProcessor?: ModelCustomProcessor;
  validatedPatterns?: Map<string, ValidationResult>;
}

export interface MlxCapabilities {  // 新規: capabilitiesの型を明示
  hasApplyChatTemplate?: boolean;
  supportsCompletion?: boolean;
  specialTokens?: Record<string, any>;
}
```

**汎用**:
```typescript
// packages/driver/src/driver-registry/types.ts
export interface ModelSpec {  // そのまま
  model: string;
  provider: DriverProvider;
  capabilities: DriverCapability[];
  // ... 現状維持
}
```

### リネーム影響範囲

**MLX内部のみ**:
- `packages/driver/src/mlx-ml/model-spec/` 配下
- `packages/driver/src/mlx-ml/process/` 配下
- `packages/driver/src/mlx-ml/mlx-driver.ts`

**driver-registry**: 影響なし

---

## まとめ

### 結論
- **2つのModelSpecは統一すべきではない**
- **MLX専用を`MlxModelConfig`にリネームすることを推奨**

### 次のステップ
1. リネームの承認を得る
2. リネーム実施計画の策定
3. 段階的な移行（型エイリアスで互換性維持）

### 理由
1. 用途・目的が根本的に異なる
2. データソース・ライフサイクルが異なる
3. スコープ・責務が異なる
4. 統一すると両方の型が肥大化・複雑化する
5. 独立した進化が可能になる
