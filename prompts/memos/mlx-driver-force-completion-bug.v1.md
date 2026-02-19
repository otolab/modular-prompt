# MLX Driver force-completion バグ調査レポート

> **ステータス**: 完了・反映済み（2025-11-21）
> **結果**: 3つの独立したバグを特定し修正。`apiStrategy: 'force-completion'` が正常に機能するようになった。

## 問題の概要

### 報告された問題
- `apiStrategy: 'force-completion'` を設定しているにもかかわらず、chat APIが使用される
- 「システムメッセージが5個検出」という警告が出る（chat API使用の証拠）
- パッケージバージョン: `@modular-prompt/driver@0.2.5`（最新）
- 対象モデル: `gemma-2-2b-it-4bit`

### 設定内容（問題報告者のコード）
```typescript
modelSpec: {
  apiStrategy: 'force-completion',
  chatRestrictions: undefined
}
```

---

## 根本原因：3つの独立したバグ

### バグ1: ModelSpecManagerのコンストラクタ処理順序の問題 ⭐ **最重要**

**場所**: `packages/driver/src/mlx-ml/model-spec/manager.ts:33-43`

**問題のコード**:
```typescript
constructor(modelName, process, customSpec?, customProcessor?) {
  // プリセットとカスタム設定をマージ
  const baseSpec = mergeWithPreset(modelName, customSpec);

  // デフォルト値を設定
  this.spec = {
    modelName,
    apiStrategy: 'auto',  // ⚠️ ここでapiStrategy: 'auto'を設定
    ...baseSpec,          // ⚠️ その後baseSpecで上書き（プリセットのprefer-chatが優先される）
    customProcessor: customProcessor || baseSpec.customProcessor,
    validatedPatterns: new Map()
  };
}
```

**問題点**:
1. `apiStrategy: 'auto'` を先に設定
2. その後 `...baseSpec` で展開
3. gemma-2-2b-it-4bitの場合、プリセット（presets.ts:14-25）に `prefer-chat` が設定されている
4. **結果**: customSpecの `force-completion` がプリセットの `prefer-chat` で上書きされる

**影響**:
- customSpecで `force-completion` を設定しても、プリセットの `prefer-chat` で上書きされる
- **これが主要な原因**

**修正方法**:
```typescript
this.spec = {
  modelName,
  apiStrategy: 'auto',
  ...baseSpec,
  ...customSpec,  // ← 追加：customSpecを最後に展開
  customProcessor: customProcessor || baseSpec.customProcessor,
  validatedPatterns: new Map()
};
```

---

### バグ2: initialize()での2重マージ問題

**場所**: `packages/driver/src/mlx-ml/model-spec/manager.ts:48-68`

**問題のコード**:
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;

  // 動的に能力を検出
  const detectedSpec = await this.detector.detectCapabilities();

  // 検出結果をマージ（既存の設定を優先）
  this.spec = {
    ...detectedSpec,
    ...this.spec,  // ← constructor()で既にマージ済みのspecを再度マージ
    capabilities: {
      ...detectedSpec.capabilities,
      ...this.spec.capabilities
    },
    chatRestrictions: {
      ...detectedSpec.chatRestrictions,
      ...this.spec.chatRestrictions  // ← 既にプリセットの値が入っている
    }
  };

  this.initialized = true;
}
```

**問題点**:
1. `constructor()` で既にプリセットとマージ済み
2. `initialize()` で再度マージすると、chatRestrictionsなどが残る
3. `chatRestrictions: undefined` を指定しても、プリセットの制限がそのまま残る

**影響**:
- `chatRestrictions: undefined` で「制限を消したい」という意図が伝わらない
- プリセットの制限が残り続ける

**修正方法**:
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;

  const detectedSpec = await this.detector.detectCapabilities();

  // apiStrategyとchatRestrictionsは既存の値を優先（マージしない）
  this.spec = {
    ...detectedSpec,
    ...this.spec,
    // capabilitiesのみ検出結果を優先してマージ
    capabilities: {
      ...this.spec.capabilities,
      ...detectedSpec.capabilities
    }
  };

  this.initialized = true;
}
```

---

### バグ3: mergeWithPreset()の深いマージ処理

**場所**: `packages/driver/src/mlx-ml/model-spec/presets.ts:112-138`

**問題のコード**:
```typescript
export function mergeWithPreset(
  modelName: string,
  customSpec?: Partial<import('./types.js').ModelSpec>
): Partial<import('./types.js').ModelSpec> {
  const preset = findPreset(modelName);

  if (!preset) {
    return customSpec || {};
  }

  // プリセットとカスタム設定をマージ（カスタムが優先）
  return {
    ...preset.spec,
    ...customSpec,
    modelName,
    // chatRestrictionsは深いマージ
    chatRestrictions: {
      ...preset.spec.chatRestrictions,  // ← プリセットの制限
      ...customSpec?.chatRestrictions   // ← undefinedの場合、何も展開されない
    },
    // capabilitiesも深いマージ
    capabilities: {
      ...preset.spec.capabilities,
      ...customSpec?.capabilities
    }
  };
}
```

