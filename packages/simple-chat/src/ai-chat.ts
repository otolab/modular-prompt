/**
 * AI chat functionality using Moduler Prompt
 */

import type { PromptModule, Attachment } from '@modular-prompt/core';
import { merge, compile, createContext } from '@modular-prompt/core';
import { withMaterials, type MaterialContext } from '@modular-prompt/process';
import { defaultProcess, agenticProcess } from '@modular-prompt/process';
import {
  type AIDriver,
  type DriverProvider,
  DriverRegistry,
  registerFactories,
  type ApplicationConfig,
} from '@modular-prompt/driver';
import type { DialogProfile, ChatLog, WorkflowMode } from './types.js';
import chalk from 'chalk';
import { Spinner } from './spinner.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('ai');

const DEFAULT_MODEL = 'LiquidAI/LFM2.5-1.2B-JP-MLX-4bit';

/**
 * Chat context interface
 */
export interface ChatContext {
  messages: Array<{ role: string; content: string | Attachment[] }>;
  userMessage: string;
}

/**
 * Base chat prompt module - chat infrastructure
 * Provides default instructions and conversation history handling.
 * User-defined module (from profile) is merged on top of this.
 */
const baseChatModule: PromptModule<ChatContext> = {
  // Context factory - returns empty typed context
  createContext: (): ChatContext => ({
    messages: [],
    userMessage: ''
  }),

  // Instructions - 具体的な指示
  instructions: [
    '- 日本語で応答してください',
  ],

  // Guidelines - 制約や注意事項
  guidelines: [],

  // Messages - 会話履歴
  messages: [
    (ctx) => {
      if (ctx.messages.length === 0) {
        return null;
      }
      // 最新10件の会話履歴をMessageElementとして返す
      const recentMessages = ctx.messages.slice(-10);
      return recentMessages.map(m => ({
        type: 'message' as const,
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));
    }
  ],
};

/**
 * Build chat prompt module from profile
 * Merges baseChatModule + withMaterials + profile.module
 */
export function buildChatModule(profile: DialogProfile): PromptModule<ChatContext & MaterialContext> {
  if (!profile.module) return baseChatModule;
  return merge(baseChatModule, withMaterials, profile.module as PromptModule<any>);
}

/**
 * Infer provider from model name
 */
function inferProvider(model: string): DriverProvider {
  if (model.startsWith('test-')) return 'test' as DriverProvider;
  if (model.startsWith('echo-')) return 'echo';
  return 'mlx';
}

/**
 * Create driver from profile configuration
 */
export async function createDriver(profile: DialogProfile): Promise<AIDriver> {
  const registry = new DriverRegistry();
  const appConfig: ApplicationConfig = {
    drivers: profile.drivers,
    defaultOptions: profile.options,
  };
  registerFactories(registry, appConfig);

  // 1. workflow.models.default があればそれを使う
  const modelRef = profile.workflow?.models?.default;
  if (modelRef) {
    return registry.createDriver({
      model: modelRef.model,
      provider: modelRef.provider as DriverProvider,
      capabilities: [],
    });
  }

  // 2. CLI -m オーバーライド
  if (profile.model) {
    return registry.createDriver({
      model: profile.model,
      provider: inferProvider(profile.model),
      capabilities: [],
    });
  }

  // 3. デフォルト: MLX ローカル
  return registry.createDriver({
    model: DEFAULT_MODEL,
    provider: 'mlx',
    capabilities: [],
  });
}

/**
 * Build chat context from profile and chat log
 */
function buildChatContext(
  chatModule: PromptModule<ChatContext & MaterialContext>,
  chatLog: ChatLog,
  userMessage: string,
  materials?: MaterialContext['materials'],
): ChatContext & MaterialContext {
  const context = createContext(chatModule);

  context.messages = chatLog.messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.images && m.images.length > 0) {
        const attachments: Attachment[] = [
          { type: 'text', text: m.content },
          ...m.images.map(p => ({ type: 'image_url' as const, image_url: { url: p } }))
        ];
        return { role: m.role, content: attachments };
      }
      return { role: m.role, content: m.content };
    });
  context.userMessage = userMessage;
  context.materials = materials;

  return context;
}

