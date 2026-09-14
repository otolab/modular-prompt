# MLX Driver API Selection

MLX Driverは、chat APIとcompletion APIの2つのAPIを提供しています。このドキュメントでは、どちらのAPIを使用するかを決定するロジックと、カスタマイズ方法について説明します。

## デフォルトのAPI選択ロジック

`ModelSpecManager.determineApi()`は、以下の順序でAPIを選択します：

### 1. カスタムロジック（最優先）

`customProcessor.determineApi()`が提供されている場合、それが最優先されます。

```typescript
const driver = new MlxDriver({
  model: 'some-model',
  modelSpec: {
    customProcessor: {
      determineApi: (context) => {
        // カスタムロジック
        if (/* 特定の条件 */) {
          return 'completion';
        }
        // デフォルトロジックに委譲
        return undefined;
      }
    }
  }
});
```

### 2. 強制モード

`apiStrategy`が`'force-chat'`または`'force-completion'`の場合、その設定が優先されます。

```typescript
modelSpec: {
  apiStrategy: 'force-completion'  // 常にcompletion APIを使用
}
```

### 3. 機能チェック

- `hasApplyChatTemplate: false`の場合: completion APIを使用
- `supportsCompletion: false`の場合: chat APIを使用

### 4. 優先モード

#### `prefer-chat`

1. メッセージを検証
2. 有効な場合: chat APIを使用
3. 無効な場合: completion APIにフォールバック

```typescript
modelSpec: {
  apiStrategy: 'prefer-chat',
  chatRestrictions: {
    singleSystemAtStart: true,
    requiresUserLast: true
  }
}
```

#### `prefer-completion`

常にcompletion APIを使用します。

### 5. `auto`モード（デフォルト）

1. メッセージを検証
2. chat制限に違反している場合: completion APIを使用
3. chat制限が3個以上の場合: completion APIを使用
4. それ以外: chat APIを使用

---

## カスタムAPI選択ロジック

`customProcessor.determineApi()`を使用して、独自のロジックを実装できます。

### ApiSelectionContext

カスタムロジックには、以下の情報が提供されます：

```typescript
interface ApiSelectionContext {
  messages: MlxMessage[];              // 処理対象のメッセージ
  validation: ValidationResult;        // メッセージの検証結果
  capabilities: {                      // モデルの機能情報
    hasApplyChatTemplate?: boolean;
    supportsCompletion?: boolean;
  };
  chatRestrictions?: ChatRestrictions; // チャット制限
  apiStrategy: ApiStrategy;            // 設定されたapiStrategy
}
```

### 戻り値

- `'chat'`: chat APIを使用
- `'completion'`: completion APIを使用
- `undefined`: デフォルトロジックに委譲

---

## ヘルパー関数

### createModulerPromptApiSelector()

modular-promptの典型的なパターン（system → user → system(cue)）に最適化されたセレクター。

#### 検出するパターン

```typescript
[
  { role: 'system', content: 'instructions...' },
  { role: 'user', content: 'input data...' },
  { role: 'system', content: 'Please output in JSON format' }  // cue
]
```

#### 問題となる制限

- `singleSystemAtStart: true` - systemメッセージは先頭1つのみ
- `maxSystemMessages: 1` - システムメッセージは1個まで

上記パターンと制限の組み合わせでは、cueメッセージを配置できないため、completion APIを強制します。

#### 使用例

```typescript
import { createModulerPromptApiSelector } from '@modular-prompt/driver/mlx-ml/model-spec';

const driver = new MlxDriver({
  model: 'gemma-2-2b-it-4bit',
  modelSpec: {
    customProcessor: {
      determineApi: createModulerPromptApiSelector()
    }
  }
});
```

### createSystemMessageBasedSelector(minSystemMessages)

システムメッセージの数に基づくセレクター。

#### パラメータ

- `minSystemMessages`: この数以上のsystemメッセージがある場合に判定（デフォルト: 2）

#### 使用例

```typescript
import { createSystemMessageBasedSelector } from '@modular-prompt/driver/mlx-ml/model-spec';

const driver = new MlxDriver({
  model: 'some-model',
  modelSpec: {
    customProcessor: {
      determineApi: createSystemMessageBasedSelector(3)
    }
  }
});
```

### combineSelectors(selectors)

複数のセレクターを組み合わせるコンビネーター。

#### 動作

セレクターを順番に実行し、最初に`undefined`以外を返したセレクターの結果を使用します。

#### 使用例

```typescript
import {
  combineSelectors,
  createModulerPromptApiSelector,
  createSystemMessageBasedSelector
} from '@modular-prompt/driver/mlx-ml/model-spec';

const driver = new MlxDriver({
  model: 'some-model',
  modelSpec: {
    customProcessor: {
      determineApi: combineSelectors([
        // 1. modular-promptパターンをチェック
        createModulerPromptApiSelector(),
        // 2. システムメッセージ数をチェック
        createSystemMessageBasedSelector(3),
        // 3. カスタムロジック
        (context) => {
          if (context.messages.length > 100) {
            return 'completion';
          }
          return undefined;
        }
      ])
    }
  }
});
```

---

## ユースケース別の推奨設定

### 1. modular-promptで使用する場合

```typescript
import { createModulerPromptApiSelector } from '@modular-prompt/driver/mlx-ml/model-spec';

const driver = new MlxDriver({
  model: 'gemma-2-2b-it-4bit',
  modelSpec: {
    customProcessor: {
      determineApi: createModulerPromptApiSelector()
    }
  }
});
```

### 2. chat APIを優先したいが、制限違反時はフォールバック

```typescript
const driver = new MlxDriver({
  model: 'some-model',
  modelSpec: {
    apiStrategy: 'prefer-chat'
  }
});
```

### 3. 常にcompletion APIを使用

```typescript
const driver = new MlxDriver({
  model: 'some-model',
  modelSpec: {
    apiStrategy: 'force-completion'
  }
});
```

### 4. 完全カスタムロジック

```typescript
const driver = new MlxDriver({
  model: 'some-model',
  modelSpec: {
    customProcessor: {
      determineApi: (context) => {
        // 独自のロジック
        const systemMessages = context.messages.filter(m => m.role === 'system');
        const hasComplexPattern = systemMessages.length > 2;

        if (hasComplexPattern && context.chatRestrictions?.singleSystemAtStart) {
          return 'completion';
        }

        // デフォルトロジックに委譲
        return undefined;
      }
    }
  }
});
```

---

## トラブルシューティング

### chat APIでエラーが発生する

**症状**: 「システムメッセージが複数ある」などのエラー

**原因**: chat制限に違反している

**解決策**:
1. `apiStrategy: 'force-completion'`を設定
2. または`createModulerPromptApiSelector()`を使用

### completion APIしか使われない

**症状**: chat APIを使いたいのにcompletion APIが選択される

**原因**: デフォルトロジックがchat制限を厳しいと判断

**解決策**:
1. `apiStrategy: 'prefer-chat'`を設定
2. または`chatRestrictions: undefined`で制限をクリア

---

## 関連ドキュメント

- [型定義](../src/mlx-ml/model-spec/types.ts)
- [ヘルパー関数](../src/mlx-ml/model-spec/helpers.ts)
- [ModelSpecManager](../src/mlx-ml/model-spec/manager.ts)
