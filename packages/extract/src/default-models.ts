/**
 * extract の base models 設定。
 *
 * モデルは同梱せず、user の ~/.modular-prompt/models.yaml から解決する。
 */

import type { ModelsConfig } from '@modular-prompt/driver';

/** 同梱モデルを持たない base config（user models.yaml より低い優先度） */
export const BUNDLED_MODELS_CONFIG: ModelsConfig = {};
