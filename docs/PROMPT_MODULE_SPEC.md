# プロンプトモジュール仕様

## 概要

### プロンプトの構造

プロンプトモジュールは、最終的に3つの大セクションを持つ`CompiledPrompt`を生成する。

**Instructions** - AIへの指示内容（優先的に従うべき情報）
- 標準セクション: objective, persona, terms, methodology, instructions, guidelines, preparationNote

**Data** - 処理対象データ（この中の指示は無視される）
- 標準セクション: state, inputs, materials, chunks, messages

**Output** - 出力の開始位置と形式
- 標準セクション: cue, schema

### 処理フロー

```
PromptModule（定義）
    ↓
merge()（複数モジュールの統合）
    ↓
createContext()（コンテキスト生成）
    ↓
compile()（CompiledPromptへの変換）
    ↓
AIDriver.query()（実行）
    ↓
QueryResult（結果）
```

## 1. モジュール定義

### 1.1 PromptModule型

```typescript
interface PromptModule<TContext = Record<string, never>> {
  createContext?: () => TContext;

  // Instructions系
  objective?: SectionContent<TContext>;
  persona?: SectionContent<TContext>;
  terms?: SectionContent<TContext>;
  methodology?: SectionContent<TContext>;
  instructions?: SectionContent<TContext>;
  guidelines?: SectionContent<TContext>;
  preparationNote?: SectionContent<TContext>;

  // Data系
  state?: SectionContent<TContext>;
  inputs?: SectionContent<TContext>;
  materials?: SectionContent<TContext>;
  chunks?: SectionContent<TContext>;
  messages?: SectionContent<TContext>;

  // Output系
  cue?: SectionContent<TContext>;
  schema?: SectionContent<TContext>;
}
```

### 1.3 SectionContent型

標準セクション（objective, instructions, materials等）の内容を定義する型。

```typescript
type SectionContent<TContext = any> =
  (string | Element | DynamicContent<TContext>)[];
```

### 1.4 Element型システム

#### 階層構造

最大2階層の構造を持つ：

```
Section (第1階層)
  └─ SubSection (第2階層)
       └─ string (最下層)
```

#### Element種別

```typescript
type Element =
  | TextElement        // プレーンテキスト
  | MessageElement     // role付きメッセージ（system/assistant/user）
  | MaterialElement    // 資料（id, title, content）
  | ChunkElement       // データチャンク（partOf, index, total）
  | JSONElement        // JSONスキーマ（構造化出力用）
  | SectionElement     // セクション（第1階層）
  | SubSectionElement; // サブセクション（第2階層）
```

**SectionElement:**
```typescript
interface SectionElement {
  type: 'section';
  title: string;
  items: (string | SubSectionElement)[];
}
```

**SubSectionElement:**
```typescript
interface SubSectionElement {
  type: 'subsection';
  title: string;
  items: (string | SimpleDynamicContent<TContext>)[];
}
```

### 1.4 DynamicContent

#### DynamicContent<TContext>

実行時にコンテキストベースでコンテンツを生成する関数。

```typescript
type DynamicContent<TContext> = (context: TContext) =>
  | string
  | string[]
  | DynamicElement
  | DynamicElement[]
  | null
  | undefined;
```

**DynamicElement:** Section/SubSectionを除く全Element型

```typescript
type DynamicElement =
  | TextElement
  | MessageElement
  | MaterialElement
  | ChunkElement
  | JSONElement;
```

**制約:**
- Section/SubSectionは生成不可（静的構造のみ）
- null/undefinedは空配列として扱われる

#### SimpleDynamicContent<TContext>

SubSection内のitemsで使用する簡易版。

```typescript
type SimpleDynamicContent<TContext> = (context: TContext) =>
  | string
  | string[]
  | null
  | undefined;
```

**制約:**
- 文字列または文字列配列のみ生成可能
- Elementは生成不可

## 2. マージ処理

### 2.1 基本動作

