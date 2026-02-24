# @modular-prompt/core

プロンプトモジュールフレームワークのコアパッケージ。

## 📚 ドキュメント

詳細は[ドキュメント](https://github.com/otolab/modular-prompt/tree/main/docs)を参照してください。

## インストール

```bash
npm install @modular-prompt/core
```

## 基本的な使用方法

```typescript
import { compile, merge, createContext } from '@modular-prompt/core';
import type { PromptModule } from '@modular-prompt/core';

// Context型定義
interface MyContext {
  inputs?: string;
}

// プロセスモジュール（処理方法を定義）
const processModule: PromptModule<MyContext> = {
  methodology: ['データを処理する'],
  inputs: [(ctx) => ctx.inputs || '']
};

// ユーザーモジュール（タスクを定義）
const userModule = {
  objective: ['タスクの目的'],
  instructions: ['具体的な指示']
};

// マージしてContextを取得
const merged = merge(processModule, userModule);
const context = createContext(merged);
context.inputs = 'データ';

// コンパイル
const compiled = compile(merged, context);
// compiled: CompiledPrompt
// {
//   instructions: SectionElement[]  // 指示セクション群
//   data: SectionElement[]          // データセクション群
//   output: SectionElement[]        // 出力セクション群
//   metadata?: { outputSchema }     // メタデータ
// }
```

## 主要な機能

- **PromptModule**: 再利用可能なプロンプトテンプレート
- **compile**: モジュールを実行可能な形式に変換
- **merge**: 複数のモジュールを合成
- **createContext**: マージ済みモジュールから型安全なContextを取得

## Skills（Claude Code向け）

このパッケージには `skills/prompt-writing/SKILL.md` が同梱されています。Claude Codeのスキルとして利用でき、プロンプトモジュールの書き方をガイドします。

## ライセンス

MIT