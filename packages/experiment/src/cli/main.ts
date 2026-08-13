#!/usr/bin/env node
/**
 * modular-experiment CLI entry point
 *
 * Usage:
 *   modular-experiment <config> [options]           Run experiment
 *   modular-experiment format <config> [options]    Format prompts without LLM
 */

import { parseFormatArgs } from './format-args.js';
import { runFormatCommand } from '../format-command.js';

async function main(): Promise<void> {
  if (process.argv[2] === 'format') {
    const options = parseFormatArgs(['node', 'modular-experiment', ...process.argv.slice(3)]);
    await runFormatCommand(options);
    return;
  }

  await import('../run-comparison.js');
}

main().catch((error) => {
  console.error('❌ Command failed:', error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
