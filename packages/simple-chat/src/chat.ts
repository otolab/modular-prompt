/**
 * Main chat processing
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import chalk from 'chalk';
import type {
  DialogProfile,
  ChatLog,
  SimpleChatOptions,
  ModelOverrides,
} from './types.js';
import {
  loadDefaultProfile,
  loadDialogProfile,
} from './profile.js';
import {
  createChatLog,
  loadChatLog,
  saveChatLog,
  addMessage,
  getChatLogStats,
} from './chat-log.js';
import {
  performAIChat,
  closeDriver,
} from './ai-chat.js';
import { parseProvider } from './inference-selection.js';
import { loadResourceFiles } from './resource-files.js';
import type { MaterialContext } from '@modular-prompt/process';
import { Spinner } from './spinner.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('chat');

function buildModelOverrides(options: SimpleChatOptions): ModelOverrides | undefined {
  const overrides: ModelOverrides = {};
  let hasOverride = false;

  if (options.model) {
    overrides.model = options.model;
    hasOverride = true;
  }
  if (options.provider) {
    overrides.provider = parseProvider(options.provider);
    hasOverride = true;
  }
  if (options.backend) {
    overrides.backend = options.backend;
    hasOverride = true;
  } else if (options.textOnly) {
    overrides.textOnly = true;
    hasOverride = true;
  }

  return hasOverride ? overrides : undefined;
}

/**
 * Process user input
 */
async function getUserMessage(options: SimpleChatOptions): Promise<string> {
  if (options.userMessage) {
    return options.userMessage;
  }

  if (options.useStdin) {
    try {
      const input = readFileSync(0, 'utf-8');
      return input.trim();
    } catch {
      throw new Error('Failed to read from stdin');
    }
  }

  throw new Error('No user message provided');
}

/**
 * Display chat log
 */
function displayChatLog(chatLog: ChatLog): void {
  const stats = getChatLogStats(chatLog);

  logger.info(chalk.blue('=== Chat Log ==='));
  logger.info(chalk.gray(`Session ID: ${stats.sessionId}`));
  logger.info(chalk.gray(`Started at: ${stats.startedAt}`));
  logger.info(chalk.gray(`Total messages: ${stats.totalMessages}`));

  for (const message of chatLog.messages) {
    const roleColor =
      message.role === 'user' ? chalk.green :
      message.role === 'assistant' ? chalk.cyan :
      chalk.yellow;

    logger.info(roleColor(`[${message.role}]`));
    logger.info(message.content);

    if (message.resourceFiles && message.resourceFiles.length > 0) {
      logger.info(chalk.gray(`  Resources: ${message.resourceFiles.join(', ')}`));
    }

    if (message.images && message.images.length > 0) {
      logger.info(chalk.gray(`  Images: ${message.images.join(', ')}`));
    }
  }
}

/**
 * Run chat session
 */
export async function runChat(options: SimpleChatOptions): Promise<void> {
  // Load or create profile
  let profile: DialogProfile;
  if (options.profilePath) {
    profile = await loadDialogProfile(options.profilePath);
  } else {
    profile = await loadDefaultProfile();
  }

  // Apply CLI overrides (model/provider/backend は profile を書き換えない)
  const modelOverrides = buildModelOverrides(options);
  if (modelOverrides?.provider) {
    logger.info(chalk.gray(`Provider: ${modelOverrides.provider}`));
  }
  if (modelOverrides?.backend) {
    logger.info(chalk.gray(`Backend: ${modelOverrides.backend}`));
  }

  if (options.temperature !== undefined) {
    profile.options = profile.options || {};
    profile.options.temperature = options.temperature;
  }
  if (options.maxTokens !== undefined) {
    profile.options = profile.options || {};
    profile.options.maxTokens = options.maxTokens;
  }
  if (options.drafterModel) {
    profile.drafterModel = options.drafterModel;
    logger.info(chalk.gray(`⚡ Drafter model: ${options.drafterModel}`));
  }
  if (options.draftBlockSize !== undefined && Number.isInteger(options.draftBlockSize) && options.draftBlockSize > 0) {
    profile.draftBlockSize = options.draftBlockSize;
    logger.info(chalk.gray(`⚡ Draft block size: ${options.draftBlockSize}`));
  }
  if (options.cache !== undefined) {
    profile.options = profile.options || {};
    profile.options.cache = options.cache;
  }
  if (profile.cacheDir) {
    const base = options.profilePath ? dirname(resolve(options.profilePath)) : process.cwd();
    profile.cacheDir = resolve(base, profile.cacheDir);
  }

  // Resolve log path: CLI -l overrides profile.logPath (Commander may pass true for -l without value)
  const cliLogPath = typeof options.logPath === 'string' ? options.logPath : undefined;
  const logPath = cliLogPath ?? (profile.logPath
    ? (options.profilePath
        ? resolve(dirname(resolve(options.profilePath)), profile.logPath)
        : resolve(profile.logPath))
    : undefined);

  // Show log only mode
  if (options.showLogOnly && logPath) {
    const chatLog = await loadChatLog(logPath);
    displayChatLog(chatLog);
    return;
  }

  // Load or create chat log
  let chatLog: ChatLog;
  if (logPath) {
    try {
      chatLog = await loadChatLog(logPath);
      chatLog.profile = profile;
    } catch {
      chatLog = createChatLog(profile);
    }
  } else {
    chatLog = createChatLog(profile);
  }

  // Add pre-message if this is a new session
  if (chatLog.messages.length === 0) {
    if (profile.preMessage) {
      addMessage(chatLog, 'assistant', profile.preMessage);
      logger.info(chalk.cyan('Assistant: ') + profile.preMessage);
    }
  }

  // Get user message
  const userMessage = await getUserMessage(options);

  // Load resource files as materials
  let materials: MaterialContext['materials'];
  let loadedFiles: string[] = [];
  if (profile.resourceFiles && profile.resourceFiles.length > 0) {
    const spinner = new Spinner();
    spinner.start('Loading resource files...');

    const resourceResult = await loadResourceFiles(
      profile.resourceFiles,
      options.profilePath
    );
    materials = resourceResult.materials;
    loadedFiles = resourceResult.loadedFiles;

    spinner.stop();
    if (loadedFiles.length > 0) {
      logger.info(chalk.gray(`✓ Loaded ${loadedFiles.length} resource file(s)`));
    }
  }

  // Validate and resolve image paths
  let resolvedImages: string[] | undefined;
  if (options.images && options.images.length > 0) {
    resolvedImages = [];
    for (const imagePath of options.images) {
      const resolved = resolve(imagePath);
      if (!existsSync(resolved)) {
        throw new Error(`Image file not found: ${imagePath}`);
      }
      resolvedImages.push(resolved);
    }
    logger.info(chalk.gray(`🖼 ${resolvedImages.length} image(s) attached`));
  }

  // Add user message to log
  addMessage(chatLog, 'user', userMessage, loadedFiles, resolvedImages);
  logger.info(chalk.green('User: ') + userMessage);

  // Perform AI chat
  const { response, driver } = await performAIChat(profile, chatLog, userMessage, {
    materials,
    modelOverrides,
  });

  // Add assistant response to log
  addMessage(chatLog, 'assistant', response);

  // Save chat log if path is specified
  if (logPath) {
    await saveChatLog(chatLog, logPath);
    logger.info(chalk.gray(`💾 Chat log saved to: ${logPath}`));
  }

  // Close driver
  await closeDriver(driver);
}
