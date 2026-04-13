# @modular-prompt/simple-chat

## 0.3.5

### Patch Changes

- Updated dependencies [6e8631b]
  - @modular-prompt/driver@0.11.14
  - @modular-prompt/process@0.4.17

## 0.3.4

### Patch Changes

- Updated dependencies [6757cd1]
  - @modular-prompt/process@0.4.16

## 0.3.3

### Patch Changes

- Updated dependencies [a243023]
  - @modular-prompt/process@0.4.15

## 0.3.2

### Patch Changes

- Updated dependencies [50396a6]
  - @modular-prompt/process@0.4.14
  - @modular-prompt/driver@0.11.13

## 0.3.1

### Patch Changes

- Updated dependencies [1797a1a]
  - @modular-prompt/driver@0.11.12
  - @modular-prompt/process@0.4.13

## 0.3.0

### Minor Changes

- a3227eb: refactor: simple-chat の systemPrompt を PromptModule 方式に移行

  - DialogProfile: systemPrompt → module (PromptModule インライン定義)
  - profile.yaml → default-profile.yaml にリネーム、PromptModule 形式に変換
  - getDefaultProfile() → loadDefaultProfile() (async, YAML 読み込み)
  - ai-chat: buildChatModule() 導入、workflow mode (direct/default/agentic) 対応
  - agentic-workflow: non-output タスクから objective を除去

### Patch Changes

- 5a2fefa: fix: リファクタリングで誤って削除された textOnly オプションを復元
- Updated dependencies [6af12cf]
- Updated dependencies [a3227eb]
  - @modular-prompt/driver@0.11.11
  - @modular-prompt/process@0.4.12

## 0.2.30

### Patch Changes

- Updated dependencies [935934a]
  - @modular-prompt/driver@0.11.10
  - @modular-prompt/process@0.4.11

## 0.2.29

### Patch Changes

- Updated dependencies [07ed99e]
  - @modular-prompt/driver@0.11.9
  - @modular-prompt/process@0.4.10

## 0.2.28

### Patch Changes

- Updated dependencies [9470339]
  - @modular-prompt/driver@0.11.8
  - @modular-prompt/process@0.4.9

## 0.2.27

### Patch Changes

- Updated dependencies [649ac0c]
- Updated dependencies [87afa13]
  - @modular-prompt/driver@0.11.7
  - @modular-prompt/process@0.4.8

## 0.2.26

### Patch Changes

- Updated dependencies [05b6242]
  - @modular-prompt/process@0.4.7

## 0.2.25

### Patch Changes

- Updated dependencies [a13bf0c]
  - @modular-prompt/driver@0.11.6
  - @modular-prompt/process@0.4.6

## 0.2.24

### Patch Changes

- Updated dependencies [4588bf2]
  - @modular-prompt/driver@0.11.5
  - @modular-prompt/process@0.4.5

## 0.2.23

### Patch Changes

- Updated dependencies [9a02d5e]
- Updated dependencies [e35aab8]
  - @modular-prompt/driver@0.11.4
  - @modular-prompt/process@0.4.4

## 0.2.22

### Patch Changes

- Updated dependencies [71c44dc]
  - @modular-prompt/driver@0.11.3
  - @modular-prompt/process@0.4.3

## 0.2.21

### Patch Changes

- Updated dependencies [0f874ea]
  - @modular-prompt/driver@0.11.2
  - @modular-prompt/process@0.4.2

## 0.2.20

### Patch Changes

- Updated dependencies [507daea]
- Updated dependencies [507daea]
  - @modular-prompt/process@0.4.1
  - @modular-prompt/driver@0.11.1

## 0.2.19

### Patch Changes

- Updated dependencies [c954f60]
- Updated dependencies [9c48e56]
  - @modular-prompt/process@0.4.0

## 0.2.18

### Patch Changes

- Updated dependencies [c23d67e]
- Updated dependencies [81f859b]
  - @modular-prompt/process@0.3.9

## 0.2.17

### Patch Changes