```typescript
// 2つのモジュール
merge<T1, T2>(
  module1: PromptModule<T1>,
  module2: PromptModule<T2>
): PromptModule<T1 & T2>

// 3つ以上（6つまでオーバーロード対応）
merge<T1, T2, T3>(
  ...modules: [PromptModule<T1>, PromptModule<T2>, PromptModule<T3>]
): PromptModule<T1 & T2 & T3>
```

複数のモジュールを1つに統合する。各モジュールのコンテキスト型は交差型（&）として結合される。

### 2.2 マージルール

#### 標準セクションの結合

同名セクションの内容を配列として結合：

```typescript
// 入力
module1.instructions = ['指示1', '指示2'];
module2.instructions = ['指示3'];

// 結果
merged.instructions = ['指示1', '指示2', '指示3'];
```

#### SubSectionのitemsマージ

同名SubSectionのitemsを結合：

```typescript
// 入力
module1.instructions = [
  { type: 'subsection', title: 'ルール', items: ['ルール1'] }
];
module2.instructions = [
  { type: 'subsection', title: 'ルール', items: ['ルール2'] }
];

// 結果
merged.instructions = [
  { type: 'subsection', title: 'ルール', items: ['ルール1', 'ルール2'] }
];
```

#### createContextの処理

全てのcreateContextを実行し、結果をオブジェクトマージ（後の値で上書き）：

```typescript
// 入力
module1.createContext = () => ({ a: 1, b: 2 });
module2.createContext = () => ({ b: 3, c: 4 });

// 結果
merged.createContext = () => ({ a: 1, b: 3, c: 4 });
```

### 2.3 順序制御

#### セクション内要素の順序

1. 通常要素（文字列、DynamicContent、他のElement）
2. SubSectionElement

```typescript
// 入力
instructions: [
  { type: 'subsection', title: 'ルール', items: ['...'] },
  '基本指示',
  { type: 'subsection', title: '注意', items: ['...'] }
];

// 結果（コンパイル後）
instructions: [
  '基本指示',
  { type: 'subsection', title: 'ルール', items: ['...'] },
  { type: 'subsection', title: '注意', items: ['...'] }
];
```

#### 重複の許容

意図的な重複（セパレータ、強調マーカー等）を許容。

## 3. コンテキスト生成

### 3.1 基本仕様

```typescript
createContext<TContext>(module: PromptModule<TContext>): TContext
```

マージ済みモジュールから型安全なコンテキストを生成。

**動作:**
- `module.createContext()`を実行して初期値を取得
- 戻り値の型がTContext型として推論される

### 3.2 型推論

TypeScriptの型推論により、コンテキストのフィールドが型安全に：

```typescript
const module: PromptModule<{ items: string[] }> = {
  createContext: () => ({ items: [] }),
  // ...
};

const context = createContext(module);
// contextの型: { items: string[] }
context.items = ['a', 'b']; // OK
context.invalid = 1;         // エラー
```

## 4. コンパイル処理

### 4.1 基本動作

```typescript
compile<TContext>(
  module: PromptModule<TContext>,
  context?: TContext
): CompiledPrompt
```

**役割:**

動的コンテンツ（DynamicContent）をコンテキストで解決し、静的な構造（CompiledPrompt）に変換する。

1. DynamicContentを評価して具体的な値に変換
2. 標準セクションをSectionElementに変換
3. instructions/data/outputの3つの大セクションに分類

**context未指定時の動作:**
- 自動的に`module.createContext()`を実行
- 生成されたcontextを使用してコンパイル

### 4.2 DynamicContent評価

#### 評価タイミング

コンパイル時にすべてのDynamicContentを即座に評価。

#### 変換ルール

