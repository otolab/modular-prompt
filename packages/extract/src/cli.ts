#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CACHE_DIR, DEFAULT_MAX_TOKENS } from './cli/constants.js';
import { runCreateCommand } from './cli/create-command.js';
import { runExtractCommand } from './cli/extract-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8'),
) as { version: string };

function printHelp(): void {
  console.log(`modular-extract v${packageJson.version}

Usage:
  modular-extract create [-d <cache-dir>] [-m <model>] [--dry-run] <files...>
  modular-extract extract -d <cache-dir> [--max-tokens <n>] [--dry-run] <query...>

Commands:
  create    Load input files and prepare KV cache in <cache-dir>
  extract   Run extraction query against a prepared cache directory

Options:
  -d, --cache-dir <path>   Cache directory (create default: ${DEFAULT_CACHE_DIR})
  -m, --model <model>      MLX model alias from models.yaml or raw model id
  --max-tokens <n>         Max tokens for extract (default: ${DEFAULT_MAX_TOKENS})
  --dry-run                Compile and print full prompt text (no MLX / no cache write)
  -h, --help               Show help

Cache cleanup:
  rm -rf <cache-dir>

Note:
  Without -m, models.default (or the first model entry) is selected from bundled config merged with
  ~/.modular-prompt/models.yaml (MODULAR_PROMPT_HOME can override its location).
  If no model is configured, specify -m <model-id-or-alias> or define models.default.
  MLX backend is fixed to mlx-lm (backend: lm) for prompt cache support.
`);
}

interface ParsedArgs {
  command?: 'create' | 'extract' | 'help';
  cacheDir?: string;
  model?: string;
  maxTokens?: number;
  dryRun?: boolean;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { positional: [] };
  let index = 0;

  while (index < argv.length) {
    const arg = argv[index]!;

    if (arg === '-h' || arg === '--help') {
      result.command = 'help';
      return result;
    }

    if (!result.command && !arg.startsWith('-')) {
      if (arg === 'create' || arg === 'extract') {
        result.command = arg;
        index += 1;
        continue;
      }
    }

    if (arg === '-d' || arg === '--cache-dir') {
      result.cacheDir = argv[index + 1];
      if (!result.cacheDir) {
        throw new Error(`${arg} requires a path`);
      }
      index += 2;
      continue;
    }

    if (arg === '-m' || arg === '--model') {
      result.model = argv[index + 1];
      if (!result.model) {
        throw new Error(`${arg} requires a model id`);
      }
      index += 2;
      continue;
    }

    if (arg === '--dry-run') {
      result.dryRun = true;
      index += 1;
      continue;
    }

    if (arg === '--max-tokens') {
      const value = argv[index + 1];
      const parsed = Number.parseInt(value ?? '', 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error('--max-tokens must be a positive integer');
      }
      result.maxTokens = parsed;
      index += 2;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    result.positional.push(arg);
    index += 1;
  }

  return result;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (!parsed.command || parsed.command === 'help') {
    printHelp();
    if (!parsed.command) {
      process.exitCode = 1;
    }
    return;
  }

  if (parsed.command === 'create') {
    const output = await runCreateCommand({
      cacheDir: parsed.cacheDir ?? DEFAULT_CACHE_DIR,
      model: parsed.model,
      files: parsed.positional,
      dryRun: parsed.dryRun,
    });
    if (typeof output === 'string') {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  if (!parsed.cacheDir) {
    throw new Error('extract requires -d <cache-dir>');
  }

  const text = await runExtractCommand({
    cacheDir: parsed.cacheDir,
    query: parsed.positional.join(' '),
    maxTokens: parsed.maxTokens,
    dryRun: parsed.dryRun,
  });
  process.stdout.write(`${text}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
