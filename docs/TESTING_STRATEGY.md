# テスト戦略と指針

## 概要

Moduler Promptプロジェクトにおけるテストの分類、実装指針、品質基準を定義します。
ドキュメント・コード・テストの三位一体同期管理を基本とし、各レベルのテストが適切に実装され、維持されることを保証します。

## テストの分類

### 1. ユニットテスト (Unit Tests)

**定義**: 単一のモジュール、クラス、関数の振る舞いを検証。外部依存はすべてモック。

**対象例**:
- パラメータバリデーション関数
- 型変換ユーティリティ
- プロンプトフォーマッター
- キュー管理ロジック
- ドライバーのAPIレスポンス変換（モック使用）

**配置**:
```
packages/*/src/**/*.test.ts
packages/*/src/**/*.spec.ts
```

**実行コマンド**:
```bash
npm test                    # 全パッケージのユニットテスト
npm test -w @modular-prompt/driver  # 特定パッケージのみ
```

### 2. 統合テスト (Integration Tests)

**定義**: 複数モジュール間の相互作用、および外部システム（API、モデルプロセス等）との接続を検証

**対象例**:
- ドライバーとプロセス間の通信
- パラメータマッピングとバリデーションの連携
- プロンプトモジュールの組み合わせ
- OpenAI/Anthropic/VertexAI APIとの実通信
- MLXモデルの実際のロードと推論
- ドライバーの公開APIの動作検証（query, streamQuery, close）

**配置**:
```
packages/*/test/integration/**/*.test.ts
packages/*/src/**/*.integration.test.ts
```

**実行コマンド**:
```bash
npm run test:integration    # 統合テスト実行
```

**備考**: 外部API・モデルに依存するテストは設定ファイル（`test-drivers.yaml`等）がない場合にスキップされる。

### 3. E2Eテスト (End-to-End Tests)

**定義**: ユーザー視点でシステム全体の動作を検証

**対象例**:
- simple-chatアプリケーションの完全なフロー
- 複数ドライバーの切り替え
- エラーハンドリングとリカバリー

**配置**:
```
packages/*/src/**/*.e2e.test.ts
test/e2e/**/*.test.ts
```

## パッケージ固有のテスト戦略

### @modular-prompt/process

processパッケージは、プロンプトモジュールとワークフローの実行を担当します。そのテスト戦略は以下の2層構成です。

#### 1. モジュール単体テスト（Driver不使用）

プロンプトモジュールの純粋なロジックを検証します。

##### 基本的なモジュールテスト

```typescript
// material.test.ts の例
it('材料がある場合はmaterialセクションを生成', () => {
  const context: MaterialContext = {
    materials: [{ id: 'doc1', title: 'Document 1', content: '...' }]
  };
  const result = compile(withMaterials, context);
  expect(result.data).toBeDefined();
});
```

##### プロンプト構造検証テスト

```typescript
// prompt-inspection.test.ts の例
it('should include planning requirements and user inputs', () => {
  const planningContext: AgenticWorkflowContext = {
    objective: '文書を分析し、重要な洞察を抽出する',
    inputs: { document: 'サンプルドキュメントの内容...' }
  };

  const mergedPlanning = merge(planning, userModule);
  const planningPrompt = compile(mergedPlanning, planningContext);

  const instructionText = collectText(planningPrompt.instructions);
  expect(instructionText).toContain('Planning Requirements');
  expect(instructionText).toContain('Respond ONLY with valid JSON text');
});
```

**特徴**:
- 高速・決定的
- `compile()`の結果を検証
- AIモデル不要
- プロンプト構造や期待される文言を詳細に検証可能

#### 2. ワークフロー機能テスト（TestDriver使用）

ワークフロー全体の動作を、モックレスポンスで検証します。

```typescript
// agent-workflow.test.ts の例
it('executes planning, execution, and integration phases', async () => {
  const plan = {
    steps: [
      { id: 'step-1', description: 'Collect the required facts' },
      { id: 'step-2', description: 'Summarize the findings' }
    ]
  };

  const driver = new TestDriver({
    responses: [
      JSON.stringify(plan),  // Planning
      'step 1 result',        // Execution
      'step 2 result',
      'final output'          // Integration
    ]
  });

  const result = await agentProcess(driver, userModule, context);
  expect(result.output).toBe('final output');
});
```

**特徴**:
- 高速・決定的
- ワークフロー全体の動作確認
- 実際のAIモデルは使用しない

#### 3. 実モデルでの検証

CI環境では実行せず、手動実験スクリプトで検証します。

```bash
# 実際のMLXモデルでワークフローをテスト
npx tsx packages/process/scripts/test-agentic-workflow.ts \
  experiments/agentic-workflow-model-comparison/test-cases/meal-planning.json
```

