# MLX ModelSpec → MlxModelConfig リネーム計画

> **ステータス**: 完了・反映済み（2025-11-25）
> **結果**: mlx-capability-refactoring.v1.mdの実装によりModelSpecManager自体が削除され、リネームは不要となった。

## リネーム対象の型

### 主要な型

1. **`ModelSpec`** → **`MlxModelConfig`**
   - `packages/driver/src/mlx-ml/model-spec/types.ts:121`
   - MLXモデルの設定と動作仕様を定義

2. **`ModelSpecPreset`** → **`MlxModelConfigPreset`**
   - `packages/driver/src/mlx-ml/model-spec/types.ts:148`
   - プリセット定義の型

3. **`ModelSpecManager`** → **`MlxModelConfigManager`**
   - `packages/driver/src/mlx-ml/model-spec/manager.ts:17`
   - モデル設定の管理クラス

### 関連する型（リネーム不要）

これらは明確にMLX固有なので現状のまま:
- `ChatRestrictions` - そのまま
- `ApiStrategy` - そのまま
- `ApiSelectionContext` - そのまま（削除予定だが）
- `ModelCustomProcessor` - そのまま
- `ValidationResult` - そのまま
- `MlxCapabilities` - 新規作成（capabilities の型を明示化）

### 関連しない型（注意）

**リネームしない**:
- `ModelSpecificProcessor` (`process/model-specific.ts:11`)
  - これは「モデル固有の処理」を意味する別の型
  - ModelSpecとは無関係

## リネーム影響範囲

### ファイル一覧（10ファイル）

1. `packages/driver/src/mlx-ml/model-spec/types.ts` ⭐
2. `packages/driver/src/mlx-ml/model-spec/manager.ts` ⭐
3. `packages/driver/src/mlx-ml/model-spec/manager.test.ts` ⭐
4. `packages/driver/src/mlx-ml/model-spec/presets.ts` ⭐
5. `packages/driver/src/mlx-ml/model-spec/detector.ts` ⭐
6. `packages/driver/src/mlx-ml/process/index.ts` ⭐
7. `packages/driver/src/mlx-ml/mlx-driver.ts` ⭐
8. `packages/driver/src/mlx-ml/process/model-specific.ts`
9. `packages/driver/src/mlx-ml/process/model-specific.test.ts`
10. `packages/driver/src/mlx-ml/process/completion-prompt-formatting.test.ts`

⭐ = 主要な修正が必要

## 詳細な修正内容

### 1. types.ts

**変更前**:
```typescript
export interface ModelSpec {
  modelName: string;
  capabilities?: {
    hasApplyChatTemplate?: boolean;
    supportsCompletion?: boolean;
    specialTokens?: Record<string, any>;
  };
  // ...
}

export interface ModelSpecPreset {
  pattern: RegExp;
  spec: Partial<ModelSpec>;
}
```

**変更後**:
```typescript
// capabilities の型を明示化
export interface MlxCapabilities {
  hasApplyChatTemplate?: boolean;
  supportsCompletion?: boolean;
  specialTokens?: Record<string, any>;
}

export interface MlxModelConfig {
  modelName: string;
  capabilities?: MlxCapabilities;
  apiStrategy?: ApiStrategy;
  chatRestrictions?: ChatRestrictions;
  customProcessor?: ModelCustomProcessor;
  validatedPatterns?: Map<string, ValidationResult>;
}

export interface MlxModelConfigPreset {
  pattern: RegExp;
  config: Partial<MlxModelConfig>;  // spec → config
}

// 後方互換性のための型エイリアス（非推奨）
/** @deprecated Use MlxModelConfig instead */
export type ModelSpec = MlxModelConfig;

/** @deprecated Use MlxModelConfigPreset instead */
export type ModelSpecPreset = MlxModelConfigPreset;
```

### 2. manager.ts

**クラス名**: `ModelSpecManager` → `MlxModelConfigManager`

**主要な変更**:
```typescript
// 変更前
export class ModelSpecManager {
  private spec: ModelSpec;

  constructor(
    modelName: string,
    process: MlxProcess,
    customSpec?: Partial<ModelSpec>
  ) { }

  getSpec(): Readonly<ModelSpec> { }
}

// 変更後
export class MlxModelConfigManager {
  private config: MlxModelConfig;  // spec → config

  constructor(
    modelName: string,
    process: MlxProcess,
    customConfig?: Partial<MlxModelConfig>  // customSpec → customConfig
  ) { }

  getConfig(): Readonly<MlxModelConfig> { }  // getSpec → getConfig
}

// 後方互換性のための型エイリアス（非推奨）
/** @deprecated Use MlxModelConfigManager instead */
export const ModelSpecManager = MlxModelConfigManager;
```

### 3. presets.ts

**変数名とシグネチャ**:
```typescript
// 変更前
import type { ModelSpecPreset } from './types.js';

export const MODEL_PRESETS: ModelSpecPreset[] = [ /* ... */ ];

export function findPreset(modelName: string): ModelSpecPreset | undefined { }

// 変更後
import type { MlxModelConfigPreset } from './types.js';

export const MODEL_CONFIG_PRESETS: MlxModelConfigPreset[] = [ /* ... */ ];

export function findPreset(modelName: string): MlxModelConfigPreset | undefined { }

// 後方互換性
/** @deprecated Use MODEL_CONFIG_PRESETS instead */
export const MODEL_PRESETS = MODEL_CONFIG_PRESETS;
```

