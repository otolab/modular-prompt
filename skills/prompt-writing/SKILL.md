---
name: prompt-writing
description: modular-promptでPromptModuleを正しく記述するためのガイド。プロンプトの構造設計、セクション分類、DynamicContent、マージ・コンパイルの制約を参照する。
---

# PromptModule 記述ガイド

## Modular Prompt とは

modular-prompt（`@modular-prompt/core`）は、AIへのプロンプトを**再利用可能なモジュール**として構築・管理するTypeScriptフレームワーク。

### 解決する課題

- **プロンプトの複雑化** - 長大なプロンプトを構造化された部品に分解し、組み合わせて使う
- **指示とデータの混在** - セクション分類により、ユーザー入力に含まれる意図しない指示の実行を防ぐ（プロンプトインジェクション対策）
- **静的テンプレートと動的データの分離** - モジュール（What）とコンテキスト（With What）を分け、テスト・再利用を容易にする
- **AIモデルの差異** - ドライバー層が各社API（OpenAI、Anthropic、Google等）の差異を吸収し、統一インターフェースで実行

### 処理フロー

```
モジュール定義 → マージ（任意） → コンパイル → ドライバー実行
```

1. **モジュール定義**: PromptModuleとして標準セクションに内容を記述
2. **マージ**: 複数モジュールを `merge()` で統合（必要に応じて）
3. **コンパイル**: `compile()` でDynamicContentを評価し、静的なCompiledPromptに変換
4. **ドライバー実行**: AIDriverが各モデルのAPI形式に変換して実行

## セクション構造

PromptModuleは標準セクションで構成される。各セクションは3つのカテゴリに分類される。

### Instructions系（AIへの指示）
- `objective` - 目的・ゴール
- `terms` - 用語定義
- `methodology` - 方法論（ワークフロー定義）
- `instructions` - 具体的な指示
- `guidelines` - ガイドライン
- `preparationNote` - 準備メモ（事前調査内容など）

### Data系（処理対象データ）
- `state` - 現在の状態
- `materials` - 資料
- `inputs` - 入力データ
- `chunks` - データチャンク
- `messages` - メッセージ履歴

### Output系（出力形式）
- `schema` - 出力スキーマ
- `cue` - 出力開始の合図

**補足**: Instructions系とData系を分離することで、プロンプトインジェクション防止の仕組みが組み込まれている。

## セクションの書き方

各セクションは `SectionContent<TContext>` 型の配列:

```typescript
const module: PromptModule = {
  objective: [
    '与えられた質問に対して正確に回答する'
  ],
  instructions: [
    '- 日本語で回答すること',
    '- 根拠を明示すること',
    {
      type: 'subsection',
      title: '回答フォーマット',
      items: [
        '- まず結論を述べる',
        '- 次に根拠を箇条書きで示す'
      ]
    }
  ]
};
```

## コンテキスト（TContext と createContext）

PromptModuleの型パラメータ `TContext` は、DynamicContentが受け取るデータの型を定義する。`createContext` はデフォルト値を生成する関数。

### 基本パターン

```typescript
// コンテキストなし（静的モジュール）
const staticModule: PromptModule = {
  objective: ['質問に回答する']
};

// コンテキストあり（動的モジュール）
type MyContext = {
  userName: string;
  items: string[];
};

const dynamicModule: PromptModule<MyContext> = {
  createContext: () => ({
    userName: '',
    items: []
  }),
  objective: [
    (ctx) => `${ctx.userName}の質問に回答する`
  ],
  state: [
    (ctx) => ctx.items.map(item => `- ${item}`)
  ]
};
```

### コンテキストの利用

```typescript
import { compile, createContext } from '@modular-prompt/core';

// createContext() でデフォルト値を取得し、必要なフィールドだけ上書き
const ctx = createContext(dynamicModule);
ctx.userName = '田中';
ctx.items = ['項目A', '項目B'];
const compiled = compile(dynamicModule, ctx);

// 直接渡すことも可能
const compiled2 = compile(dynamicModule, {
  userName: '佐藤',
  items: ['項目C']
});

// context省略時は createContext() のデフォルト値が使われる
const compiled3 = compile(dynamicModule);
```

