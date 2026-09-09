# @modular-prompt/extract

## 0.3.0

### Minor Changes

- f85d708: feat(extract): add `modular-prompt-extract clean` for store and container removal

  `modular-prompt-extract clean <storename>` removes one named store, while `modular-prompt-extract clean --all` removes the entire cache container. Missing stores and containers are treated as successful no-ops.

  Closes #351

- 7a56782: feat(extract): change the default CLI cache container to `~/.modular-prompt/extract-cache`

  `modular-prompt-extract` create / extract / list now use the user-level cache container when `-d` is omitted. Existing `./.extract-cache` data is not automatically migrated; see the manual migration instructions in the README.

  Closes #352

- 64418b0: feat(extract): add `modular-prompt-extract add` for incremental store expansion

  既存 store にファイルを追加し、incremental prefill で corpus と KV cache を拡張できるようにしました。`--dry-run`、重複 id の検証、失敗時に既存 store を保持する staging 更新、manifest の `updatedAt` に対応します。

  Closes #355

- e480537: feat(extract): cache container 内で storename ごとの複数 store をサポート

  `modular-prompt-extract` の create/extract CLI に storename を導入し、store ごとの manifest/KV キャッシュと `list` サブコマンドを追加する。旧 CLI 引数形式と旧 cache レイアウトからの自動移行は行わない。

  Closes #353

### Patch Changes

- eb510e2: extract のモデル解決を AIService 経由に統一し、models.yaml の alias と生の MLX model ID を利用可能にする。driver から cache controller を注入できるようにし、runtime のキャッシュライフサイクルを維持する。
- Updated dependencies [ff885fa]
- Updated dependencies [eb510e2]
- Updated dependencies [f2e1247]
- Updated dependencies [7bec4ee]
- Updated dependencies [6ce333b]
  - @modular-prompt/driver@0.16.0

## Unreleased

### Breaking Changes

- CLI bin 名を `modular-extract` から `modular-prompt-extract` に変更しました。旧 bin は公開されない破壊的変更のため、既存の呼び出しを新しいコマンド名へ移行してください。
- `modular-prompt-extract create` / `add` / `extract` は storename を positional 第 1 引数として必須化しました。`-d` は store コンテナを指し、各 store は `<container>/<storename>/` に独立した manifest と KV キャッシュを持ちます。
- `modular-prompt-extract list` でコンテナ内の store サマリを確認できます。create/add/extract/list/clean の `-d` 省略時は `~/.modular-prompt/extract-cache`（`MODULAR_PROMPT_HOME` 指定時は `${MODULAR_PROMPT_HOME}/extract-cache`）を使用します。
- 旧デフォルト `./.extract-cache` の自動検出・自動移行は行いません。既存キャッシュは README の手動移行手順に従って、新しいデフォルトの store container へ移動してください。
- 旧 CLI 引数形式と旧レイアウト（コンテナ直下の `manifest.json`）も自動移行しません。

### Minor Changes

- `modular-prompt-extract add <storename> <files...>` で既存 store の corpus と KV cache を incremental prefill により拡張できるようにしました。`--dry-run`、同一 id の重複スキップ、内容変更時のエラー、失敗時に既存 store を保持する staging 更新、manifest の `updatedAt` に対応しています。

  Closes #355

- `modular-prompt-extract clean <storename>` で store 単位、`modular-prompt-extract clean --all` で cache container 全体の manifest と KV キャッシュを削除できるようにしました。存在しない対象は no-op になります。

  Closes #351

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
  - `modular-prompt-extract` CLI（`create` / `extract` / `--dry-run`）
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
