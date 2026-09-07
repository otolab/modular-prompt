# @modular-prompt/extract

## Unreleased

### Breaking Changes

- `modular-extract create` / `extract` は storename を positional 第1引数として必須化しました。`-d` は store コンテナを指し、各 store は `<container>/<storename>/` に独立した manifest と KV キャッシュを持ちます。
- `modular-extract list` でコンテナ内の store サマリを確認できます。create/extract/list の `-d` 省略時は `~/.modular-prompt/extract-cache`（`MODULAR_PROMPT_HOME` 指定時は `${MODULAR_PROMPT_HOME}/extract-cache`）を使用します。
- 旧デフォルト `./.extract-cache` の自動検出・自動移行は行いません。既存キャッシュは README の手動移行手順に従って、新しいデフォルトの store container へ移動してください。
- 旧 CLI 引数形式と旧レイアウト（コンテナ直下の `manifest.json`）も自動移行しません。

## 0.2.0

### Minor Changes

- 8e83b54: feat: `@modular-prompt/extract` パッケージを追加（Phase 1 コア API）

  `createExtractSession`, `ExtractSession.extract`, `getHistory`, `close` を実装。文書抽出向けに `baseModule` + `corpus` + リクエストごとの `cue` / `inputs` を `merge()` → `compile()` → `driver.query()` で実行する。

  Closes #331

- 3569a1d: feat: ExtractSession に PromptCacheController 連携を追加（Phase 2）

  `createExtractSession` がセッション単位で KV キャッシュを prepare / release し、毎回のクエリに `cacheHandle` を渡す。driver 側は `QueryOptions.cacheHandle` で外部 prepare を利用可能。

  Closes #332

- 2246e66: feat: ExtractSession Phase 3 — デフォルト base module、structured output、previousExtractions ヘルパ

  - `baseModule` をオプショナル化し `defaultExtractBaseModule` を提供
  - `mergeExtractBaseModule` でカスタム overlay の merge パターンをサポート
  - `buildPreviousExtractionsInputs` / `formatPreviousExtractions` で段階的深掘りの inputs 組み立てを簡潔化
  - `schema` 指定時の structured output をテストで担保

  Closes #333

- 4e7157a: feat(extract): Phase 4 — ドキュメント・CLI・キャッシュ永続化

  - README・examples・API.md・プロジェクトドキュメント参照（#334）
  - `modular-extract` CLI（`create` / `extract` / `--dry-run`）
  - mlx-lm バックエンド固定、maxTokens デフォルト 8000
  - 固定 cacheDir で KV ファイルを残す `session.close({ releaseCache: false })`

  Closes #334

### Patch Changes

- Updated dependencies [c3f3b67]
- Updated dependencies [3569a1d]
- Updated dependencies [f0bf773]
- Updated dependencies [48292f3]
- Updated dependencies [d5f532d]
- Updated dependencies [2f886db]
- Updated dependencies [f1288ab]
- Updated dependencies [30c4143]
- Updated dependencies [ab4f2d0]
- Updated dependencies [30ba3fc]
- Updated dependencies [e0e6611]
- Updated dependencies [c20c6bc]
- Updated dependencies [235af29]
- Updated dependencies [be002b8]
  - @modular-prompt/driver@0.15.0
