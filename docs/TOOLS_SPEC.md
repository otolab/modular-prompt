# Tools（Function Calling）仕様

`@modular-prompt`におけるTools（Function Calling）の仕様。

関連Issue: #89

## 概要

Toolsは、AIモデルに利用可能な関数を定義し、モデルがそれらを呼び出す判断を行う機能である。`QueryOptions`にtools定義を渡し、`QueryResult`でtool callの結果を受け取る。

## アーキテクチャ

### データフロー

```
QueryOptions (tools定義)
    ↓
AIDriver (toolsを含むリクエスト送信)
    ↓
QueryResult.toolCalls (モデルが選択した関数呼び出し)
    ↓
利用者がツールを実行し、結果を次のリクエストに含める
```

### 設計方針

- **OpenAI形式をベースに採用** — エコシステムで最も広く使われており、Ollama等のOpenAI互換APIとも整合する
- 既存の型（`QueryOptions`, `QueryResult`等）もOpenAI形式のキャメルケース命名を使用しており、一貫性がある
- 各ドライバーは共通型とSDK固有型の間でマッピングを行う

## 型定義

### ToolFunction

ツールとして公開する関数の定義。

```typescript
interface ToolFunction {
  /** 関数名（a-z, A-Z, 0-9, _, - で最大64文字） */
  name: string;
  /** 関数の説明。モデルがツール選択の判断に使用する */
  description?: string;
  /** パラメータのJSON Schemaオブジェクト */
  parameters?: Record<string, unknown>;
  /** 厳格なスキーマ遵守（OpenAI Structured Outputs連携） */
  strict?: boolean;
}
```

### ToolDefinition

ツール定義のラッパー。将来的に`function`以外のtypeを追加する拡張点。

```typescript
interface ToolDefinition {
  type: 'function';
  function: ToolFunction;
}
```

### ToolChoice

モデルのツール使用戦略を制御する。

```typescript
type ToolChoice =
  | 'auto'      // モデルが自動判断（デフォルト）
  | 'none'      // ツール使用禁止
  | 'required'  // 必ず1つ以上のツールを使用
  | { type: 'function'; function: { name: string } };  // 特定ツールを強制
```

### ToolCall

モデルが返すツール呼び出し結果。

```typescript
interface ToolCall {
  /** ツール呼び出しの一意ID（結果を返す際に参照） */
  id: string;
  type: 'function';
  function: {
    /** 呼び出す関数名 */
    name: string;
    /** 引数のJSON文字列 */
    arguments: string;
  };
}
```

### ChatMessage型

会話ループでtool callとtool resultを表現するためのUnion型。

```typescript
// 標準メッセージ（既存互換）
interface StandardChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// アシスタントのtool call付きメッセージ
interface AssistantToolCallMessage {
  role: 'assistant';
  content: string;
  toolCalls: ToolCall[];
}

// ツール実行結果メッセージ
interface ToolResultMessage {
  role: 'tool';
  content: string;
  toolCallId: string;
  /** GoogleGenAI/VertexAIのfunctionResponseで必要 */
  name?: string;
}

type ChatMessage = StandardChatMessage | AssistantToolCallMessage | ToolResultMessage;
```

型ガード関数: `hasToolCalls()`, `isToolResult()`

### QueryOptions（拡張）

```typescript
interface QueryOptions {
  // ...既存フィールド
  /** 利用可能なツールの定義 */
  tools?: ToolDefinition[];
  /** ツール使用戦略 */
  toolChoice?: ToolChoice;
  /** 会話ループ用の追加メッセージ（tool result等） */
  messages?: ChatMessage[];
}
```

### QueryResult（拡張）

```typescript
interface QueryResult {
  // ...既存フィールド
  /** モデルが選択したツール呼び出し（0個以上） */
  toolCalls?: ToolCall[];
  finishReason?: 'stop' | 'length' | 'error' | 'tool_calls';
}
```

## 各SDKとのマッピング

### OpenAI

共通型がOpenAI形式そのものであるため、ほぼ直接マッピング可能。

| 共通型 | OpenAI SDK型 |
|---|---|
| `ToolDefinition` | `ChatCompletionTool` |
| `ToolChoice` | `ChatCompletionToolChoiceOption` |
| `ToolCall` | `ChatCompletionMessageToolCall` |

`'required'`はOpenAI SDKの`ChatCompletionToolChoiceOption`にそのまま対応する。

### Anthropic

| 共通型 | Anthropic SDK型 | 変換 |
|---|---|---|
| `ToolDefinition` | `Tool` | `function.name` → `name`, `function.parameters` → `input_schema`（`type:'object'`ラップ） |
| `ToolChoice 'auto'` | `{ type: 'auto' }` | 文字列→オブジェクト |
| `ToolChoice 'none'` | `{ type: 'none' }` | 文字列→オブジェクト |
| `ToolChoice 'required'` | `{ type: 'any' }` | `'required'` → `'any'` |
| `ToolChoice { function }` | `{ type: 'tool', name }` | ネスト解除 |
| `ToolCall` | `ToolUseBlock` | `input`（オブジェクト）→ `arguments`（`JSON.stringify`） |

### GoogleGenAI

| 共通型 | GoogleGenAI SDK型 | 変換 |
|---|---|---|
| `ToolDefinition` | `Tool.functionDeclarations[]` | 配列でラップ。`parameters`はOpenAPI Schema形式に変換が必要な場合あり |
| `ToolChoice 'auto'` | `FunctionCallingConfigMode.AUTO` | 文字列→enum |
| `ToolChoice 'none'` | `FunctionCallingConfigMode.NONE` | 文字列→enum |
| `ToolChoice 'required'` | `FunctionCallingConfigMode.ANY` | `'required'` → `'ANY'` |
| `ToolChoice { function }` | `mode: ANY` + `allowedFunctionNames` | 構造変換 |
| `ToolCall` | `Part.functionCall` | `args`（オブジェクト）→ `arguments`（`JSON.stringify`）、レスポンスの`Part`配列から抽出 |

