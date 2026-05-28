# MLX Tool Call Parser アーキテクチャ

MLXドライバーのtool-call-parser（`packages/driver/src/mlx-ml/tool-call-parser/`）は、多様なモデル固有のツール呼び出しフォーマットを統一的に処理するパーサーシステムです。

## 概要

MLXドライバーは、Qwen、Gemma、Mistral、LongCat、GLM等、多数のローカルモデルをサポートします。これらのモデルはそれぞれ異なるツール呼び出しフォーマット（JSON、XML、Pythonic、独自記法）を採用しており、単一のパーサーで対応することは困難です。

tool-call-parserは、**デリミタ検出とコンテンツパースの分離**により、モデル固有のフォーマットを拡張可能な形で処理します。

## 設計原則

### 1. デリミタ検出とコンテンツパースの分離

```
入力テキスト
  ↓
[detector.ts] runtimeInfoからデリミタ候補を検出
  ↓
[index.ts] デリミタで囲まれた部分を切り出し
  ↓
[content-parsers.ts] 中身をJSON/XML/Pythonic等で解釈
  ↓
ToolCall[]
```

- **detector.ts**: モデルのruntimeInfo（tokenizer情報）からデリミタペア（`<tool_call>`, `</tool_call>`等）を検出
- **content-parsers.ts**: 切り出されたコンテンツを各種フォーマットでパース

### 2. ContentParserインターフェース

新しいフォーマットのサポートは、`ContentParser`インターフェースを実装して`defaultContentParsers`配列に追加するだけで完了します。

```typescript
interface ContentParser {
  readonly name: string;
  parse(content: string): ParsedToolCall | ParsedToolCall[] | null;
}
```

### 3. パーサー種別→デリミタのマッピングはTypeScript側に一元化

以前のアーキテクチャでは、Python側（`token_utils.py`）にもデリミタテーブルが存在しましたが、現在は削除されています。

- **TypeScript側** (`detector.ts`): `KNOWN_TOOL_PARSER_DELIMITERS` でパーサー種別→デリミタのマッピングを一元管理
- **Python側** (`token_utils.py`): tokenizerへのアクセス（special tokens検出、chat_templateテキストからのデリミタ抽出）のみ

これにより、TypeScriptとPythonの2箇所でデータを同期する必要がなくなり、保守性が向上しました。

## ファイル構成

```
packages/driver/src/mlx-ml/tool-call-parser/
├── index.ts              # 公開API（parseToolCalls）とパースフロー
├── types.ts              # 型定義（ContentParser、ParsedToolCall、DelimiterPair等）
├── detector.ts           # デリミタ検出（KNOWN_TOOL_PARSER_DELIMITERS一元管理）
├── content-parsers.ts    # ContentParserインターフェース実装（json/gemma4/pythonic/xml）
├── tool-formatter.ts     # ツール定義のテキストフォーマッタ
├── utils.ts              # 共通ユーティリティ（coerceValue、extractBracketedValue等）
└── *.test.ts             # 各モジュールの単体テスト（計4ファイル、62テスト）
```

## 主要モジュール

### detector.ts

runtimeInfoからデリミタペアを検出します。検出ソースは3種類：

1. **tool_call_format** (`call_start`/`call_end`): chat_templateから直接取得
2. **tool_parser_type** (例: `"json_tools"`): `KNOWN_TOOL_PARSER_DELIMITERS` テーブルでデリミタに変換
3. **special_tokens** (例: `tool_call`、`longcat_tool_call`): tokenizer特殊トークンからデリミタを抽出

```typescript
export interface DetectionResult {
  delimiters: DetectedDelimiter[];  // 検出されたデリミタペア（優先順）
  marker: DetectedMarker | null;    // Mistral型のマーカートークン
}

export function detect(runtimeInfo: MlxRuntimeInfo | null): DetectionResult;
```

**KNOWN_TOOL_PARSER_DELIMITERS**（TypeScript側に一元化）:

```typescript
const KNOWN_TOOL_PARSER_DELIMITERS: Record<string, DelimiterPair> = {
  json_tools: { start: '<tool_call>', end: '</tool_call>' },
  pythonic: { start: '<|tool_call_start|>', end: '<|tool_call_end|>' },
  function_gemma: { start: '<start_function_call>', end: '<end_function_call>' },
  mistral: { start: '[TOOL_CALLS]', end: '' },
  kimi_k2: { start: '<|tool_calls_section_begin|>', end: '<|tool_calls_section_end|>' },
  longcat: { start: '<longcat_tool_call>', end: '</longcat_tool_call>' },
  glm47: { start: '<tool_call>', end: '</tool_call>' },
  qwen3_coder: { start: '<tool_call>', end: '</tool_call>' },
  minimax_m2: { start: '<minimax:tool_call>', end: '</minimax:tool_call>' },
  gemma4: { start: '<|tool_call>', end: '<tool_call|>' },
};
```

