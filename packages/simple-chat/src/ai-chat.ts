/**
 * AI chat functionality using Moduler Prompt
 */

import type { PromptModule } from '@modular-prompt/core';
import { merge, compile, createContext } from '@modular-prompt/core';
import { withMaterials, type MaterialContext } from '@modular-prompt/process';
import { type AIDriver, type DriverCapability, MlxDriver, DriverRegistry } from '@modular-prompt/driver';
import type { DialogProfile, ChatLog } from './types.js';
import chalk from 'chalk';
import { Spinner } from './spinner.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('ai');

const DEFAULT_DRIVER = 'LiquidAI/LFM2.5-1.2B-JP-MLX-4bit';

/**
 * Chat context interface
 */
export interface ChatContext {
  messages: Array<{ role: string; content: string }>;
  userMessage: string;
  systemPrompt?: string;
}

/**
 * Base chat prompt module (without materials)
 */
const baseChatModule: PromptModule<ChatContext> = {
  // Context factory - returns empty typed context
  createContext: (): ChatContext => ({
    messages: [],
    userMessage: ''
  }),
  
  // Objective and Role
  objective: [
    (ctx) => ctx.systemPrompt ? [
      ctx.systemPrompt,
      ''  // 空行で区切る
    ] : [
      'Respondeo, ergo credis me esse.',
      '',
      '- チャットアシスタントとして、最新のユーザメッセージに対する返答メッセージを作成する',
    ]
  ],
  
  // Instructions - 具体的な指示
  instructions: [
    '- 日本語で応答してください',
    '- コンテキストの理解を重視してください',
    '- 不確実な情報は不確実であると明確に伝えてください',
    {
      type: 'subsection',
      title: '応答形式',
      items: [
        '- 日本語の対話として自然になるように務めます',
        '- 質問内容に対して応答する量を調整してください',
        '  - 挨拶であれば: 簡単に返す',
        '  - 質問であれば: 必要な情報を過不足なく返す',
      ]
    }
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
  
  // Cue - 出力の開始
  // cue: [
  //   (ctx) => `user: ${ctx.userMessage}`,
  //   '',
  //   'assistant:'
  // ]
};

/**
 * Chat prompt module with materials support (merged)
 */
export const chatPromptModule = merge(baseChatModule, withMaterials);

// ドライバレジストリのシングルトンインスタンス
let driverRegistry: DriverRegistry | null = null;

/**
 * Initialize driver registry
 */
function initializeRegistry(): DriverRegistry {
  // 既存のレジストリがあれば再利用
  if (driverRegistry) {
    return driverRegistry;
  }

  driverRegistry = new DriverRegistry();

  // デフォルトモデルを登録
  driverRegistry.registerModel({
    model: DEFAULT_DRIVER,
    provider: 'mlx',
    capabilities: ['local', 'fast', 'chat'],
    priority: 10
  });

  return driverRegistry;
}

/**
 * Create driver from profile
 */
export async function createDriver(profile: DialogProfile, customRegistry?: DriverRegistry): Promise<AIDriver> {
  const registry = customRegistry || initializeRegistry();

  // プロファイルで明示的にモデルが指定されている場合
  if (profile.model) {
    // モデル名でドライバを選択して作成
    // test-chat -> test provider
    // echo-* -> echo provider
    // それ以外 -> mlx provider
    let provider: any = 'mlx';
    if (profile.model.startsWith('test-')) {
      provider = 'test';
    } else if (profile.model.startsWith('echo-')) {
      provider = 'echo';
    }

    try {
      const modelSpec = {
        model: profile.model,
        provider,
        capabilities: ['chat'] as DriverCapability[]
      };
      return await registry.createDriver(modelSpec);
    } catch {
      // 見つからない場合は、MLXドライバとして直接作成
      logger.warn(`Model ${profile.model} not found in registry, using MLX driver directly`);
      return new MlxDriver({
        model: profile.model,
        defaultOptions: profile.options
      });
    }
  }

  // モデルが指定されていない場合、チャット対応の最適なドライバを選択
  const driver = await registry.selectAndCreateDriver(
    ['chat'],
    { preferLocal: true }
  );

  if (!driver) {
    // フォールバック: MLXドライバを直接作成
    return new MlxDriver({
      model: DEFAULT_DRIVER,
      defaultOptions: profile.options
    });
  }

  return driver;
}

/**
 * Perform AI chat
 */
export async function performAIChat(
  profile: DialogProfile,
  chatLog: ChatLog,
  userMessage: string,
  materials?: MaterialContext['materials'],
  customRegistry?: DriverRegistry
): Promise<{ response: string; driver: AIDriver }> {
  const spinner = new Spinner();

  // Start spinner while creating driver
  spinner.start('Initializing AI driver...');
  const driver = await createDriver(profile, customRegistry);

  try {
    // Update spinner for context creation
    spinner.update('Preparing context...');

    // Create empty typed context from module
    const context = createContext(chatPromptModule);

    // Populate context with actual data
    context.messages = chatLog.messages.filter(m => m.role !== 'system');
    context.userMessage = userMessage;
    context.materials = materials;
    context.systemPrompt = profile.systemPrompt;

    // Compile module with populated context
    spinner.update('Compiling prompt...');
    const compiledPrompt = compile(chatPromptModule, context);

    // Update spinner for AI query
    spinner.update('Waiting for AI response...');

    // Query AI with streaming
    if (driver.streamQuery) {
      // Stop spinner before streaming starts
      spinner.stop();
      logger.info(chalk.cyan('Assistant:'));

      let response = '';
      const streamResult = await driver.streamQuery(compiledPrompt, profile.options);
      for await (const chunk of streamResult.stream) {
        process.stdout.write(chunk);
        response += chunk;
      }
      process.stdout.write('\n\n');

      return { response, driver };
    } else {
      // Fallback to non-streaming
      const result = await driver.query(compiledPrompt, profile.options);
      spinner.stop();
      logger.info(chalk.cyan('Assistant: ') + result.content);
      return { response: result.content, driver };
    }
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