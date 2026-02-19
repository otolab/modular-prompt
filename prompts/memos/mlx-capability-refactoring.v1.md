# MLX Capability公開機能のリファクタリング

> **ステータス**: 完了・反映済み（2025-11-25）
> **結果**: ModelSpecManagerを削減し、`getCapabilities()`メソッドを追加。TypeScript側とPython側の責務を明確化。1,853行のコード削減に成功。

## 背景

nymphish-claudeでの利用を想定したcapability公開機能の実装において、設計の問題点が明らかになった：

1. **型名の衝突**: `MlxCapabilities`という名前が2つの異なる型で使われている
2. **責務の混在**: 設定（Config）と事実（Capability）が混在している
3. **不要な複雑性**: プリセット、動的検出、カスタム設定のマージロジックが複雑
4. **snake_caseの公開**: Pythonの命名規則がそのまま外部APIに露出

## 設計原則の再確認

### 情報の分類

1. **モデルの性質・制約** - 事実、客観的情報
   - 検出元: Pythonプロセス（動的検出）
   - 例: `hasChatTemplate: true`, `maxSystemMessages: 1`
   - 公開方法: `getCapabilities()`

2. **実行時の指示** - ユーザーの意図
   - 指定方法: `query(prompt, { apiStrategy: 'force-completion' })`
   - 公開不要

### 責務の分離

- **Python側**: モデルの性質・制約を検出（動的検出 + 必要なら静的知識）
- **TypeScript側**: snake_case → camelCase の載せ替えのみ

## 実装方針

### 1. 型の整理

#### 内部型（Pythonとの通信用）
```typescript
// process/types.ts
interface MlxRuntimeInfo {  // MlxCapabilities から改名
  methods: string[];
  special_tokens: Record<string, SpecialToken | SpecialTokenPair>;
  features: {
    apply_chat_template: boolean;
    vocab_size?: number;
    model_max_length?: number;
    chat_template?: ChatTemplateInfo;
  };
  chat_restrictions?: {
    single_system_at_start?: boolean;
    max_system_messages?: number;
    alternating_turns?: boolean;
    requires_user_last?: boolean;
    allow_empty_messages?: boolean;
  };
}
```

#### 公開型（外部API用）
```typescript
// mlx-ml/types.ts（新規作成または簡素化）
interface MlxModelCapabilities {
  methods: string[];
  specialTokens: Record<string, SpecialToken | SpecialTokenPair>;
  features: {
    hasChatTemplate: boolean;
    vocabSize?: number;
    modelMaxLength?: number;
    chatTemplate?: ChatTemplateInfo;
  };
  chatRestrictions?: {
    singleSystemAtStart?: boolean;
    maxSystemMessages?: number;
    alternatingTurns?: boolean;
    requiresUserLast?: boolean;
    allowEmptyMessages?: boolean;
  };
}
```

### 2. 公開API

```typescript
class MlxDriver {
  private runtimeInfo: MlxRuntimeInfo | null = null;

  private async ensureInitialized(): Promise<void> {
    if (!this.runtimeInfo) {
      this.runtimeInfo = await this.process.getCapabilities();
    }
  }

  async getCapabilities(): Promise<MlxModelCapabilities> {
    await this.ensureInitialized();

    // snake_case → camelCase の載せ替えのみ
    return {
      methods: this.runtimeInfo!.methods,
      specialTokens: this.runtimeInfo!.special_tokens,
      features: {
        hasChatTemplate: this.runtimeInfo!.features.apply_chat_template,
        vocabSize: this.runtimeInfo!.features.vocab_size,
        modelMaxLength: this.runtimeInfo!.features.model_max_length,
        chatTemplate: this.runtimeInfo!.features.chat_template,
      },
      chatRestrictions: this.runtimeInfo!.chat_restrictions ? {
        singleSystemAtStart: this.runtimeInfo!.chat_restrictions.single_system_at_start,
        maxSystemMessages: this.runtimeInfo!.chat_restrictions.max_system_messages,
        alternatingTurns: this.runtimeInfo!.chat_restrictions.alternating_turns,
        requiresUserLast: this.runtimeInfo!.chat_restrictions.requires_user_last,
        allowEmptyMessages: this.runtimeInfo!.chat_restrictions.allow_empty_messages,
      } : undefined
    };
  }
}
```

### 3. 削除するファイル・コード

#### 完全削除
- `model-spec/presets.ts` - 静的なModelSpec定義（Python側で扱う）
- `model-spec/detector.ts` - 動的検出ロジック（Python側で扱う）
- `model-spec/manager.ts` - MlxModelConfigManager全体
- `model-spec/types.ts`の以下の型:
  - `MlxCapabilities`（衝突していた型）
  - `MlxModelConfig`
  - `MlxModelConfigPreset`
  - `ApiSelectionContext`
  - `ModelCustomProcessor`

#### メソッド削除
- `MlxDriver.getModelConfig()` - 不要

### 4. 残すもの

#### `model-spec/types.ts`
```typescript
// 最小限の型定義のみ
export type ApiStrategy =
  | 'auto'
  | 'force-chat'
  | 'force-completion';

export interface ChatRestrictions {
  singleSystemAtStart?: boolean;
  maxSystemMessages?: number;
  alternatingTurns?: boolean;
  requiresUserLast?: boolean;
  allowEmptyMessages?: boolean;
}
```

#### `model-spec/validator.ts`
- メッセージの前処理で使う場合は残す
- 不要なら削除（要確認）

### 5. API選択ロジック

