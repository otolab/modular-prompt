# Moduler Prompt - AI Assistant Guide

AIアシスタントがコードベースを効率的に理解・操作するための統合ガイド。

## プロジェクト概要

プロンプトモジュールフレームワーク - 再利用可能なプロンプトコンポーネントをTypeScriptで構築。

## 主要ファイル

### コア実装
- `packages/core/src/types.ts` - 型定義（PromptModule、Element、DynamicContent）
- `packages/core/src/compile.ts` - モジュールのコンパイル処理
- `packages/core/src/merge.ts` - モジュールのマージ処理

### ドライバー
- `packages/driver/src/types.ts` - ドライバーインターフェース定義
- `packages/driver/src/*/` - 各AIサービス実装（openai、anthropic、vertexai、googlegenai、mlx等）

### ユーティリティ
- `packages/utils/src/driver-registry/` - ドライバーレジストリ実装
- `packages/utils/src/formatter/` - プロンプトフォーマッター

## 開発コマンド

```bash
# 依存関係のインストール（プロジェクトルートで実行）
npm install

# ビルド
npm run build

# クリーンビルド（エラー時に推奨）
npm run clean && npm run build

# 個別パッケージのビルド
npm run build -w @modular-prompt/core
npm run build -w @modular-prompt/driver
npm run build -w @modular-prompt/utils
npm run build -w @modular-prompt/process

# テスト
npm test

# 型チェック
npm run typecheck

# Lint
npm run lint

# トラブルシューティング
# - ビルドエラー時: npm run clean && npm install && npm run build
# - TypeScript参照エラー: 各パッケージで tsc --build を使用
# - 注意: npm run clean実行後は必ずnpm installが必要（node_modulesも削除されるため）
```

## 主要概念

### PromptModule
- 標準セクション（objective、instructions、state、materials等）
- DynamicContent - 実行時のコンテキストベース生成
- SimpleDynamicContent - SubSection専用の文字列生成

### Element階層
- 最大2階層：Section → SubSection → string
- 6種類の要素：Text、Message、Material、Chunk、Section、SubSection

### 処理フロー
1. モジュール定義 → 2. マージ（必要に応じて） → 3. コンパイル → 4. AIドライバーで実行

## コア機能

型定義、マージ、コンパイルの詳細は [プロンプトモジュール仕様](./docs/PROMPT_MODULE_SPEC.md) を参照してください。

### 概要

- **型定義** (`packages/core/src/types.ts`): PromptModule、Element（6種類）、DynamicContent
- **マージ** (`packages/core/src/merge.ts`): 複数モジュールの統合、サブセクション結合
- **コンパイル** (`packages/core/src/compile.ts`): モジュールからCompiledPromptへの変換

## 重要な制約とルール

### 階層構造
1. **最大2階層**: Section → SubSection → string
2. **Section内要素順序**: 通常要素 → サブセクション

### 動的コンテンツ制約
1. **DynamicContent**: Section/SubSectionを生成不可
2. **SimpleDynamicContent**: SubSection内専用、文字列のみ生成

### コンパイル時処理
1. **標準セクション自動変換**: 標準セクションはSectionElementに自動変換
2. **重複許容**: 意図的な重複（セパレータ等）をサポート

## 関連ドキュメント

詳細な仕様・ガイドは [docs/README.md](./docs/README.md) を参照してください。

主要ドキュメント:
- [プロンプトモジュール仕様](./docs/PROMPT_MODULE_SPEC.md)
- [はじめに](./docs/GETTING_STARTED.md)
- [ドライバーAPI](./docs/DRIVER_API.md)
- [AIサービスガイド](./docs/AI_SERVICE_GUIDE.md)

## パッケージ構成

### コアパッケージ
- `@modular-prompt/core` - コア機能
  - 型定義（PromptModule, Element, DynamicContent）
  - マージ機能（モジュール統合）
  - コンパイル機能（モジュール変換）

### ドライバーパッケージ
- `@modular-prompt/driver` - AIモデルドライバー
  - OpenAI、Anthropic、VertexAI、GoogleGenAI、Ollama、MLX
  - 統一インターフェースとストリーミングサポート
  - StreamResult型: stream（AsyncIterable<string>）+ result（Promise<QueryResult>）

### ユーティリティパッケージ
- `@modular-prompt/utils` - ユーティリティ機能
  - ドライバーレジストリ（動的ドライバー選択）
  - フォーマッター（テキスト/メッセージ形式変換）

### 処理パッケージ
- `@modular-prompt/process` - ストリーム処理
  - マテリアル管理モジュール
  - チャンク処理モジュール

## ドライバーアーキテクチャ

利用可能なドライバー: OpenAI、Anthropic、VertexAI、GoogleGenAI、Ollama、MLX、Test

詳細は [ドライバーAPI](./docs/DRIVER_API.md) および [AIサービスガイド](./docs/AI_SERVICE_GUIDE.md) を参照してください。

### 共通インターフェース (AIDriver)
- `query`: 通常クエリ実行
- `streamQuery`: ストリーミングクエリ
- `close`: リソースクリーンアップ

## テスト構成
- ユニットテスト：`*.test.ts`（実装と同階層）
- 統合テスト：`integration.test.ts`
- E2Eテスト：`simple-chat/src/*.e2e.test.ts`

## CI/CD
- GitHub Actions：`.github/workflows/ci.yml`
- Node.js 20.x、自動テスト実行

---

使用例やより詳細な仕様は [プロンプトモジュール仕様](./docs/PROMPT_MODULE_SPEC.md) および [はじめに](./docs/GETTING_STARTED.md) を参照してください。