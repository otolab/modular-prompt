/**
 * Python runtime セットアップコマンド（CLI・エラーメッセージ・ドキュメントで共通）
 *
 * monorepo: ルート package.json が driver へ委譲する `pnpm run setup-*`
 * published: `modular-runtime` bin（@modular-prompt/driver インストール後）
 */

/** monorepo ルート（pnpm）— ルート package.json 経由で driver の setup を実行 */
export const SETUP_MLX_MONOREPO = 'pnpm run setup-mlx';
export const SETUP_PYTORCH_MONOREPO = 'pnpm run setup-pytorch';

/** @modular-prompt/driver を npm インストールした環境向け */
export const SETUP_MLX_CLI = 'modular-runtime setup mlx';
export const SETUP_PYTORCH_CLI = 'modular-runtime setup pytorch';
