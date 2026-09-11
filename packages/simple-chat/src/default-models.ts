/**
 * simple-chat の base models 設定。
 *
 * モデルは同梱せず、user yaml または profile から解決する。
 */

import type { ModelsConfig } from '@modular-prompt/driver';

/** 同梱モデルを持たない base config（user / profile より低い優先度） */
export const BUNDLED_MODELS_CONFIG: ModelsConfig = {};