/**
 * Execute direct mode (streamQuery)
 */
async function executeDirect(
  driver: AIDriver,
  chatModule: PromptModule<ChatContext & MaterialContext>,
  chatLog: ChatLog,
  userMessage: string,
  options?: DialogProfile['options'],
  materials?: MaterialContext['materials'],
): Promise<string> {
  const context = buildChatContext(chatModule, chatLog, userMessage, materials);
  const compiledPrompt = compile(chatModule, context);

  if (driver.streamQuery) {
    logger.info(chalk.cyan('Assistant:'));
    let response = '';
    const streamResult = await driver.streamQuery(compiledPrompt, options);
    for await (const chunk of streamResult.stream) {
      process.stdout.write(chunk);
      response += chunk;
    }
    process.stdout.write('\n\n');
    return response;
  }

  // Fallback to non-streaming
  const result = await driver.query(compiledPrompt, options);
  logger.info(chalk.cyan('Assistant: ') + result.content);
  return result.content;
}

/**
 * Execute default mode (defaultProcess)
 */
async function executeDefault(
  driver: AIDriver,
  chatModule: PromptModule<ChatContext & MaterialContext>,
  chatLog: ChatLog,
  userMessage: string,
  options?: DialogProfile['options'],
  materials?: MaterialContext['materials'],
): Promise<string> {
  const context = buildChatContext(chatModule, chatLog, userMessage, materials);
  const result = await defaultProcess(driver, chatModule, context, {
    queryOptions: options,
  });
  logger.info(chalk.cyan('Assistant: ') + result.output);
  return result.output;
}

/**
 * Execute agentic mode (agenticProcess)
 */
async function executeAgentic(
  driver: AIDriver,
  chatModule: PromptModule<ChatContext & MaterialContext>,
  chatLog: ChatLog,
  userMessage: string,
  profile: DialogProfile,
  materials?: MaterialContext['materials'],
): Promise<string> {
  const context = buildChatContext(chatModule, chatLog, userMessage, materials);
  const processOptions = profile.workflow?.processOptions;
  const result = await agenticProcess(driver, chatModule, context, {
    maxTasks: processOptions?.maxTasks ?? 10,
    includeThinking: processOptions?.includeThinking ?? false,
  });
  logger.info(chalk.cyan('Assistant: ') + result.output);
  return result.output;
}

/**
 * Perform AI chat
 */
export async function performAIChat(
  profile: DialogProfile,
  chatLog: ChatLog,
  userMessage: string,
  materials?: MaterialContext['materials'],
  images?: string[],
  overrideDriver?: AIDriver,
): Promise<{ response: string; driver: AIDriver }> {
  const spinner = new Spinner();

  spinner.start('Initializing AI driver...');
  const driver = overrideDriver ?? await createDriver(profile);

  try {
    spinner.update('Preparing context...');

    const chatModule = buildChatModule(profile);
    const mode: WorkflowMode = profile.workflow?.mode ?? 'direct';
    let response: string;

    spinner.stop();

    switch (mode) {
      case 'direct':
        response = await executeDirect(driver, chatModule, chatLog, userMessage, profile.options, materials);
        break;
      case 'default':
        response = await executeDefault(driver, chatModule, chatLog, userMessage, profile.options, materials);
        break;
      case 'agentic':
        response = await executeAgentic(driver, chatModule, chatLog, userMessage, profile, materials);
        break;
      default:
        throw new Error(`Unknown workflow mode: ${mode}`);
    }

    return { response, driver };
  } catch (error) {
    spinner.stop();
    logger.error(`AI chat error: ${error}`);
    throw error;
  }
}

/**
 * Close driver connection
 */
export async function closeDriver(driver: AIDriver): Promise<void> {
  if (driver.close) {
    await driver.close();
  }
}
