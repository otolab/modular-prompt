# Moduler Prompt ドキュメント

Moduler Promptのドキュメント集へようこそ。このディレクトリには、フレームワークの仕様、使い方、設計思想に関する包括的なドキュメントが含まれています。

## はじめに

### すぐに始める

- **[はじめに](./GETTING_STARTED.md)** - インストール、環境設定、プロセスモジュールの使い方

### 全体像を理解する

- **[コンセプト](./CONCEPTS.md)** - 解決しようとしている課題とアプローチ
- **[アーキテクチャ](./ARCHITECTURE.md)** - システム構成と4層のレイヤードアーキテクチャ

## 仕様

### プロンプトモジュール

- **[プロンプトモジュール仕様](./PROMPT_MODULE_SPEC.md)** - プロンプトモジュールの完全な仕様

## ドライバー

### AIモデルとの接続

- **[Driver APIリファレンス](./DRIVER_API.md)** - `@modular-prompt/driver`パッケージのAPIリファレンス
- **[ローカルモデルセットアップガイド](./LOCAL_MODEL_SETUP.md)** - MLXとOllamaのセットアップとモデルダウンロード
- **[AIService 完全ガイド](./AI_SERVICE_GUIDE.md)** - 動的なAIドライバー選択と管理
- **[Structured Outputs仕様](./STRUCTURED_OUTPUTS.md)** - 構造化出力の仕様と実装ガイド
- **[テスト用ドライバーガイド](./TEST_DRIVERS.md)** - TestDriverとEchoDriverの使い方
- **[Formatter仕様](./FORMATTER_SPEC.md)** - CompiledPromptのレンダリング仕様とFormatterOptions

### モデル固有の挙動

- **[MLX - Qwen系モデル](./models/MLX_QWEN.md)** - Qwen系モデルのtool call時のcontent挙動

## プロセスモジュール

### ワークフロー処理のための再利用可能モジュール

- **[プロセスモジュールガイド](./PROCESS_MODULE_GUIDE.md)** - プロセスモジュールの実装ガイドライン
  - 標準セクションとContextフィールドの使い方
  - 実装フロー（Context定義、モジュール定義、ワークフロー関数）
  - 典型的なフィールド構造と責任分担
- **[ワークフローログ規約](../packages/process/docs/WORKFLOW_LOG_CONVENTIONS.md)** - ワークフロー実装者向けLogger使用規約
  - context 命名規則
  - メッセージ prefix 規則
  - ログレベルの使い分け

### マルチエージェント設計思想

- **[マルチエージェントプランニングパターン](./MULTI_AGENT_PLANNING_PATTERNS.md)** - タスク分解とアーキテクチャ設計のベストプラクティス
  - Plan-and-Execute、Hierarchical、Sequential/SOP駆動、Debate/Adversarialの4パターン
  - AutoGen、MetaGPT、CrewAIのプラン自動生成機能の内部構造
  - ACONICフレームワークによる科学的タスク分解アプローチ
  - プロンプト設計とクオリティゲートの実装指針

## ユーティリティ

### 共通機能

- **[Utilities](./UTILITIES.md)** - `@modular-prompt/utils`パッケージ
  - ドライバレジストリ
  - ログシステム

## テストと検証

### 品質保証

- **[テスト戦略と指針](./TESTING_STRATEGY.md)** - テストの分類、実装指針、品質基準
- **[プロンプト検証テクニック](./PROMPT_VALIDATION_TECHNIQUES.md)** - プロンプト設計の検証手法

## ツール機能

### Function Calling

- **[Tools仕様](./TOOLS_SPEC.md)** - Function Callingの仕様と実装ガイド

## プロジェクト管理

### ドキュメント管理

- **[ドキュメント戦略](./DOCUMENT_STRATEGY.md)** - ドキュメント分類・配置ルール・ライフサイクル管理

---

## ドキュメントの読み方

### 初めての方

1. [はじめに](./GETTING_STARTED.md)でインストールと基本的な使い方を学ぶ
2. [コンセプト](./CONCEPTS.md)でフレームワークの目的を理解
3. [プロセスモジュールガイド](./PROCESS_MODULE_GUIDE.md)で詳細を学ぶ

### モジュール開発者

- プロセスモジュール: [プロセスモジュールガイド](./PROCESS_MODULE_GUIDE.md)
- 仕様を理解: [プロンプトモジュール仕様](./PROMPT_MODULE_SPEC.md)
- マルチエージェント設計: [マルチエージェントプランニングパターン](./MULTI_AGENT_PLANNING_PATTERNS.md)

### ドライバー実装者

1. [Driver APIリファレンス](./DRIVER_API.md)でインターフェースを確認
2. [Structured Outputs仕様](./STRUCTURED_OUTPUTS.md)で構造化出力を実装
3. [テスト用ドライバーガイド](./TEST_DRIVERS.md)を参考にテストを作成
4. [モデル固有の挙動](./models/)で使用するモデルの特性を確認

### アーキテクト

- [アーキテクチャ](./ARCHITECTURE.md) - システム全体の設計
- [マルチエージェントプランニングパターン](./MULTI_AGENT_PLANNING_PATTERNS.md) - マルチエージェントシステムの設計指針
- [AIService 完全ガイド](./AI_SERVICE_GUIDE.md) - 動的ドライバー選択の仕組み
- [テスト戦略と指針](./TESTING_STRATEGY.md) - 品質保証の方針