- Updated dependencies [d5d80cc]
  - @modular-prompt/driver@0.11.0
  - @modular-prompt/utils@0.3.3
  - @modular-prompt/process@0.3.8

## 0.2.16

### Patch Changes

- af55885: 全パッケージの依存バージョンを固定（^ を除去し == に統一）。Python 依存（mlx-driver, vllm-driver）も同様に固定。
- Updated dependencies [af55885]
- Updated dependencies [f003192]
  - @modular-prompt/core@0.2.2
  - @modular-prompt/driver@0.10.6
  - @modular-prompt/utils@0.3.2
  - @modular-prompt/process@0.3.7

## 0.2.15

### Patch Changes

- Updated dependencies [17f3a50]
- Updated dependencies [17f3a50]
  - @modular-prompt/process@0.3.6
  - @modular-prompt/driver@0.10.5

## 0.2.14

### Patch Changes

- Updated dependencies [bce7391]
  - @modular-prompt/process@0.3.5

## 0.2.13

### Patch Changes

- Updated dependencies [d6742ee]
  - @modular-prompt/driver@0.10.4
  - @modular-prompt/process@0.3.4

## 0.2.12

### Patch Changes

- Updated dependencies [3440874]
  - @modular-prompt/process@0.3.3

## 0.2.11

### Patch Changes

- Updated dependencies [c7cf2dc]
  - @modular-prompt/driver@0.10.3
  - @modular-prompt/process@0.3.2

## 0.2.10

### Patch Changes

- Updated dependencies [ad15839]
- Updated dependencies [c2ba74f]
- Updated dependencies [afe7be5]
  - @modular-prompt/process@0.3.1
  - @modular-prompt/driver@0.10.2

## 0.2.9

### Patch Changes

- Updated dependencies [e2f5700]
- Updated dependencies [0b2eeb6]
  - @modular-prompt/process@0.3.0

## 0.2.8

### Patch Changes

- Updated dependencies [5590292]
  - @modular-prompt/process@0.2.2

## 0.2.7

### Patch Changes

- Updated dependencies [47b9eda]
  - @modular-prompt/core@0.2.1
  - @modular-prompt/process@0.2.1
  - @modular-prompt/driver@0.10.1
  - @modular-prompt/utils@0.3.1

## 0.2.6

### Patch Changes

- Updated dependencies [6d01df5]
- Updated dependencies [749e29e]
- Updated dependencies [fec7974]
- Updated dependencies [0698360]
  - @modular-prompt/process@0.2.0
  - @modular-prompt/driver@0.10.0
  - @modular-prompt/core@0.2.0
  - @modular-prompt/utils@0.3.0

## 0.2.5

### Patch Changes

- Updated dependencies [a732958]
  - @modular-prompt/driver@0.9.3
  - @modular-prompt/process@0.1.28

## 0.2.4

### Patch Changes

- Updated dependencies [b57fcec]
- Updated dependencies [708f42c]
  - @modular-prompt/driver@0.9.2
  - @modular-prompt/process@0.1.27

## 0.2.3

### Patch Changes

- Updated dependencies [fbf6055]
  - @modular-prompt/driver@0.9.1
  - @modular-prompt/process@0.1.26

## 0.2.2

### Patch Changes

- Updated dependencies [d78df1b]
- Updated dependencies [9d23d3f]
  - @modular-prompt/driver@0.9.0
  - @modular-prompt/process@0.1.25

## 0.2.1

### Patch Changes

- Updated dependencies [4b476dc]
- Updated dependencies [23886fc]
  - @modular-prompt/process@0.1.24
  - @modular-prompt/driver@0.8.2

## 0.2.0

### Minor Changes