### マージ時のコンテキスト

複数モジュールをマージすると、コンテキスト型は交差型（`&`）になる。各 `createContext` の結果はオブジェクトマージされる（後勝ち）。

```typescript
const base: PromptModule<{ lang: string }> = {
  createContext: () => ({ lang: 'ja' }),
  instructions: [(ctx) => `言語: ${ctx.lang}`]
};

const ext: PromptModule<{ verbose: boolean }> = {
  createContext: () => ({ verbose: false }),
  guidelines: [(ctx) => ctx.verbose ? '詳細に回答する' : null]
};

// merged の型は PromptModule<{ lang: string } & { verbose: boolean }>
const merged = merge(base, ext);
```

## Element階層（最大2階層）

```
Section (第1階層)
  ├─ string（直接テキスト）
  ├─ DynamicContent（動的コンテンツ）
  └─ SubSection (第2階層)
       ├─ string
       └─ SimpleDynamicContent
```

**制約: SubSectionの入れ子は不可。**

### SectionElement

```typescript
{
  type: 'section',
  title: 'セクション名',
  items: ['テキスト', subSectionElement, ...]
}
```

### SubSectionElement

```typescript
{
  type: 'subsection',
  title: 'サブセクション名',
  items: ['テキスト1', 'テキスト2', simpleDynamicContent]
}
```

### その他のElement型

```typescript
// テキスト要素
{ type: 'text', content: 'テキスト内容' }

// メッセージ要素（role付き）
{ type: 'message', role: 'user', content: 'ユーザー入力' }

// 資料要素
{ type: 'material', id: 'doc-1', title: '参考資料', content: '...' }

// チャンク要素
{ type: 'chunk', partOf: 'document', index: 0, total: 3, content: '...' }

// JSONスキーマ要素
{ type: 'json', schema: { ... } }
```

## DynamicContent（動的コンテンツ）

実行時にコンテキストから内容を生成する関数。

```typescript
const module: PromptModule<{ items: string[] }> = {
  createContext: () => ({ items: [] }),
  state: [
    // 文字列を返す
    (ctx) => `アイテム数: ${ctx.items.length}`,

    // 文字列配列を返す（展開される）
    (ctx) => ctx.items.map(item => `- ${item}`),

    // 条件付き（不要なら null）
    (ctx) => ctx.items.length > 0 ? '処理対象あり' : null,

    // Elementを返す
    (ctx) => ({
      type: 'material',
      id: 'data',
      title: 'Input Data',
      content: ctx.items.join('\n')
    })
  ]
};
```

**DynamicContentの制約:**
- Section / SubSection は生成不可（静的構造のみ）
- 返せるもの: `string | string[] | DynamicElement | DynamicElement[] | null | undefined`

## SimpleDynamicContent（SubSection専用）

SubSectionの `items` 内で使う簡易版。文字列のみ生成可能。

```typescript
{
  type: 'subsection',
  title: 'ルール',
  items: [
    '基本ルール:',
    (ctx) => ctx.rules,                    // string[] を返す
    (ctx) => ctx.extra ? '追加ルールあり' : null  // 条件付き
  ]
}
```

**SimpleDynamicContentの制約:**
- Elementは生成不可（文字列 / 文字列配列のみ）

## マージ（merge）

複数モジュールを1つに統合する。

```typescript
import { merge } from '@modular-prompt/core';

const merged = merge(baseModule, extensionModule);
```

### マージルール

- 同じセクションの内容は配列として結合される
- 同名SubSectionの `items` はマージされる
- `createContext` は全て実行され、結果がオブジェクトマージされる（後勝ち）
- コンパイル後のセクション内順序: 通常要素 → SubSection

## 箇条書きスタイル

- 一行の指示項目には `- ` を先頭に付けて箇条書きにする
- 長い説明文や段落的な内容には箇条書き記号を付けない
- AIが指示を明確に識別しやすくなる