`MlxDriver`内部に簡素化して統合：

```typescript
private determineApi(): 'chat' | 'completion' {
  // QueryOptionsで指定があればそれを使う
  const strategy = queryOptions?.apiStrategy || 'auto';

  if (strategy === 'force-completion') return 'completion';
  if (strategy === 'force-chat') return 'chat';

  // auto: chat templateがあればchat、なければcompletion
  return this.runtimeInfo?.features.apply_chat_template
    ? 'chat'
    : 'completion';
}
```

## 作業手順

1. **型の追加**
   - `MlxModelCapabilities`型を作成
   - エクスポートを整備

2. **getCapabilities()の実装**
   - `MlxDriver`に追加
   - 載せ替えロジックを実装

3. **型名のリネーム**
   - `process/types.ts`: `MlxCapabilities` → `MlxRuntimeInfo`
   - 全参照箇所を更新

4. **不要コードの削除**
   - `presets.ts`, `detector.ts`, `manager.ts`
   - `getModelConfig()`メソッド
   - 不要な型定義

5. **API選択ロジックの簡素化**
   - `MlxDriver`内部に統合
   - 複雑なマージロジックを削除

6. **テストの更新**
   - 削除したファイルのテストを削除
   - 新しいAPIのテストを追加

7. **動作確認**
   - ビルド
   - テスト実行
   - 型チェック

## 期待される効果

1. **シンプルな設計**: 責務が明確に分離される
2. **保守性の向上**: 複雑なマージロジックがなくなる
3. **一貫性**: snake_case/camelCaseの境界が明確
4. **拡張性**: Python側で機能を追加しやすい

## 注意点

- Python側の`chat_restrictions`実装が必要（現状では未実装の可能性）
- `model-spec/validator.ts`の使用状況を確認
- 既存のテストが多数失敗する可能性

---

## 作業進捗

### 完了した作業 (2025-11-24)

#### フェーズ1: TypeScript側の実装 (commits: e636e5e, 413f464, 7a92c0c, e829827)

1. **型の追加** ✅
   - `src/mlx-ml/types.ts`に公開型を追加
   - `MlxModelCapabilities`, `ChatRestrictions`, `ModelFeatures`, `ChatTemplateInfo`
   - `ApiStrategy`型

2. **getCapabilities()の実装** ✅
   - `MlxDriver.getCapabilities()`メソッドを追加
   - snake_case → camelCase の載せ替えロジック実装
   - chat_restrictionsフィールドの変換実装

3. **型名のリネーム** ✅
   - `process/types.ts`: `MlxCapabilities` → `MlxRuntimeInfo`
   - `MlxDriver.capabilities` → `MlxDriver.runtimeInfo`
   - `process/index.ts`, `process/queue.ts`を更新

4. **不要なmodel-specコードの削除** ✅
   - `detector.ts`, `manager.ts`, `manager.test.ts`, `presets.ts`, `validator.ts`, `validator.test.ts`を削除
   - `types.ts`を簡素化（ChatRestrictions, ApiStrategyのみ）

5. **API選択ロジックの簡素化** ✅
   - `MlxDriver`内に`determineApi()`メソッドを追加
   - 複雑なマージロジックを削除

6. **型の重複解消** ✅
   - `mlx-ml/types.ts`から重複した型定義を削除
   - `model-spec/index.js`から型をインポート・re-export

**削除されたコード**: 1,853行
**テスト**: 全243件が成功

### フェーズ2: Python側のchat_restrictions実装 ✅ (2025-11-25)

#### 実装完了内容

**新規ファイル**:
- `src/mlx-ml/python/chat_template_constraints.py` - チャット制約検出モジュール
  - `detect_chat_restrictions(tokenizer)`: メイン検出関数
  - `_get_test_patterns()`: 8つのテストパターン定義
  - `_infer_restrictions_from_results()`: テスト結果から制約を推論

**更新ファイル**:
- `src/mlx-ml/python/token_utils.py`
  - `detect_chat_restrictions`をimport
  - `get_capabilities()`に`chat_restrictions`フィールドを追加

**検出される制約**:
- `single_system_at_start`: systemメッセージは先頭に1つだけ
- `max_system_messages`: システムメッセージの最大数
- `alternating_turns`: user/assistantメッセージが交互に必要
- `requires_user_last`: 最後のメッセージはuserである必要
- `allow_empty_messages`: 空メッセージの許可

**データフロー**:
1. Python: `detect_chat_restrictions()` → `chat_restrictions` (snake_case)
2. TypeScript: `MlxRuntimeInfo.chat_restrictions` → `MlxModelCapabilities.chatRestrictions` (camelCase変換)
3. 外部API: `getCapabilities()` → `chatRestrictions`フィールドとして公開

**テスト結果**: 全243件のテストが成功 ✅

**実装アプローチ**:
- 削除されたTypeScriptコード (`detector.ts`, `validator.ts`) をPythonに移植
- 既存の`token_utils.py`のroleチェックパターンを参考に実装
- `apply_chat_template()`のtry/exceptで制約を検出

### 環境再構築手順 (compact後)

1. **作業メモの確認**
   ```bash
   cat prompts/memos/mlx-capability-refactoring.v1.md
   ```

2. **現在の状態確認**
   ```bash
   git log -1 --oneline
   git status
   ```

3. **型チェック**
   ```bash
   npm run typecheck
   ```

4. **次のタスク開始**
   - model-specディレクトリの不要ファイル削除
   - API選択ロジックの簡素化
   - テストの更新と実行
