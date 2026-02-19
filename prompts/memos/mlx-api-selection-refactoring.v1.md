# MLX API選択ロジックのリファクタリング

> **ステータス**: 活用中
> **結果**: カスタムロジック機構削除の方針は決定。`initialize()`のマージ処理については検討が必要。

## 経緯

1. **初期バグ修正** (他の人が実装)
   - `apiStrategy: 'force-completion'`が機能しない3つの独立したバグを修正
   - すべてのテストがパス

2. **機能追加の検討**
   - modular-promptの典型的パターン（system → user → system(cue)）が、厳格なchat制限（`singleSystemAtStart`）により失敗する問題に対処
   - 外部からAPI選択ロジックをカスタマイズできる機構を追加
   - `customProcessor.determineApi()`の実装
   - ヘルパー関数（`createModulerPromptApiSelector()`など）の実装
   - ドキュメント作成

3. **設計の再検討**
   - ユーザーからの指摘: capabilitiesが外部で読めるなら、`apiStrategy`を使って調整できるため、カスタムロジック機構は不要
   - 代わりに`getModelSpec()`を公開する方針に変更
   - カスタムロジック機構は削除予定

4. **調査フェーズ**
   - `getCapabilities()`と`getModelSpec()`の棲み分けを整理
   - model-specの使用範囲を調査
   - **重要な発見**: `initialize()`が動的検出した`chatRestrictions`をマージしていない

---

## 現状の整理

### ModelSpecの二重定義

**1. MLX専用のModelSpec** (`packages/driver/src/mlx-ml/model-spec/types.ts`)
```typescript
export interface ModelSpec {
  modelName: string;
  capabilities?: {
    hasApplyChatTemplate?: boolean;
    supportsCompletion?: boolean;
    specialTokens?: Record<string, any>;
  };
  apiStrategy?: ApiStrategy;
  chatRestrictions?: ChatRestrictions;
  customProcessor?: ModelCustomProcessor;
  validatedPatterns?: Map<string, ValidationResult>;
}
```

- **用途**: MLXドライバー内部でのchat/completion選択制御
- **範囲**: `packages/driver/src/mlx-ml/`内でのみ使用
- **特徴**: chat制限、動的検出、API選択戦略など、MLX固有の詳細な仕様

**2. 汎用のModelSpec** (`packages/driver/src/driver-registry/types.ts`)
```typescript
export interface ModelSpec {
  model: string;
  provider: DriverProvider;
  capabilities: DriverCapability[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  cost?: { input: number; output: number };
  // ... その他
}
```

- **用途**: ドライバーレジストリでの全ドライバー共通のモデル仕様
- **範囲**: `packages/driver/src/driver-registry/`で使用
- **特徴**: ドライバー横断的な情報（token制限、コスト、能力フラグなど）

**結論**: 2つのModelSpecは**完全に別物**。名前は同じだが目的と内容が異なる。

---

### ModelSpecManagerの動作

**コンストラクタ** (`manager.ts:37-64`)
```typescript
constructor(modelName: string, process: MlxProcess, customSpec?: Partial<ModelSpec>) {
  this.modelName = modelName;
  this.process = process;
  this.detector = new ModelSpecDetector(process);

  // 1. プリセットを取得
  const preset = getPresetForModel(modelName);

  // 2. プリセットとカスタムをマージ
  this.spec = {
    modelName,
    ...mergeWithPreset(preset, customSpec)  // ← バグ修正済み
  };
}
```

**initialize()メソッド** (`manager.ts:74-91`)
```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;

  // Pythonプロセスから動的に検出
  const detectedSpec = await this.detector.detectCapabilities();

  // ❌ 問題: capabilitiesのみマージ
  this.spec = {
    ...this.spec,
    capabilities: {
      ...this.spec.capabilities,
      ...detectedSpec.capabilities  // ← capabilitiesだけ
    }
    // chatRestrictions、apiStrategyは捨てられる
  };

  this.initialized = true;
}
```