**プリセット内容**:
```typescript
// 変更前
{
  pattern: /^gemma-2-2b-it/,
  spec: {
    apiStrategy: 'prefer-chat',
    // ...
  }
}

// 変更後
{
  pattern: /^gemma-2-2b-it/,
  config: {  // spec → config
    apiStrategy: 'prefer-chat',
    // ...
  }
}
```

### 4. detector.ts

```typescript
// 変更前
async detectCapabilities(): Promise<Partial<ModelSpec>> { }

// 変更後
async detectCapabilities(): Promise<Partial<MlxModelConfig>> { }
```

### 5. process/index.ts

```typescript
// 変更前
import type { ModelSpec, ModelCustomProcessor } from '../model-spec/types.js';
import { ModelSpecManager } from '../model-spec/manager.js';

export class MlxProcess {
  private specManager: ModelSpecManager;

  constructor(
    options: MlxProcessOptions,
    customSpec?: Partial<ModelSpec>,
    customProcessor?: ModelCustomProcessor
  ) {
    this.specManager = new ModelSpecManager(modelName, this, customSpec, customProcessor);
  }

  getSpecManager(): ModelSpecManager { }
}

// 変更後
import type { MlxModelConfig, ModelCustomProcessor } from '../model-spec/types.js';
import { MlxModelConfigManager } from '../model-spec/manager.js';

export class MlxProcess {
  private configManager: MlxModelConfigManager;  // specManager → configManager

  constructor(
    options: MlxProcessOptions,
    customConfig?: Partial<MlxModelConfig>,  // customSpec → customConfig
    customProcessor?: ModelCustomProcessor
  ) {
    this.configManager = new MlxModelConfigManager(modelName, this, customConfig, customProcessor);
  }

  getConfigManager(): MlxModelConfigManager { }  // getSpecManager → getConfigManager
}
```

### 6. mlx-driver.ts

```typescript
// 変更前
import type { ModelSpec, ModelCustomProcessor } from './model-spec/types.js';

export interface MlxDriverOptions {
  model: string;
  modelSpec?: Partial<ModelSpec>;
  customProcessor?: ModelCustomProcessor;
  // ...
}

// 変更後
import type { MlxModelConfig, ModelCustomProcessor } from './model-spec/types.js';

export interface MlxDriverOptions {
  model: string;
  modelConfig?: Partial<MlxModelConfig>;  // modelSpec → modelConfig
  customProcessor?: ModelCustomProcessor;
  // ...
}
```

### 7. テストファイル

**manager.test.ts**:
- `ModelSpecManager` → `MlxModelConfigManager`
- `const spec: Partial<ModelSpec>` → `const config: Partial<MlxModelConfig>`

**その他のテスト**:
- import文の更新
- 型アノテーションの更新

## 作業手順

### フェーズ1: 型定義の更新
1. `types.ts`の更新
   - `MlxCapabilities`インターフェース追加
   - `MlxModelConfig`インターフェース追加
   - `MlxModelConfigPreset`インターフェース追加
   - 後方互換性エイリアス追加

### フェーズ2: コア実装の更新
2. `manager.ts`の更新
   - クラス名変更
   - プロパティ名変更（spec → config）
   - メソッド名変更（getSpec → getConfig）
   - 後方互換性エイリアス追加

3. `presets.ts`の更新
   - 定数名変更
   - プリセット構造更新（spec → config）

4. `detector.ts`の更新
   - 戻り値型の更新

### フェーズ3: 使用側の更新
5. `process/index.ts`の更新
   - プロパティ名変更（specManager → configManager）
   - メソッド名変更

6. `mlx-driver.ts`の更新
   - オプション型の更新（modelSpec → modelConfig）

### フェーズ4: テストの更新
7. すべてのテストファイルの更新
   - import文
   - 型アノテーション
   - 変数名

### フェーズ5: 検証
8. 型チェック: `npm run typecheck`
9. テスト実行: `npm test`
10. ビルド確認: `npm run build`

### フェーズ6: クリーンアップ（後日）
11. 後方互換性エイリアスの削除
12. ドキュメントの更新

## 後方互換性

### 一時的な型エイリアス（非推奨マーク付き）

```typescript
/** @deprecated Use MlxModelConfig instead */
export type ModelSpec = MlxModelConfig;

/** @deprecated Use MlxModelConfigManager instead */
export const ModelSpecManager = MlxModelConfigManager;

/** @deprecated Use MODEL_CONFIG_PRESETS instead */
export const MODEL_PRESETS = MODEL_CONFIG_PRESETS;
```

### 削除タイミング

次のメジャーバージョン（v1.0.0など）でエイリアスを削除

## 確認事項

- [ ] すべてのファイルが修正された
- [ ] 型チェックが通る
- [ ] すべてのテストがパスする
- [ ] ビルドが成功する
- [ ] ドキュメント更新（docs/mlx-api-selection.md など）

## 注意点

1. **ModelSpecificProcessor は変更しない**
   - これは別の概念（モデル固有の処理）
   - `process/model-specific.ts`で定義

2. **driver-registry の ModelSpec は無関係**
   - 別の型定義なので影響なし

3. **段階的な移行**
   - 一時的に両方の名前が共存
   - @deprecated マークで移行を促す
