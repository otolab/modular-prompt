/**
 * Main chat processing
 */

import { readFileSync } from 'fs';
import chalk from 'chalk';
import type {
  DialogProfile,
  ChatLog,
  SimpleChatOptions
} from './types.js';
import {
  getDefaultProfile,
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
import { loadResourceFiles } from './resource-files.js';
import type { MaterialContext } from '@modular-prompt/process';
import { Spinner } from './spinner.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('chat');

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
  }
}

/**
 * Run chat session
 */
export async function runChat(options: SimpleChatOptions): Promise<void> {
  // Show log only mode
  if (options.showLogOnly && options.logPath) {
    const chatLog = await loadChatLog(options.logPath);
    displayChatLog(chatLog);
    return;
  }
  
  // Load or create profile
  let profile: DialogProfile;
  if (options.profilePath) {
    profile = await loadDialogProfile(options.profilePath);
  } else {
    profile = getDefaultProfile();
  }
  
  // Apply overrides
  if (options.model) profile.model = options.model;
  if (options.temperature !== undefined) {
    profile.options = profile.options || {};
    profile.options.temperature = options.temperature;
  }
  if (options.maxTokens !== undefined) {
    profile.options = profile.options || {};
    profile.options.maxTokens = options.maxTokens;
  }
  
  // Load or create chat log
  let chatLog: ChatLog;
  if (options.logPath) {
    try {
      chatLog = await loadChatLog(options.logPath);
      // Update profile in existing log
      chatLog.profile = profile;
    } catch {
      // Create new log if file doesn't exist
      chatLog = createChatLog(profile);
    }
  } else {
    chatLog = createChatLog(profile);
  }
  
  // Add system message if this is a new session
  if (chatLog.messages.length === 0) {
    addMessage(chatLog, 'system', profile.systemPrompt);
    
    // Add pre-message if defined
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
  
  // Add user message to log
  addMessage(chatLog, 'user', userMessage, loadedFiles);
  logger.info(chalk.green('User: ') + userMessage);
  
  // Perform AI chat with optional custom drivers config
  const { response, driver } = await performAIChat(
    profile,
    chatLog,
    userMessage,
    materials,
    undefined  // customRegistry
  );
  
  // Add assistant response to log
  addMessage(chatLog, 'assistant', response);
  
  // Save chat log if path is specified
  if (options.logPath) {
    await saveChatLog(chatLog, options.logPath);
    logger.info(chalk.gray(`💾 Chat log saved to: ${options.logPath}`));
  }
  
  // Close driver
  await closeDriver(driver);
}