### content-parsers.ts

`ContentParser`インターフェースを実装した4つのパーサーを提供します：

#### jsonParser

標準JSON形式とその亜種に対応：

- `{"name": "func", "arguments": {...}}`
- `{"name": "func", "parameters": {...}}`（arguments別名）
- `{"function": {"name": "func", "arguments": {...}}}`（OpenAI型）
- `{"tool": {"name": "func", "arguments": {...}}}`（tool wrapping）
- 配列形式（複数ツール呼び出し）

#### gemma4Parser

Gemma4形式（`call:function_name{key:value}`）に対応：

```
call:search_api{query:"TypeScript tutorial",max_results:5}
```

- `<|"\|>` エスケープシーケンスをクォートに正規化
- キー・値のペアを順次パース（文字列、配列、オブジェクトをサポート）

#### pythonicParser

Python関数呼び出しライクな形式（`[function_name(key="value")]`）に対応：

```
[search_web(query="weather Tokyo", limit=3)]
```

- シングル/ダブルクォート対応
- 配列・オブジェクトのネスト対応

#### xmlParser

3種類のXMLベースフォーマットに対応：

**qwen3_coder形式**:
```xml
<function=search><parameter=query>Tokyo</parameter></function>
```

**minimax形式**:
```xml
<invoke name="search"><parameter name="query">Tokyo</parameter></invoke>
```

**MiniCPM5形式**:
```xml
<function name="search"><param name="query">Tokyo</param></function>
```

### index.ts

パースフローを実装した公開API：

```typescript
export function parseToolCalls(
  text: string,
  runtimeInfo: MlxRuntimeInfo | null
): ToolCallParseResult;
```

**パースフロー**（優先順）:

1. **デリミタベース検出**: `detect(runtimeInfo)` でデリミタペアを取得し、囲まれた部分を`tryParsers()`でパース
2. **マーカートークン検出**（Mistral型）: `[TOOL_CALLS]` 以降のテキストをJSONパース
3. **コードブロック検出**: ` ```json:toolCall ... ``` ` 形式を検出
4. **汎用フォールバック**: テキスト全体からJSON構造を抽出（`extractJsonObject()`）

### tool-formatter.ts

ツール定義をテキスト形式に変換する関数を提供：

```typescript
export function formatToolDefinitionsAsText(
  tools: ToolDefinition[]
): string;
```

一部のモデル（Gemma等）はチャットテンプレートでツール定義をテキスト埋め込みするため、この関数でJSON→テキスト変換を行います。

### utils.ts

共通ユーティリティ関数：

- `coerceValue(str: string)`: 文字列を適切な型（number、boolean、JSON等）に変換
- `extractBracketedValue(str: string, start: number)`: ブラケット `[]`/`{}` で囲まれた値を抽出
- `extractJsonObject(str: string, start: number)`: JSON構造を抽出
- `escapeRegExp(str: string)`: 正規表現エスケープ

## テスト構成

各モジュールは独自の単体テストを持ちます（計62テスト）：

- `detector.test.ts`: runtimeInfoからのデリミタ検出ロジック
- `content-parsers.test.ts`: 各ContentParserの動作検証（JSON/Gemma4/Pythonic/XML）
- `index.test.ts`: 統合テスト（パースフロー、フォールバック、エッジケース）
- `tool-formatter.test.ts`: ツール定義フォーマッタのテスト

## 新しいフォーマットへの対応方法

1. **ContentParserを実装**:

```typescript
// my-format-parser.ts
import type { ContentParser, ParsedToolCall } from './types.js';

export const myFormatParser: ContentParser = {
  name: 'my-format',
  parse(content: string): ParsedToolCall | null {
    // パースロジック
    return { name: 'func', arguments: {} };
  },
};
```

2. **defaultContentParsersに追加**:

```typescript
// content-parsers.ts
export const defaultContentParsers: ContentParser[] = [
  jsonParser,
  gemma4Parser,
  pythonicParser,
  xmlParser,
  myFormatParser,  // 追加
];
```

3. **デリミタが必要な場合はKNOWN_TOOL_PARSER_DELIMITERSに追加**:

```typescript
// detector.ts
const KNOWN_TOOL_PARSER_DELIMITERS: Record<string, DelimiterPair> = {
  // ...
  my_format: { start: '<my>', end: '</my>' },
};
```

4. **テストを作成**:

```typescript
// my-format-parser.test.ts
describe('myFormatParser', () => {
  it('should parse my format', () => {
    // テストケース
  });
});
```

## 関連ドキュメント

- [MLX - Qwen系モデル](./MLX_QWEN.md) - Qwen系モデルのツール呼び出し時のcontent挙動
- [Tools仕様](../TOOLS_SPEC.md) - Function Callingの仕様
- [Driver APIリファレンス](../DRIVER_API.md) - ドライバーAPI仕様
