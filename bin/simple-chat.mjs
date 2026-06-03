#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, '..', 'packages', 'simple-chat', 'dist', 'cli.js');

try {
  execFileSync(process.execPath, ['--no-deprecation', cli, ...process.argv.slice(2)], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
} catch (e) {
  process.exit(e.status ?? 1);
}
