#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CACHE_DIR, DEFAULT_MAX_TOKENS } from './cli/constants.js';
import { parseArgs } from './cli/args.js';
import { runCreateCommand } from './cli/create-command.js';
import { runExtractCommand } from './cli/extract-command.js';
import { runListCommand } from './cli/list-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8'),
) as { version: string };

function printHelp(): void {
  console.log(`modular-extract v${packageJson.version}

Usage:
  modular-extract create <storename> [-d <cache-dir>] [-m <model>] [--dry-run] <files...>
  modular-extract extract <storename> [-d <cache-dir>] [--max-tokens <n>] [--dry-run] <query...>
  modular-extract list [-d <cache-dir>]

Commands:
  create    Load input files and prepare KV cache in <cache-dir>/<storename>
  extract   Run extraction query against a prepared store
  list      List stores and their cache summaries

Options:
  -d, --cache-dir <path>   Store container directory (default: ${DEFAULT_CACHE_DIR})
  -m, --model <model>      MLX model alias from models.yaml or raw model id
  --max-tokens <n>         Max tokens for extract (default: ${DEFAULT_MAX_TOKENS})
  --dry-run                Compile and print full prompt text (no MLX / no cache write)
  -h, --help               Show help

Store name:
  Must match [a-zA-Z0-9][a-zA-Z0-9_-]* and cannot be create, extract, list, or clean.

Note:
  Without -m, models.default (or the first model entry) is selected from bundled config merged with
  ~/.modular-prompt/models.yaml (MODULAR_PROMPT_HOME can override its location).
  MLX_MODEL is also supported for backward compatibility as the bundled default; user yaml overrides it.
  If no model is configured, specify -m <model-id-or-alias> or define models.default.
  MLX backend is fixed to mlx-lm (backend: lm) for prompt cache support.
`);
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
      storename: parsed.storename!,
      model: parsed.model,
      files: parsed.positional,
      dryRun: parsed.dryRun,
    });
    if (typeof output === 'string') {
      process.stdout.write(`${output}\n`);
    }
    return;
  }

  if (parsed.command === 'extract') {
    const text = await runExtractCommand({
      cacheDir: parsed.cacheDir ?? DEFAULT_CACHE_DIR,
      storename: parsed.storename!,
      query: parsed.positional.join(' '),
      maxTokens: parsed.maxTokens,
      dryRun: parsed.dryRun,
    });
    process.stdout.write(`${text}\n`);
    return;
  }

  const text = await runListCommand({
    cacheDir: parsed.cacheDir ?? DEFAULT_CACHE_DIR,
  });
  process.stdout.write(`${text}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