**理由**:
- 実行時間が長い（数分〜数十分）
- モデルの応答が不確定
- API/GPU環境への依存

**検証内容**:
- プロンプト品質の実評価
- 異なるモデル間の比較
- ワークフロー設計の妥当性確認

## テスト実装の指針

### パラメータ検証のテスト戦略

#### ユニットレベル
```typescript
// parameter-validator.test.ts
describe('Parameter Validator', () => {
  it('should validate parameter types', () => {
    // 型チェックロジックのみ
  });

  it('should clamp values to valid ranges', () => {
    // 範囲チェックロジックのみ
  });
});
```

#### 統合レベル
```typescript
// parameter-mapping.integration.test.ts
describe('Parameter Mapping Integration', () => {
  it('should map and validate parameters end-to-end', () => {
    // バリデーション → マッピング → 送信形式の確認
  });

  it('should accept temperature parameter in actual MLX process', async () => {
    // 実際のMLXプロセスを起動
    // temperatureがsamplerとして解釈されることを確認
  });
});
```

## ドキュメント・コード・テストの同期

### 三位一体の原則

```
ドキュメント ←→ コード ←→ テスト
     ↑                      ↓
     └────────────────────────┘
```

### 同期確認チェックリスト

**新機能追加時**:
- [ ] 機能仕様をドキュメントに記載
- [ ] 統合テストで仕様を定義
- [ ] 実装コードを作成
- [ ] ユニットテストで内部動作を保証
- [ ] READMEの使用例を更新

**バグ修正時**:
- [ ] バグを再現するテストを作成
- [ ] コードを修正
- [ ] 関連ドキュメントを更新
- [ ] CHANGELOGに記載

**パラメータ追加時**:
- [ ] パラメータ仕様をドキュメントに追加
- [ ] バリデーションテストを追加
- [ ] マッピングテストを追加
- [ ] 統合テストで実動作を確認

## テストのセットアップパターン

### 統合テスト用グローバルセットアップ

```typescript
// test/setup/mlx-test-setup.ts
export class MlxTestEnvironment {
  private static instance: MlxTestEnvironment;
  private testModel = 'mlx-community/gemma-3-270m-it-qat-4bit';

  static async setup() {
    if (!this.instance) {
      this.instance = new MlxTestEnvironment();
      await this.instance.initialize();
    }
    return this.instance;
  }

  async cleanup() {
    // プロセスのクリーンアップ
  }
}
```

### テストヘルパー

```typescript
// test/helpers/mlx-test-utils.ts
export async function testParameterAcceptance(
  paramName: string,
  paramValue: any
) {
  // パラメータが受け入れられることを確認
}

export async function waitForModelLoad(
  timeout = 30000
) {
  // モデルロードの完了を待機
}
```

## モックの使用方針

### MLXドライバーテストでのモック戦略

| テストレベル | MLXプロセス | モデルロード | 推論実行 |
|------------|-----------|-----------|---------|
| ユニット | モック | モック | モック |
| 統合 | 実プロセス | 実モデル | 実推論 |

### モック使用の判断基準

**モックすべき場合**:
- 実行時間が5秒を超える処理
- ネットワーク依存の処理
- 外部APIコール
- ファイルシステムの大規模操作

**実システムを使うべき場合**:
- パラメータの実際の処理確認
- プロセス間通信の検証
- エラーハンドリングの確認

## 品質基準

### カバレッジ目標

| テストレベル | カバレッジ目標 | 測定対象 |
|------------|------------|---------|
| ユニット | 80%以上 | 関数・分岐 |
| 統合 | 主要シナリオ100% | 主要フロー・クリティカルパス |

### テスト実行時間の目標

| テストレベル | 単体実行時間 | 全体実行時間 |
|------------|------------|------------|
| ユニット | <100ms | <10s |
| 統合 | <30s | <5min |

## CI/CD統合

### 実行戦略

```yaml
# PR時
- ユニットテスト: 必須
- 統合テスト: 選択的（設定・ラベルによる）

# main ブランチマージ時
- 全テストスイート実行
- カバレッジレポート生成

# リリース時
- E2Eテスト必須
- パフォーマンステスト実行
```

## テストコマンド一覧

```bash
# 開発時
npm test                    # ユニットテスト（watch mode）
npm test -- --run          # ユニットテスト（単発実行）

# 特定テストの実行
npm test -- parameter       # パラメータ関連のテスト
npm test -- mlx            # MLX関連のテスト

# レベル別実行
npm run test:unit          # ユニットテストのみ
npm run test:integration   # 統合テストのみ

# 包括的実行
npm run test:ci           # CI用（ユニット）
npm run test:all          # 全テスト実行
```

---

**作成日**: 2025年1月
**最終更新**: 2025年1月