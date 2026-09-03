/**
 * extract 同梱の models 設定
 *
 * user の ~/.modular-prompt/models.yaml から alias や default を上書きできる。
 */

import type { ModelsConfig } from '@modular-prompt/driver';

/** extract が -m なしで使用する同梱デフォルトモデル */
export const BUNDLED_DEFAULT_MODEL =
  process.env.MLX_MODEL ?? 'prism-ml/Ternary-Bonsai-1.7B-mlx-2bit';

/** 同梱モデル設定（user models.yaml より低い優先度） */
export const BUNDLED_MODELS_CONFIG: ModelsConfig = {
  models: {
    default: {
      provider: 'mlx',
      model: BUNDLED_DEFAULT_MODEL,
    },
  },
};