**問題点**:
1. `customSpec.chatRestrictions: undefined` を指定した場合
2. `...undefined` は何も展開されないため、プリセットの制限がそのまま残る
3. **「制限を消したい」という意図が伝わらない**

**影響**:
- `chatRestrictions: undefined` を設定しても効果がない
- プリセットの制限が残り続ける

**修正方法（オプション1）**:
```typescript
export function mergeWithPreset(modelName, customSpec?) {
  const preset = findPreset(modelName);

  if (!preset) {
    return customSpec || {};
  }

  return {
    ...preset.spec,
    ...customSpec,
    modelName,
    // undefinedの場合は空オブジェクトとして扱う
    chatRestrictions: customSpec?.chatRestrictions !== undefined
      ? customSpec.chatRestrictions
      : preset.spec.chatRestrictions,
    capabilities: customSpec?.capabilities !== undefined
      ? customSpec.capabilities
      : preset.spec.capabilities
  };
}
```

**修正方法（オプション2 - より単純）**:
```typescript
export function mergeWithPreset(modelName, customSpec?) {
  const preset = findPreset(modelName);

  if (!preset) {
    return customSpec || {};
  }

  return {
    ...preset.spec,
    ...customSpec,
    modelName
    // 深いマージを削除（customSpecが優先される）
  };
}
```

---

## 問題が発生する具体的なフロー

### 1. ユーザーのコード
```typescript
new MlxDriver({
  model: 'gemma-2-2b-it-4bit',
  modelSpec: {
    apiStrategy: 'force-completion',
    chatRestrictions: undefined
  }
});
```

### 2. MlxDriver → MlxProcess → ModelSpecManager
```typescript
// mlx-driver.ts:141
this.process = new MlxProcess(config.model, config.modelSpec, config.customProcessor);

// process/index.ts:59
this.specManager = new ModelSpecManager(modelName, this, customSpec, customProcessor);
```

### 3. ModelSpecManager constructor()
```typescript
// manager.ts:33
const baseSpec = mergeWithPreset('gemma-2-2b-it-4bit', {
  apiStrategy: 'force-completion',
  chatRestrictions: undefined
});

// mergeWithPreset()の結果:
// {
//   apiStrategy: 'prefer-chat',  // ← customSpecのforce-completionが上書きされている
//   chatRestrictions: {
//     singleSystemAtStart: true,
//     alternatingTurns: true,
//     requiresUserLast: true,
//     maxSystemMessages: 1
//   }
// }

// manager.ts:36-43
this.spec = {
  modelName: 'gemma-2-2b-it-4bit',
  apiStrategy: 'auto',
  ...baseSpec,  // ← prefer-chatで上書き
  customProcessor: customProcessor || baseSpec.customProcessor,
  validatedPatterns: new Map()
};

// 結果:
// this.spec.apiStrategy = 'prefer-chat'
```

### 4. initialize()
```typescript
// manager.ts:48-68
const detectedSpec = await this.detector.detectCapabilities();

this.spec = {
  ...detectedSpec,
  ...this.spec,  // ← 既にprefer-chatになっている
  capabilities: { ... },
  chatRestrictions: { ... }  // ← プリセットの制限が残る
};
```

### 5. determineApi()の実行
```typescript
// mlx-driver.ts:177
const api = determineApiSelection(prompt, specManager, this.formatterOptions);

// determineApiSelection → specManager.determineApi()
// manager.ts:74-121
determineApi(messages: MlxMessage[]): 'chat' | 'completion' {
  const strategy = this.spec.apiStrategy;  // 'prefer-chat'

  // 強制モード
  if (strategy === 'force-chat') return 'chat';
  if (strategy === 'force-completion') return 'completion';  // ← 到達しない！

  // ...

  // 優先モード
  if (strategy === 'prefer-chat') {
    // メッセージが有効かチェック
    const validation = this.validateMessages(messages);
    if (validation.valid) {
      return 'chat';  // ← こちらが実行される
    }
    return 'completion';
  }

  // ...
}
```

**結果**: chat APIが使用される

---

## 修正案と作業計画

### 優先度1: 最小限の修正（バグ1のみ）⭐

**目的**: force-completionが機能するようにする

**修正対象**:
- `packages/driver/src/mlx-ml/model-spec/manager.ts:33-43`

**修正内容**:
```typescript
this.spec = {
  modelName,
  apiStrategy: 'auto',
  ...baseSpec,
  ...customSpec,  // ← この1行を追加
  customProcessor: customProcessor || baseSpec.customProcessor,
  validatedPatterns: new Map()
};
```

**影響範囲**: 最小
**リスク**: 低
**効果**: force-completionが機能するようになる

---

### 優先度2: 包括的な修正（バグ1, 2, 3すべて）

**目的**: 設定マージの挙動を正しくする

**修正対象**:
1. `packages/driver/src/mlx-ml/model-spec/manager.ts` (バグ1, 2)
2. `packages/driver/src/mlx-ml/model-spec/presets.ts` (バグ3)

**修正内容**:

