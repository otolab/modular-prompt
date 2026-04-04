/**
 * MLX Driver パラメータバリデーター
 *
 * オプションパラメータの存在チェックと値の妥当性検証を行う
 */



/**
 * バリデーション結果
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  validatedOptions?: Record<string, unknown>;
}

/**
 * バリデーションエラー
 */
export interface ValidationError {
  field: string;
  value: any;
  message: string;
  type: 'unknown_parameter' | 'invalid_type' | 'out_of_range';
}

/**
 * バリデーション警告
 */
export interface ValidationWarning {
  field: string;
  value: any;
  message: string;
  correctedValue?: any;
}

/**
 * パラメータの制約定義
 */
interface ParameterConstraint {
  type: 'number' | 'boolean' | 'string';
  min?: number;
  max?: number;
  default: any;
  description: string;
}

/**
 * MLXパラメータの制約定義
 * キャメルケース形式のみで定義（APIインターフェース用）
 */
const PARAMETER_CONSTRAINTS: Record<string, ParameterConstraint> = {
  maxTokens: {
    type: 'number',
    min: 1,
    max: 100000,
    default: 1000,
    description: '生成する最大トークン数'
  },
  temperature: {
    type: 'number',
    min: 0.0,
    max: 2.0,
    default: 1.0,
    description: '生成のランダム性を制御する温度パラメータ'
  },
  topP: {
    type: 'number',
    min: 0.0,
    max: 1.0,
    default: 1.0,
    description: 'Top-pサンプリングのしきい値'
  },
  topK: {
    type: 'number',
    min: 1,
    max: 1000,
    default: 40,
    description: 'Top-kサンプリングのk値'
  },
  repetitionPenalty: {
    type: 'number',
    min: 0.0,
    max: 2.0,
    default: 1.0,
    description: '繰り返しペナルティの強度'
  },
  repetitionContextSize: {
    type: 'number',
    min: 1,
    max: 10000,
    default: 20,
    description: '繰り返し検出のコンテキストサイズ'
  }
};

/**
 * オプションパラメータのバリデーション
 *
 * @param options 検証するオプション
 * @param strict 厳密モード（不明なパラメータをエラーとして扱う）
 * @returns バリデーション結果
 */
export function validateOptions(
  options: Record<string, any> | undefined,
  strict: boolean = true
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const validatedOptions: Record<string, unknown> = {};

  if (!options) {
    return { valid: true, errors: [], warnings: [], validatedOptions: undefined };
  }

  // 各パラメータをチェック
  for (const [key, value] of Object.entries(options)) {
    const constraint = PARAMETER_CONSTRAINTS[key];

    // 不明なパラメータ
    if (!constraint) {
      // 利用可能なパラメータから重複を除く（camelCaseのみ表示）
      const availableParams = ['maxTokens', 'temperature', 'topP', 'topK', 'repetitionPenalty', 'repetitionContextSize'];

      if (strict) {
        errors.push({
          field: key,
          value,
          message: `Unknown parameter '${key}'. Available parameters: ${availableParams.join(', ')}`,
          type: 'unknown_parameter'
        });
      } else {
        warnings.push({
          field: key,
          value,
          message: `Unknown parameter '${key}' will be ignored`
        });
      }
      continue;
    }

    // 型チェック
    const actualType = typeof value;
    if (actualType !== constraint.type) {
      // 数値への変換を試みる
      if (constraint.type === 'number' && actualType === 'string') {
        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          warnings.push({
            field: key,
            value,
            message: `Parameter '${key}' was converted from string to number`,
            correctedValue: numValue
          });
          validatedOptions[key] = numValue;
          continue;
        }
      }

      errors.push({
        field: key,
        value,
        message: `Parameter '${key}' must be of type ${constraint.type}, got ${actualType}`,
        type: 'invalid_type'
      });
      continue;
    }

    // 範囲チェック（数値型の場合）
    if (constraint.type === 'number') {
      let finalValue = value;

      // 最小値チェック
      if (constraint.min !== undefined && value < constraint.min) {
        warnings.push({
          field: key,
          value,
          message: `Parameter '${key}' value ${value} is below minimum ${constraint.min}, using minimum value`,
          correctedValue: constraint.min
        });
        finalValue = constraint.min;
      }

      // 最大値チェック
      if (constraint.max !== undefined && value > constraint.max) {
        warnings.push({
          field: key,
          value,
          message: `Parameter '${key}' value ${value} exceeds maximum ${constraint.max}, using maximum value`,
          correctedValue: constraint.max
        });
        finalValue = constraint.max;
      }

      validatedOptions[key] = finalValue;
    } else {
      // その他の型はそのまま設定
      validatedOptions[key] = value;
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    validatedOptions: valid ? validatedOptions : undefined
  };
}

/**
 * バリデーション結果をフォーマットして出力
 *
 * @param result バリデーション結果
 * @returns フォーマットされたエラーメッセージ
 */
export function formatValidationResult(result: ValidationResult): string {
  const messages: string[] = [];

  if (!result.valid) {
    messages.push('❌ Validation failed:');
    for (const error of result.errors) {
      messages.push(`  - ${error.message}`);
    }
  }

  if (result.warnings.length > 0) {
    messages.push('⚠️  Warnings:');
    for (const warning of result.warnings) {
      let msg = `  - ${warning.message}`;
      if (warning.correctedValue !== undefined) {
        msg += ` (corrected to: ${warning.correctedValue})`;
      }
      messages.push(msg);
    }
  }

  return messages.join('\n');
}

/**
 * 利用可能なパラメータのヘルプテキストを生成
 *
 * @returns パラメータのヘルプテキスト
 */
export function getParameterHelp(): string {
  const lines: string[] = ['Available MLX parameters (use camelCase format):'];

  for (const [key, constraint] of Object.entries(PARAMETER_CONSTRAINTS)) {
    let line = `  - ${key} (${constraint.type}): ${constraint.description}`;

    if (constraint.type === 'number' && (constraint.min !== undefined || constraint.max !== undefined)) {
      const range = [];
      if (constraint.min !== undefined) range.push(`min: ${constraint.min}`);
      if (constraint.max !== undefined) range.push(`max: ${constraint.max}`);
      line += ` [${range.join(', ')}]`;
    }

    line += ` (default: ${constraint.default})`;
    lines.push(line);
  }

  return lines.join('\n');
}