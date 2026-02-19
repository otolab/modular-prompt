# Structured Outputs仕様

`@modular-prompt`におけるStructured Outputs（構造化出力）の仕様と実装ガイド。

## 概要

Structured Outputsは、AIモデルからの応答を構造化されたデータ（JSON）として取得する機能です。v0.2.0より正式サポートを開始し、各ドライバーが独自の方法で実装しています。

## アーキテクチャ

### データフロー

```
PromptModule (schema定義)
    ↓
CompiledPrompt (metadata.outputSchema)
    ↓
AIDriver (スキーマに基づく生成)
    ↓
QueryResult.structuredOutput
```

### 型定義

#### CompiledPrompt

```typescript
interface CompiledPrompt {
  instructions: Element[];
  data: Element[];
  output: Element[];
  metadata?: {
    outputSchema?: object;  // JSON Schemaオブジェクト
  };
}
```

#### QueryResult

```typescript
interface QueryResult {
  content: string;  // 生のテキストレスポンス

  /**
   * 構造化出力
   * - undefined: スキーマ未指定または有効なJSONなし
   * - object/array: 抽出されたJSON（スキーマに準拠）
   */
  structuredOutput?: unknown;

  usage?: {...};
  finishReason?: 'stop' | 'length' | 'error';
}
```

## 実装パターン

### 1. ネイティブサポート型

APIレベルでstructured outputsをサポート：

- **OpenAIDriver**: `response_format` APIパラメータを使用
- **VertexAIDriver**: `responseMimeType`と`responseSchema`パラメータを使用

### 2. JSON抽出型

レスポンスからJSONを抽出：

- **AnthropicDriver**: プロンプト指示 + JSON抽出
- **MlxDriver**: JSON抽出ユーティリティを使用
- **TestDriver / EchoDriver**: JSON抽出（詳細は[TEST_DRIVERS.md](./TEST_DRIVERS.md)）

### 3. OpenAI互換型

OpenAIDriverを継承し、OpenAI互換APIを使用：

- **OllamaDriver**: `response_format` APIパラメータを使用（OpenAIDriver継承）

## 使用方法

### 基本的な使用例

```typescript
import { compile } from '@modular-prompt/core';
import { OpenAIDriver } from '@modular-prompt/driver';

// モジュールのschemaセクションでJSONElementを定義
const myModule: PromptModule = {
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          skills: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['name', 'age']
      }
    }
  ]
};

// コンパイル時に自動的にmetadata.outputSchemaが設定される
const prompt = compile(myModule, context);

// ドライバーで実行
const driver = new OpenAIDriver({ apiKey: '...' });
const result = await driver.query(prompt);

// 構造化出力を取得
if (result.structuredOutput) {
  const data = result.structuredOutput as {
    name: string;
    age: number;
    skills?: string[];
  };
  console.log(data.name, data.age);
}
```

## JSON抽出ユーティリティ

`@modular-prompt/utils`パッケージの`extractJSON`関数は、様々な形式からJSONを抽出：

### 対応形式

1. **直接JSON**: `{"key": "value"}`
2. **マークダウンコードブロック**: `` ```json\n{"key": "value"}\n``` ``
3. **埋め込みJSON**: `Some text {"key": "value"} more text`

### 使用例

```typescript
import { extractJSON } from '@modular-prompt/utils';

const text = 'Result: ```json\n{"status": "success"}\n```';
const extracted = extractJSON(text, { multiple: false });

if (extracted.source !== 'none') {
  console.log(extracted.data);  // { status: "success" }
  console.log(extracted.source); // "markdown"
}
```

## ベストプラクティス

### 1. スキーマ設計

- **明確な型定義**: 曖昧さを避け、期待する構造を明確に定義
- **必須フィールドの明示**: `required`配列で必須項目を指定
- **デフォルト値の考慮**: オプショナルフィールドの扱いを明確に

### 2. エラーハンドリング

```typescript
const result = await driver.query(prompt);

// 構造化出力の検証
if (result.structuredOutput === undefined) {
  // スキーマが指定されていない、または有効なJSONが生成されなかった
  console.warn('No structured output generated:', result.content);
} else {
  // 成功
  const data = result.structuredOutput;
  // 型ガードやバリデーションを実施
}
```

### 3. フォールバック戦略

```typescript
// 構造化出力が失敗した場合のフォールバック
const data = result.structuredOutput ||
  parseManually(result.content) ||
  defaultData;
```

## ドライバー別対応状況

| ドライバー | 対応状況 | 実装方式 | 備考 |
|----------|---------|---------|-----|
| OpenAIDriver | ✅ 対応済み | response_format API | v0.2.0〜 |
| AnthropicDriver | ✅ 対応済み | プロンプト指示 + JSON抽出 | v0.2.1〜 |
| VertexAIDriver | ✅ 対応済み | responseMimeType/responseSchema | v0.2.0〜 |
| TestDriver | ✅ 対応済み | JSON抽出 | v0.2.1〜 |
| EchoDriver | ✅ 対応済み | JSON抽出 | v0.2.1〜 |
| MlxDriver | ✅ 対応済み | JSON抽出 | v0.2.0〜 |
| OllamaDriver | ✅ 対応済み | response_format API（OpenAIDriver継承） | コード変更なし、OpenAI互換APIを利用 |

## トラブルシューティング

### よくある問題

1. **JSONが生成されない**
   - プロンプトにJSON生成の明示的な指示を追加
   - スキーマの複雑さを減らす
   - temperature を下げて確定的な出力を促す

2. **不正なJSONが生成される**
   - モデルの制限を確認（トークン数等）
   - スキーマの構造を簡素化
   - extractJSON のエラーログを確認

3. **型の不一致**
   - スキーマと実際の出力を比較
   - 型ガードを実装してランタイムで検証
   - バリデーションライブラリの使用を検討

## 関連ドキュメント

- [Driver API](./DRIVER_API.md) - ドライバーインターフェースの詳細
- [型定義](../packages/core/src/types.ts) - CompiledPromptの型定義
- [JSON抽出ユーティリティ](../packages/utils/src/json-extractor/) - extractJSON関数の実装
