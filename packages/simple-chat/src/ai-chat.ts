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
  type ModelSpec,
  type ModelsConfig,
  DriverRegistry,
  registerFactories,
  type ApplicationConfig,
  resolveModelsConfig,
  mergeModelsConfig,
  resolveModelReference,
  resolveDefaultModel,
} from '@modular-prompt/driver';
import {
  buildMlxDriverOptions,
  resolveInferenceSelection,
} from './inference-selection.js';
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
      return ctx.messages.map((m, i) => ({
        type: 'message' as const,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        // 最後のメッセージ（現在のユーザー入力）はimmutableにしない
        // そうしないと毎回hashが変わってキャッシュが効かなくなる
        cacheHint: i < ctx.messages.length - 1 ? ('immutable' as const) : undefined,
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
 * profile から overlay ModelsConfig を組み立てる
 */
function buildModelsOverlay(profile: DialogProfile): ModelsConfig | undefined {
  const overlay: ModelsConfig = {};
  const mc = profile.modelsConfig;

  if (mc?.models) overlay.models = mc.models;
  if (mc?.defaults) overlay.defaults = mc.defaults;
  if (mc?.drivers) overlay.drivers = mc.drivers;
  if (profile.drivers) {
    overlay.drivers = { ...(overlay.drivers ?? {}), ...profile.drivers };
  }

  if (Object.keys(overlay).length === 0) {
    return undefined;
  }
  return overlay;
}

function resolveProfileModelsConfig(profile: DialogProfile): ModelsConfig {
  return resolveModelsConfig({
    overlay: buildModelsOverlay(profile),
    mode: profile.modelsConfig?.mode,
  });
}

/**
 * Profile と models.yaml から使用する ModelSpec を解決する（テスト・デバッグ用）
 */
export function resolveProfileModelSpec(profile: DialogProfile): ModelSpec {
  const resolvedModels = resolveProfileModelsConfig(profile);

  const selection = resolveInferenceSelection(profile);
  const driverOptions = buildMlxDriverOptions(profile, selection.mlxBackend);

  const resolveProvider = (fallback: DriverProvider): DriverProvider =>
    selection.provider ?? fallback;

  const attachDriverOptions = (spec: ModelSpec): ModelSpec => ({
    ...spec,
    driverOptions: driverOptions ?? spec.driverOptions,
  });

  const modelRef = profile.workflow?.models?.default;
  if (modelRef) {
    const spec = resolveModelReference(modelRef, resolvedModels);
    if (spec) {
      return attachDriverOptions({
        ...spec,
        provider: resolveProvider(spec.provider),
      });
    }
    if (modelRef.ref) {
      throw new Error(
        `Unknown model ref '${modelRef.ref}' in models configuration`,
      );
    }
    if (modelRef.runtime) {
      throw new Error(
        `No default model for runtime '${modelRef.runtime}' in models configuration`,
      );
    }
    if (modelRef.provider && modelRef.model) {
      return attachDriverOptions({
        model: modelRef.model,
        provider: resolveProvider(modelRef.provider as DriverProvider),
        capabilities: [],
      });
    }
    throw new Error(
      'workflow.models.default is incomplete: specify ref, runtime, or provider+model',
    );
  }

  if (profile.model) {
    return attachDriverOptions({
      model: profile.model,
      provider: resolveProvider(inferProvider(profile.model)),
      capabilities: [],
    });
  }

  const defaultFromConfig = resolveDefaultModel('mlx-lm', resolvedModels);
  if (defaultFromConfig) {
    return attachDriverOptions({
      ...defaultFromConfig,
      provider: resolveProvider(defaultFromConfig.provider),
    });
  }

  return attachDriverOptions({
    model: DEFAULT_MODEL,
    provider: resolveProvider('mlx'),
    capabilities: [],
  });
}

/**
 * Create driver from profile configuration
 */
export async function createDriver(profile: DialogProfile): Promise<AIDriver> {
  const resolvedModels = resolveProfileModelsConfig(profile);

  const mergedConfig = mergeModelsConfig(resolvedModels, {
    defaultOptions: profile.options,
  });

  const registry = new DriverRegistry();
  const appConfig: ApplicationConfig = {
    drivers: mergedConfig.drivers,
    defaultOptions: mergedConfig.defaultOptions,
  };
  registerFactories(registry, appConfig);

  const spec = resolveProfileModelSpec(profile);
  return registry.createDriver(spec);
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
  logger.info(chalk.cyan('Assistant:'));
  process.stdout.write(result.content + '\n\n');
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
  logger.info(chalk.cyan('Assistant:'));
  process.stdout.write(result.output + '\n\n');
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
  logger.info(chalk.cyan('Assistant:'));
  process.stdout.write(result.output + '\n\n');
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
