/**
 * AI chat functionality using Moduler Prompt
 */

/* eslint-disable no-console */

import type { PromptModule} from '@modular-prompt/core';
import { compile, createContext, merge } from '@modular-prompt/core';
import { withMaterials, type MaterialContext } from '@modular-prompt/process';
import { type AIDriver, type DriverCapability, MlxDriver, DriverRegistry } from '@modular-prompt/driver';
import type { DialogProfile, ChatLog } from './types.js';
import chalk from 'chalk';
import { Spinner } from './spinner.js';

/**
 * Chat context interface
 */
export interface ChatContext extends MaterialContext {
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
      'チャットアシスタントとして、ユーザーとの対話を行う',
      'ユーザーの質問や要求に対して、適切で有用な応答を提供する'
    ]
  ],
  
  // Instructions - 具体的な指示
  instructions: [
    '日本語で応答してください',
    'ユーザーの質問の意図を理解し、的確に回答してください',
    '必要に応じて具体例を提示してください',
    {
      type: 'subsection',
      title: '応答形式',
      items: [
        '簡潔で明確な説明を心がける',
        '専門用語は分かりやすく解説する',
        '段階的に説明する'
      ]
    }
  ],
  
  // Guidelines - 制約や注意事項
  guidelines: [
    'ユーザーの理解度に合わせて説明のレベルを調整する',
    '不確実な情報は明確に伝える',
    '適切な敬語を使用する'
  ],
  
  // Messages - 会話履歴
  messages: [
    (ctx) => {
      if (ctx.messages.length === 0) {
        return null;
      }
      // 最新10件の会話履歴を含める
      const recentMessages = ctx.messages.slice(-10);
      return recentMessages.map(m => `${m.role}: ${m.content}`);
    }
  ],
  
  // Cue - 出力の開始
  cue: [
    (ctx) => `user: ${ctx.userMessage}`,
    '',
    'assistant:'
  ]
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
    model: 'mlx-community/gemma-3-270m-it-qat-4bit',
    provider: 'mlx',
    capabilities: ['local', 'streaming', 'chat'],
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
      console.warn(chalk.yellow(`Model ${profile.model} not found in registry, using MLX driver directly`));
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
      model: 'mlx-community/gemma-3-270m-it-qat-4bit',
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
      console.log(chalk.cyan('\nAssistant: '));

      let response = '';
      const streamResult = await driver.streamQuery(compiledPrompt, profile.options);
      for await (const chunk of streamResult.stream) {
        process.stdout.write(chunk);
        response += chunk;
      }
      console.log('\n');

      return { response, driver };
    } else {
      // Fallback to non-streaming
      const result = await driver.query(compiledPrompt, profile.options);
      spinner.stop();
      console.log(chalk.cyan('\nAssistant: ') + result.content + '\n');
      return { response: result.content, driver };
    }
  } catch (error) {
    spinner.stop();
    console.error(chalk.red(`\n❌ AI chat error: ${error}`));
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