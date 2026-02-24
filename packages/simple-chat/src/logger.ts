/**
 * Simple-chat package logger
 */

import { Logger } from '@modular-prompt/utils';

/**
 * Simple-chat package logger with 'simple-chat' prefix
 */
export const logger = new Logger({ prefix: 'simple-chat', context: 'main' });
