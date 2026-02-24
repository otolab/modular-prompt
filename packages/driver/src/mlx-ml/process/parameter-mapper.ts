/**
 * MLX Driver パラメータマッピング
 *
 * TypeScript側のパラメータ名をPython側のパラメータ名に変換し、
 * サポートされているパラメータのみをフィルタリングする
 */

import type { MlxMlModelOptions } from './types.js';
import { validateOptions, formatValidationResult } from './parameter-validator.js';
import { Logger } from '@modular-prompt/utils';

const logger = new Logger({ prefix: 'MLX', context: 'params' });

/**
 * キャメルケースをスネークケースに変換
 *
 * @param str キャメルケースの文字列
 * @returns スネークケースの文字列
 */
function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * MLX stream_generateでサポートされているパラメータ
 * TypeScript側 (キャメルケース) -> Python側 (スネークケース) のマッピング
 *
 * 注: MLXは内部でmake_samplerを使用しており、
 * stream_generateは**kwargsで受け取ったパラメータを処理する
 */
const SPECIAL_MAPPINGS: Record<string, string> = {
  // 現在は特殊なマッピングなし
  // temperatureはそのままtemperatureとして送る
};

/**
 * MLXでサポートされているパラメータのリスト
 * キャメルケースで定義（TypeScript側の名前）
 */
const SUPPORTED_PARAMS = new Set([
  'maxTokens',        // -> max_tokens
  'temperature',      // -> temp (特殊ケース)
  'topP',            // -> top_p
  'topK',            // -> top_k
  'repetitionPenalty',     // -> repetition_penalty
  'repetitionContextSize', // -> repetition_context_size
]);

/**
 * TypeScript側のオプションをPython側のオプションに変換
 *
 * @param options TypeScript側のオプション（キャメルケース）
 * @param strict 厳密モード（不明なパラメータをエラーとして扱う）
 * @returns Python側で使用可能なオプション（スネークケース）
 * @throws {Error} バリデーションエラーが発生した場合
 */
export function mapOptionsToPython(
  options?: MlxMlModelOptions,
  strict: boolean = true
): MlxMlModelOptions | undefined {
  if (!options) {
    return undefined;
  }

  // まずバリデーションを実行
  const validationResult = validateOptions(options, strict);

  // バリデーションエラーがある場合
  if (!validationResult.valid) {
    const errorMessage = formatValidationResult(validationResult);
    logger.error(errorMessage);

    if (strict) {
      // 厳密モードではエラーをスロー
      throw new Error(`MLX Driver parameter validation failed:\n${errorMessage}`);
    }
    // 非厳密モードでは処理を続行（エラーのあったパラメータはスキップ）
  }

  // 警告がある場合は出力
  if (validationResult.warnings.length > 0) {
    const warningMessage = formatValidationResult({
      valid: true,
      errors: [],
      warnings: validationResult.warnings,
      validatedOptions: validationResult.validatedOptions
    });
    logger.warn(warningMessage);
  }

  // バリデーション済みのオプションを使用
  const validatedOptions = validationResult.validatedOptions || {};
  const mappedOptions: MlxMlModelOptions = {};

  for (const [key, value] of Object.entries(validatedOptions)) {
    // 特殊なマッピングがある場合はそれを使用
    let pythonKey: string;
    if (key in SPECIAL_MAPPINGS) {
      pythonKey = SPECIAL_MAPPINGS[key];
    } else {
      // 通常のキャメルケース -> スネークケース変換
      pythonKey = camelToSnakeCase(key);
    }

    mappedOptions[pythonKey] = value;
  }

  return Object.keys(mappedOptions).length > 0 ? mappedOptions : undefined;
}