- 1fe32ed: feat(simple-chat): Logger 対応と CLI オプション追加 (#119)

  console.\*を@modular-prompt/utils の Logger に置き換え、ログレベル制御を可能にした。

  - パッケージ共通の logger.ts を新規作成（prefix: simple-chat）
  - 全ファイルの console 呼び出しを logger メソッドに移行
  - CLI に--quiet/--verbose オプションを追加

### Patch Changes

- Updated dependencies [64ab1f7]
- Updated dependencies [2fb9371]
- Updated dependencies [9831ef7]
  - @modular-prompt/core@0.1.13
  - @modular-prompt/driver@0.8.1
  - @modular-prompt/process@0.1.23
  - @modular-prompt/utils@0.2.4

## 0.1.24

### Patch Changes

- Updated dependencies [be3037c]
  - @modular-prompt/driver@0.8.0
  - @modular-prompt/process@0.1.22

## 0.1.23

### Patch Changes

- Updated dependencies [68c1ead]
  - @modular-prompt/driver@0.7.0
  - @modular-prompt/process@0.1.21

## 0.1.22

### Patch Changes

- Updated dependencies [866051c]
- Updated dependencies [1c8c8db]
  - @modular-prompt/driver@0.6.3
  - @modular-prompt/core@0.1.12
  - @modular-prompt/process@0.1.20
  - @modular-prompt/utils@0.2.3

## 0.1.21

### Patch Changes

- Updated dependencies [835a9b9]
  - @modular-prompt/core@0.1.11
  - @modular-prompt/driver@0.6.2
  - @modular-prompt/process@0.1.19
  - @modular-prompt/utils@0.2.2

## 0.1.20

### Patch Changes

- Updated dependencies [f17538c]
  - @modular-prompt/driver@0.6.1
  - @modular-prompt/process@0.1.18

## 0.1.19

### Patch Changes

- Updated dependencies [d7c8e5c]
- Updated dependencies [e0117fc]
  - @modular-prompt/utils@0.2.1
  - @modular-prompt/driver@0.6.0
  - @modular-prompt/process@0.1.17

## 0.1.18

### Patch Changes

- Updated dependencies [50c66af]
  - @modular-prompt/driver@0.5.2
  - @modular-prompt/process@0.1.16

## 0.1.17

### Patch Changes

- Updated dependencies [84ac5c8]
  - @modular-prompt/driver@0.5.1
  - @modular-prompt/process@0.1.15

## 0.1.16

### Patch Changes

- Updated dependencies [9a7660e]
  - @modular-prompt/driver@0.5.0
  - @modular-prompt/process@0.1.14

## 0.1.15

### Patch Changes

- Updated dependencies [2d9d217]
  - @modular-prompt/utils@0.2.0
  - @modular-prompt/driver@0.4.7
  - @modular-prompt/process@0.1.13

## 0.1.14

### Patch Changes

- cac4dab: リネーム後のクリーンアップ

  - prepublishOnly スクリプトを修正（npm run → pnpm run）
  - リポジトリ URL を新しい名前に更新（moduler-prompt → modular-prompt）
  - experiment パッケージのビルド出力構造を修正（dist/src/ → dist/）
  - パッケージ説明文の修正

- Updated dependencies [cac4dab]
  - @modular-prompt/core@0.1.10
  - @modular-prompt/driver@0.4.6
  - @modular-prompt/utils@0.1.5
  - @modular-prompt/process@0.1.12

## 0.1.13

### Patch Changes

- Updated dependencies [d85ab2d]
  - @modular-prompt/driver@0.4.5
  - @modular-prompt/process@0.1.11

## 0.1.12

### Patch Changes

- Updated dependencies [afd3c40]
  - @modular-prompt/core@0.1.9
  - @modular-prompt/driver@0.4.4
  - @modular-prompt/process@0.1.10
  - @modular-prompt/utils@0.1.4

## 0.1.11

### Patch Changes

- Updated dependencies [9090829]
  - @modular-prompt/driver@0.4.3
  - @modular-prompt/process@0.1.9

## 0.1.10

### Patch Changes

- b049930: package.json に repository フィールドを追加

  Trusted Publisher 使用時の--provenance フラグが repository.url を検証するため、
  driver と simple-chat パッケージに repository フィールドを追加しました。

- Updated dependencies [b049930]
  - @modular-prompt/driver@0.4.2