**detectCapabilities()が返す内容** (`detector.ts`)
```typescript
async detectCapabilities(): Promise<Partial<ModelSpec>> {
  const capabilities = await this.process.getCapabilities();

  return {
    capabilities: {
      hasApplyChatTemplate: capabilities.features.apply_chat_template,
      supportsCompletion: true,
      specialTokens: capabilities.special_tokens
    },
    chatRestrictions: await this.detectChatRestrictions(),  // ← 無視される
    apiStrategy: this.determineApiStrategy(spec)  // ← 無視される
  };
}
```

**問題点**:
- `detectCapabilities()`は`chatRestrictions`と`apiStrategy`を動的検出
- しかし`initialize()`は`capabilities`しかマージしない
- 動的検出した情報の大部分が捨てられている
- **非合理的**

---

### カスタムロジック機構の現状

**追加した機能**:
- `ApiSelectionContext`型の定義
- `ModelCustomProcessor.determineApi()`メソッド
- `helpers.ts`ファイル（ヘルパー関数群）
- `helpers.test.ts`ファイル（13テスト）
- `manager.test.ts`への4テスト追加
- `docs/mlx-api-selection.md`ドキュメント

**削除予定の理由**:
- `getModelSpec()`を公開すれば、外部でcapabilitiesとchatRestrictionsを確認できる
- ユーザーは`apiStrategy`を指定するだけで済む
- カスタムロジック機構は過剰設計

---

## 発見された問題

### 1. initialize()がchatRestrictionsをマージしない

**現状**:
```typescript
this.spec = {
  ...this.spec,
  capabilities: {
    ...this.spec.capabilities,
    ...detectedSpec.capabilities
  }
  // chatRestrictions、apiStrategyを無視
};
```

**期待される動作**:
```typescript
this.spec = {
  ...this.spec,
  capabilities: {
    ...this.spec.capabilities,
    ...detectedSpec.capabilities
  },
  chatRestrictions: {
    ...this.spec.chatRestrictions,
    ...detectedSpec.chatRestrictions  // ← 追加すべき？
  },
  apiStrategy: detectedSpec.apiStrategy ?? this.spec.apiStrategy  // ← 追加すべき？
};
```

**疑問点**:
- `chatRestrictions`と`apiStrategy`は動的検出すべきか、それともプリセット/カスタム設定のみか？
- 動的検出結果とカスタム設定の優先順位は？
  - 現状: カスタム設定が優先（capabilitiesのみ両方をマージ）
  - 提案: すべて同様にマージ？それとも完全上書き？

### 2. getModelSpec()が未実装

**現状**: `ModelSpecManager.getSpec()`は存在するが、`MlxDriver`から公開されていない

**必要な実装**:
```typescript
// mlx-driver.ts
public getModelSpec(): Readonly<ModelSpec> {
  return this.specManager.getSpec();
}
```

---

## 残タスク

### 確定している作業
1. **カスタムロジック機構の削除**
   - `types.ts`から`ApiSelectionContext`を削除
   - `ModelCustomProcessor.determineApi`を削除
   - `helpers.ts`全体を削除
   - `helpers.test.ts`全体を削除
   - `manager.test.ts`のカスタムロジックテスト削除
   - `docs/mlx-api-selection.md`削除

2. **getModelSpec()の追加**
   - `MlxDriver`に`getModelSpec()`メソッドを追加

### 検討が必要な作業
3. **initialize()の修正**
   - `chatRestrictions`を動的検出結果からマージすべきか？
   - `apiStrategy`を動的検出結果からマージすべきか？
   - マージロジック（浅いマージ vs 深いマージ vs 完全上書き）
   - カスタム設定と動的検出の優先順位

---

## 質問事項

1. **initialize()の修正方針**
   - 動的検出した`chatRestrictions`と`apiStrategy`もマージすべきか？
   - マージする場合、どのような優先順位で？

2. **作業の順序**
   - 先にカスタムロジック機構を削除してから`initialize()`を修正？
   - それとも`initialize()`を先に修正？

3. **動的検出の役割**
   - `detector.detectChatRestrictions()`と`detector.determineApiStrategy()`は何のために存在するのか？
   - 現在は検出しても捨てているが、本来の意図は？
