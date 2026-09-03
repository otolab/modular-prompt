/**
 * Python runtime セットアップコマンド（CLI・エラーメッセージ・ドキュメントで共通）
 *
 * monorepo: ルート package.json が driver へ委譲する `pnpm run setup-*`
 * published: node_modules 内の runtime-cli.js を直接実行
 */

/** monorepo ルート（pnpm）— ルート package.json 経由で driver の setup を実行 */
export const SETUP_MLX_MONOREPO = 'pnpm run setup-mlx';
export const SETUP_PYTORCH_MONOREPO = 'pnpm run setup-pytorch';

/** @modular-prompt/driver を npm インストールした環境向け */
export const SETUP_MLX_CLI =
  'node node_modules/@modular-prompt/driver/scripts/runtime-cli.js setup mlx';
export const SETUP_PYTORCH_CLI =
  'node node_modules/@modular-prompt/driver/scripts/runtime-cli.js setup pytorch';
