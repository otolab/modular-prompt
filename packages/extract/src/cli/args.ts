import { validateStorename } from './store.js';

export type CliCommand = 'create' | 'extract' | 'list' | 'help';

export interface ParsedArgs {
  command?: CliCommand;
  cacheDir?: string;
  model?: string;
  maxTokens?: number;
  dryRun?: boolean;
  storename?: string;
  positional: string[];
}

function requireOptionValue(argv: string[], index: number, option: string, description: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires ${description}`);
  }
  return value;
}

function parseMaxTokens(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--max-tokens must be a positive integer');
  }
  return parsed;
}

function validateCommandOptions(result: ParsedArgs): void {
  if (result.command === 'create' && result.maxTokens !== undefined) {
    throw new Error('--max-tokens is only valid with extract');
  }
  if (result.command === 'extract' && result.model !== undefined) {
    throw new Error('--model is only valid with create');
  }
  if (result.command === 'list') {
    if (result.model !== undefined || result.maxTokens !== undefined || result.dryRun) {
      throw new Error('list does not accept create/extract options');
    }
    if (result.positional.length > 0) {
      throw new Error('list does not accept positional arguments');
    }
  }
}

/** Parse modular-extract command-line arguments. */
export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { positional: [] };
  let index = 0;
  let optionsEnded = false;

  while (index < argv.length) {
    const arg = argv[index]!;

    if (!optionsEnded && (arg === '-h' || arg === '--help')) {
      result.command = 'help';
      return result;
    }

    if (!optionsEnded && arg === '--') {
      optionsEnded = true;
      index += 1;
      continue;
    }

    if (!result.command && !optionsEnded && !arg.startsWith('-')) {
      if (arg === 'create' || arg === 'extract' || arg === 'list') {
        result.command = arg;
        index += 1;
        continue;
      }
      throw new Error(`Unknown command: ${arg}`);
    }

    if (!optionsEnded && (arg === '-d' || arg === '--cache-dir')) {
      result.cacheDir = requireOptionValue(argv, index, arg, 'a path');
      index += 2;
      continue;
    }

    if (!optionsEnded && (arg === '-m' || arg === '--model')) {
      result.model = requireOptionValue(argv, index, arg, 'a model id');
      index += 2;
      continue;
    }

    if (!optionsEnded && arg === '--dry-run') {
      result.dryRun = true;
      index += 1;
      continue;
    }

    if (!optionsEnded && arg === '--max-tokens') {
      const value = requireOptionValue(argv, index, arg, 'a positive integer');
      result.maxTokens = parseMaxTokens(value);
      index += 2;
      continue;
    }

    if (!optionsEnded && arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    result.positional.push(arg);
    index += 1;
  }

  if (result.command === 'create' || result.command === 'extract') {
    const [storename, ...positional] = result.positional;
    if (!storename) {
      throw new Error(`${result.command} requires a storename as its first argument`);
    }
    validateStorename(storename);
    result.storename = storename;
    result.positional = positional;
  }

  validateCommandOptions(result);
  return result;
}
