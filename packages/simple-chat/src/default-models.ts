/**
 * simple-chat 同梱の models 設定
 */

import type { ModelsConfig } from '@modular-prompt/driver';

/** アプリ同梱のデフォルト models（user / profile で上書き可能） */
export const BUNDLED_MODELS_CONFIG: ModelsConfig = {
  models: {
    default: {
      provider: 'mlx',
      model: 'LiquidAI/LFM2.5-1.2B-JP-MLX-4bit',
    },
  },
};
