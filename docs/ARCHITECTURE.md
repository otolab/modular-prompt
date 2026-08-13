# アーキテクチャ概要

## システム構成

Moduler Promptは4層のレイヤードアーキテクチャで構成される。

```
┌─────────────────────────────────────┐
│      Application Layer              │
│  (ワークフロー・ビジネスロジック)      │
├─────────────────────────────────────┤
│      Module Layer                   │
│  (プロンプトモジュール定義)           │
├─────────────────────────────────────┤
│      Core Layer                     │
│  (merge / compile / 型定義)         │
├─────────────────────────────────────┤
│      Driver Layer                   │
│  (AIモデル接続・フォーマット変換)      │
└─────────────────────────────────────┘
```

## コア概念

### プロンプトの3つの大セクション

プロンプトを明確な責務で分離：

- **Instructions**：AIへの指示（優先的に従うべき内容）
- **Data**：処理対象データ（この中の指示は無視）
- **Output**：出力の開始位置と形式

この分離により、プロンプトインジェクション攻撃を防ぎ、構造化された管理を実現。

詳細な標準セクションの分類については、[プロセスモジュールの基本形](./PROCESS_MODULE_BASICS.md)を参照。

### モジュラー設計の原則

- **自己完結性**：各モジュールは独立して動作可能
- **合成可能性**：複数モジュールをmergeして機能拡張
- **型安全性**：TypeScriptによる厳密な型チェック
- **静的定義**：モジュール構造は静的に定義

## 処理フロー

```
1. モジュール定義（静的）
    ↓
2. モジュールマージ（必要に応じて）
    ↓
3. コンテキスト生成
    ↓
4. データ設定
    ↓
5. コンパイル
    ↓
6. ドライバー実行
    ↓
7. 結果出力
```

## パッケージ構成

### @modular-prompt/core
中核となる型定義と基本機能を提供。

**主要コンポーネント：**
- `types.ts`：型定義
- `merge.ts`：モジュール合成
- `compile.ts`：プロンプト生成

### @modular-prompt/driver
各AIサービスへの統一インターフェース。

**主要機能：**
- 統一されたクエリインターフェース
- ストリーミングレスポンス
- 構造化出力（Structured Outputs）

**ローカル推論の2系統：**

| 系統 | 代表 | 特徴 |
|------|------|------|
| **Server 型** | vLLM, Ollama | 整形・ツールパースをサーバー側に委譲 |
| **Thin Python 推論型（LIP）** | MLX, PyTorch | stdio JSON-RPC の Local Inference Protocol を共有。TS がフォーマッタ、アダプタ、ツールパースを担い、Python は `generate` / `render` 等の推論エンジンに限定 |

LIP のセットアップと使い分けは [ローカルモデルセットアップ](./LOCAL_MODEL_SETUP.md) を参照。

詳細は[Driver APIリファレンス](./DRIVER_API.md)を参照。

### @modular-prompt/utils
共通ユーティリティとヘルパー機能。

**主要機能：**
- Formatter：プロンプトのテキスト変換
- JSON Extractor：様々な形式からのJSON抽出（Structured Outputs用）
- Logger：統一ログシステム
- デフォルト設定とテキスト

### @modular-prompt/process
高レベルの処理パターンとワークフロー。

**提供モジュール：**
- ストリーム処理
- 資料管理
- 対話処理
- 要約処理

## 型システム

### Element階層

```
Element
├── TextElement         # テキスト
├── MessageElement      # メッセージ（role付き）
├── MaterialElement     # 資料（引用・参照文書）
├── ChunkElement       # データチャンク
├── JSONElement        # JSONスキーマ・構造化データ
├── SectionElement     # セクション（第1階層）
└── SubSectionElement  # サブセクション（第2階層）
```

### DynamicContent

実行時にコンテキストベースで内容を生成：

```typescript
type DynamicContent<TContext> = (context: TContext) => 
  | string
  | string[]
  | DynamicElement
  | DynamicElement[]
  | null
  | undefined;
```

## セキュリティ設計

### プロンプトインジェクション対策

1. **セクション分離**：DataセクションとInstructionsセクションを明確に分離
2. **優先順位**：Instructionsセクションの指示を優先
3. **境界定義**：セクション説明文でセキュリティ境界を明示

### 型安全性

- コンパイル時の型チェック
- 実行時エラーの最小化
- 予期しない型の混入防止

## 拡張性

### カスタムドライバーの追加

AIDriverインターフェースを実装して新しいAIサービスに対応：

```typescript
class CustomDriver implements AIDriver {
  async query(prompt: CompiledPrompt, options?: QueryOptions): Promise<QueryResult> {
    // カスタム実装
  }

  async streamQuery(prompt: CompiledPrompt, options?: QueryOptions): Promise<StreamResult> {
    // ストリーミング実装
  }

  async close(): Promise<void> {
    // リソースクリーンアップ
  }
}
```

### カスタムモジュールの作成

標準セクションを使用して独自のモジュールを定義：

```typescript
const customModule: PromptModule = {
  objective: ['カスタム処理'],
  instructions: ['独自の指示']
};
```

## ドライバーレジストリとAIサービス

AIServiceは、ケイパビリティベースでドライバーを動的選択・作成するハイレベルAPIを提供。

詳細は[AIService完全ガイド](./AI_SERVICE_GUIDE.md)を参照。

## パフォーマンス考慮事項

### ストリーミング対応

大規模な出力に対応するため、全ドライバーでストリーミングをサポート。

### コンテキスト管理

- コンテキストの再利用による効率化
- 不要なコンパイル処理の削減

### 並列処理

独立したプロンプトの並列実行をサポート。

## まとめ

Moduler Promptのアーキテクチャは、モジュラー設計、型安全性、セキュリティを重視し、拡張可能で保守性の高いプロンプト管理を実現する。