#### 1. manager.ts - constructor()
```typescript
constructor(
  modelName: string,
  process: MlxProcess,
  customSpec?: Partial<ModelSpec>,
  customProcessor?: ModelCustomProcessor
) {
  this.process = process;
  this.detector = new ModelCapabilityDetector(process, modelName);

  // プリセットとカスタム設定をマージ
  const baseSpec = mergeWithPreset(modelName, customSpec);

  // デフォルト値を設定
  this.spec = {
    modelName,
    apiStrategy: 'auto',
    ...baseSpec,
    ...customSpec,  // ← 追加：customSpecを最後に展開
    customProcessor: customProcessor || baseSpec.customProcessor,
    validatedPatterns: new Map()
  };
}
```

#### 2. manager.ts - initialize()
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;

  // 動的に能力を検出
  const detectedSpec = await this.detector.detectCapabilities();

  // apiStrategyとchatRestrictionsは既存の値を優先
  this.spec = {
    ...detectedSpec,
    ...this.spec,
    // capabilitiesのみ検出結果を優先してマージ
    capabilities: {
      ...this.spec.capabilities,
      ...detectedSpec.capabilities
    }
  };

  this.initialized = true;
}
```

#### 3. presets.ts - mergeWithPreset() (オプション2を推奨)
```typescript
export function mergeWithPreset(
  modelName: string,
  customSpec?: Partial<import('./types.js').ModelSpec>
): Partial<import('./types.js').ModelSpec> {
  const preset = findPreset(modelName);

  if (!preset) {
    return customSpec || {};
  }

  // プリセットとカスタム設定をマージ（カスタムが優先）
  return {
    ...preset.spec,
    ...customSpec,
    modelName
  };
}
```

**影響範囲**: 中
**リスク**: 低〜中
**効果**: すべての設定が意図通りに動作する

---

### 優先度3: テストケースの追加

**目的**: 回帰を防止する

**追加テスト**:
- `packages/driver/src/mlx-ml/model-spec/manager.test.ts`

```typescript
describe('ModelSpecManager - apiStrategy override', () => {
  test('force-completion should override preset prefer-chat', async () => {
    const process = createMockProcess();
    const manager = new ModelSpecManager(
      'gemma-2-2b-it-4bit',
      process,
      { apiStrategy: 'force-completion' }
    );

    await manager.initialize();

    const api = manager.determineApi([
      { role: 'user', content: 'test' }
    ]);

    expect(api).toBe('completion');
  });

  test('chatRestrictions: undefined should clear preset restrictions', async () => {
    const process = createMockProcess();
    const manager = new ModelSpecManager(
      'gemma-2-2b-it-4bit',
      process,
      { chatRestrictions: undefined }
    );

    await manager.initialize();

    const spec = manager.getSpec();
    expect(spec.chatRestrictions).toBeUndefined();
  });

  test('custom apiStrategy should not be overwritten by initialize()', async () => {
    const process = createMockProcess();
    const manager = new ModelSpecManager(
      'gemma-2-2b-it-4bit',
      process,
      { apiStrategy: 'force-completion' }
    );

    await manager.initialize();

    const spec = manager.getSpec();
    expect(spec.apiStrategy).toBe('force-completion');
  });
});
```

---

## 検証方法

### 1. ユニットテストで検証
```bash
npm test -- packages/driver/src/mlx-ml/model-spec/manager.test.ts
```

### 2. 実際のモデルで検証
```typescript
const driver = new MlxDriver({
  model: 'gemma-2-2b-it-4bit',
  modelSpec: {
    apiStrategy: 'force-completion',
    chatRestrictions: undefined
  }
});

// システムメッセージが5個あるプロンプトを実行
// → completion APIが使用され、警告が出ないことを確認
```

---

## 推奨される実装順序

1. **ステップ1**: バグ1の修正（manager.ts constructor()）
2. **ステップ2**: テストケースの追加と実行
3. **ステップ3**: 動作確認（実際のモデルで検証）
4. **ステップ4**: バグ2, 3の修正（必要に応じて）
5. **ステップ5**: 追加テストと包括的な検証

---

## 影響範囲の分析

### 影響を受けるモデル
- **gemma-2-2b-it-4bit**: プリセットで `prefer-chat` が設定されている（最も影響大）
- **gemma-3シリーズ**: 同様のプリセット
- **Tanuki-8B**: prefer-chat設定
- **Phi-3シリーズ**: prefer-chat設定
- **Qwenシリーズ**: prefer-chat設定

### 影響を受けない設定
- カスタムモデル（プリセットなし）
- プリセットが `auto` または `force-completion` のモデル
- customSpecを指定しない場合

---

## 補足情報

### 関連ファイル
- `packages/driver/src/mlx-ml/mlx-driver.ts:49-72` - determineApiSelection()
- `packages/driver/src/mlx-ml/model-spec/manager.ts:74-121` - determineApi()
- `packages/driver/src/mlx-ml/model-spec/presets.ts:12-100` - MODEL_PRESETS
- `packages/driver/src/mlx-ml/model-spec/types.ts:56-62` - ApiStrategy型定義

### 参考PR
- PR #26: ModelSpecManagerの修正（該当する修正は含まれていない）

---

**作成日**: 2025-11-21
**対象バージョン**: @modular-prompt/driver@0.2.5