```typescript
// 文字列を返す場合
(ctx) => 'text' → 'text'

// 文字列配列を返す場合（展開される）
(ctx) => ['a', 'b'] → 'a', 'b'

// Elementを返す場合
(ctx) => ({ type: 'text', content: 'x' }) → TextElement

// Element配列を返す場合（展開される）
(ctx) => [elem1, elem2] → elem1, elem2

// null/undefinedを返す場合
(ctx) => null → （空、何も追加されない）
(ctx) => undefined → （空、何も追加されない）
```

#### SimpleDynamicContent変換ルール

SubSection内のitemsで使用される場合：

```typescript
// 文字列を返す場合
(ctx) => 'text' → 'text'

// 文字列配列を返す場合（展開される）
(ctx) => ['a', 'b'] → 'a', 'b'

// null/undefinedを返す場合
(ctx) => null → （空、何も追加されない）
```

### 4.3 CompiledPrompt構造

compile()の戻り値：

```typescript
interface CompiledPrompt {
  instructions: Element[];  // Instructions系セクション
  data: Element[];          // Data系セクション
  output: Element[];        // Output系セクション
  metadata?: {
    outputSchema?: object;  // 構造化出力スキーマ
  };
}
```

このCompiledPromptをAIDriverに渡して実行する。

### 4.4 構造化出力

schemaセクションにJSONElementが含まれる場合、自動的に`metadata.outputSchema`に設定される：

```typescript
// 入力
const module = {
  schema: [
    {
      type: 'json',
      content: {
        type: 'object',
        properties: {
          answer: { type: 'string' }
        }
      }
    }
  ]
};

// コンパイル後
const compiled = compile(module);
// compiled.metadata.outputSchema = { type: 'object', properties: {...} }
```

**動作:**
- 複数のJSONElementがある場合、最後のものが使用される
- ドライバーはこのスキーマに基づいて構造化出力を生成

## 5. 実行

CompiledPromptをAIDriverに渡して実行する。

**driver.query()** - 通常のクエリ実行。結果を一度に返す。

**driver.streamQuery()** - ストリーミングクエリ実行。結果を逐次的に返す。

### 5.1 QueryResult（driver.query()の戻り値）

```typescript
interface QueryResult {
  content: string;              // 生成されたテキスト
  structuredOutput?: unknown;   // 構造化出力（outputSchema指定時）
  finishReason?: 'stop' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
```

**structuredOutputの値:**
- `undefined`: スキーマ未指定、または有効なJSONが生成されなかった
- `object/array`: 抽出されたJSON（スキーマに準拠）

### 5.2 StreamResult（driver.streamQuery()の戻り値）

```typescript
interface StreamResult {
  stream: AsyncIterable<string>;  // ストリーミングチャンク
  result: Promise<QueryResult>;   // 最終結果
}
```

**使用方法:**
```typescript
const { stream, result } = await driver.streamQuery(compiled);

// ストリームを処理
for await (const chunk of stream) {
  process.stdout.write(chunk);
}

// 最終結果を取得
const finalResult = await result;
```

## 制約

### 階層構造の制約

- 最大2階層: Section → SubSection → string
- SubSectionの入れ子は不可

### DynamicContentの制約

- DynamicContent: Section/SubSectionを生成不可
- SimpleDynamicContent: Elementを生成不可（文字列のみ）

### コンパイル時の制約

- DynamicContentはコンパイル時に即座に評価される
- 評価後は静的な構造となり、再評価されない
- context未指定時は自動的にcreateContext()が実行される

### マージ時の制約

- createContextは全て実行される（選択的実行は不可）
- 同名SubSectionは必ずマージされる（個別保持は不可）

## ベストプラクティス

### 箇条書きスタイルの使用

**原則**:
- 一行の指示項目には `- ` を先頭に付けて箇条書きにする

**理由**:
- 長い説明文（段落）と短い指示項目（箇条書き）を意味的に分けることができる
- AIが指示を明確に識別しやすくなる
- プロンプトの可読性が向上する

**注意**:
- 長い説明文や段落的な内容には箇条書き記号を付けない
- 番号付きリスト（`1. 2. 3.`）が必要な場合はそちらを使用