### Ollama

OpenAI互換APIのため、OpenAIと同様のマッピング。

## SDKごとの差異と対応方針

### `arguments`の型

- **OpenAI**: JSON文字列（`string`）
- **Anthropic**: パース済みオブジェクト（`unknown`）
- **GoogleGenAI**: パース済みオブジェクト（`Record<string, unknown>`）

→ 共通型はJSON文字列（OpenAI形式）を採用。Anthropic/GoogleGenAIドライバーでは`JSON.stringify()`で変換する。利用者は`JSON.parse()`で引数を取得する。

### ToolChoiceの表現

- **OpenAI**: 文字列リテラル or オブジェクト
- **Anthropic**: 常にオブジェクト（`{ type: '...' }`）
- **GoogleGenAI**: enum（`FunctionCallingConfigMode`）

→ 共通型はOpenAI形式（文字列リテラル優先）を採用。各ドライバーでSDK固有の形式に変換する。

### パラメータスキーマの形式

- **OpenAI**: JSON Schema
- **Anthropic**: JSON Schema（`type: 'object'`必須）
- **GoogleGenAI**: OpenAPI 3.0 Schema（JSON Schemaのサブセット、`Type` enumを使用）

→ 共通型はJSON Schemaの`Record<string, unknown>`を採用。GoogleGenAIドライバーでは必要に応じてSchema型への変換を行う。

### サーバーサイドツール

Anthropicには`bash_20250124`, `text_editor_*`, `web_search_*`等のサーバーサイドツールが存在するが、これらはプロバイダ固有の機能であり、共通型の対象外とする。必要な場合は各ドライバー固有のオプションで対応する。

## ストリーミング時の動作

### 基本動作

- `stream`（`AsyncIterable<string>`）にはテキスト出力のみが流れる。tool callの情報はストリームに含まれない
- tool callsは`StreamResult.result`（`Promise<QueryResult>`）の`toolCalls`フィールドに最終結果として格納される
- テキストとtool callが混在するレスポンスでは、テキスト部分のみがストリームに流れ、tool callは最終結果にまとめられる
- ストリーム中のtool callリアルタイム通知（deltaの逐次配信）はスコープ外とする

### 並列tool callsの処理

モデルが複数のtool callを同時に返す場合（OpenAIのparallel tool calls等）、ドライバーがストリーム中のdeltaをindexごとに蓄積し、`QueryResult.toolCalls`配列に全て格納する。

```
Stream中:
  chunk: tool_calls[0] delta → name: "get_weather", args partial
  chunk: tool_calls[1] delta → name: "get_time", args partial
  chunk: tool_calls[0] delta → args continued
  chunk: tool_calls[1] delta → args continued
        ↓ ドライバーがindexごとに蓄積

QueryResult.toolCalls = [
  { id: "call_1", function: { name: "get_weather", arguments: '{"city":"tokyo"}' } },
  { id: "call_2", function: { name: "get_time", arguments: '{"timezone":"JST"}' } }
]
```

### ドライバーごとの蓄積方法

- **OpenAI**: chunkの`tool_calls[].index`でdeltaを識別し蓄積
- **Anthropic**: `content_block_start`の`index`で`ToolUseBlock`を識別し、`input_json_delta`で引数を蓄積
- **GoogleGenAI**: `Part.functionCall`として返される。ストリーム完了時に抽出

## 会話ループについて

ツール呼び出し結果をモデルに返す会話ループの実装は**利用者側の責務**とする。ドライバーは単一のリクエスト・レスポンスの処理のみを担当する。`QueryOptions.messages`にtool callとtool resultのメッセージを渡すことで会話ループを実現する。

### 使用例

```typescript
// 1. 初回クエリ（ツール定義付き）
const result1 = await driver.query(prompt, {
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: '指定都市の天気を取得',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city']
      }
    }
  }]
});

// 2. tool callsがあれば実行
if (result1.toolCalls) {
  const toolResults = await Promise.all(
    result1.toolCalls.map(async tc => {
      const args = JSON.parse(tc.function.arguments);
      const result = await executeFunction(tc.function.name, args);
      return {
        role: 'tool' as const,
        content: JSON.stringify(result),
        toolCallId: tc.id,
        name: tc.function.name  // GoogleGenAI/VertexAI用
      };
    })
  );

  // 3. tool結果を含めて再クエリ
  const result2 = await driver.query(prompt, {
    tools: myTools,
    messages: [
      // アシスタントのtool call付きメッセージ
      {
        role: 'assistant',
        content: result1.content,
        toolCalls: result1.toolCalls
      },
      // ツール実行結果
      ...toolResults
    ]
  });
}
```

### 各ドライバーでのメッセージ変換

`options.messages`はCompiledPromptから生成されたメッセージの末尾に追加され、各ドライバーがSDK固有の形式に変換する。

| 共通型 | OpenAI | Anthropic | GoogleGenAI/VertexAI |
|---|---|---|---|
| `AssistantToolCallMessage` | `{ role:'assistant', tool_calls }` | `{ role:'assistant', content:[text, tool_use] }` | `{ role:'model', parts:[functionCall] }` |
| `ToolResultMessage` | `{ role:'tool', tool_call_id }` | `{ role:'user', content:[tool_result] }` | `{ role:'user', parts:[functionResponse] }` |

この設計により、ツール実行の制御（並列実行、エラーハンドリング、再試行等）を利用者が柔軟に行える。
