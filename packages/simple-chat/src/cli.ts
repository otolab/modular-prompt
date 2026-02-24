#!/usr/bin/env node

/**
 * Simple Chat CLI
 */

import { program } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '@modular-prompt/utils';
import { runChat } from './chat.js';
import type { SimpleChatOptions } from './types.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('cli');

// Get package.json for version
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

program
  .name('simple-chat')
  .description('Simple chat application using Moduler Prompt with MLX models')
  .version(packageJson.version)
  .argument('[message...]', 'User message (use "-" for stdin)')
  .option('-p, --profile <path>', 'Dialog profile file path (YAML)')
  .option('-l, --log [path]', 'Chat log file path (JSON), show log if no message')
  .option('-d, --drivers <path>', 'Drivers configuration file path (YAML)')
  .option('-m, --model <model>', 'Override model name')
  .option('--temperature <value>', 'Temperature (0.0-2.0)', parseFloat)
  .option('--max-tokens <value>', 'Maximum tokens', parseInt)
  .option('--stdin', 'Read user message from stdin')
  .option('-q, --quiet', 'Suppress all output except errors')
  .option('-v, --verbose', 'Show verbose output')
  .action(async (messageArgs: string[], options) => {
    try {
      // Configure log level
      if (options.quiet) {
        Logger.configure({ level: 'error' });
      } else if (options.verbose) {
        Logger.configure({ level: 'verbose' });
      }
      // Check for stdin flag in message args
      const hasStdinFlag = messageArgs.includes('-');
      const userMessage = hasStdinFlag
        ? undefined
        : messageArgs.length > 0 ? messageArgs.join(' ') : undefined;
      
      // Show log only mode (when -l is specified without message)
      if (!messageArgs.length && options.log && !options.stdin && !hasStdinFlag) {
        const chatOptions: SimpleChatOptions = {
          logPath: options.log,
          showLogOnly: true,
        };
        await runChat(chatOptions);
        return;
      }
      
      // Normal chat mode
      const chatOptions: SimpleChatOptions = {
        profilePath: options.profile,
        logPath: options.log,
        driversPath: options.drivers,
        userMessage,
        useStdin: hasStdinFlag || !!options.stdin,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      };
      
      await runChat(chatOptions);
    } catch (error) {
      logger.error(`${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();