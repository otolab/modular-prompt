import type { AIDriver } from '@modular-prompt/driver';

/** モデルの役割 */
export type ModelRole = 'default' | 'thinking' | 'instruct' | 'chat' | 'plan';

/** 役割別ドライバーマッピング */
export type DriverSet = { default: AIDriver } & { [K in Exclude<ModelRole, 'default'>]?: AIDriver };

/** ワークフロー関数の第1引数型 */
export type DriverInput = AIDriver | DriverSet;

/** AIDriverインスタンス判定 */
export function isAIDriver(input: unknown): input is AIDriver {
  return (
    typeof input === 'object' &&
    input !== null &&
    'query' in input &&
    typeof (input as any).query === 'function' &&
    'streamQuery' in input &&
    typeof (input as any).streamQuery === 'function' &&
    'close' in input &&
    typeof (input as any).close === 'function'
  );
}

/** 役割に対応するドライバーを解決。未指定の役割はdefaultにフォールバック */
export function resolveDriver(input: DriverInput, role: ModelRole = 'default'): AIDriver {
  if (isAIDriver(input)) return input;
  return input[role] ?? input.default;
}
