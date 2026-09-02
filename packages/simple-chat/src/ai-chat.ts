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
  AIService,
  resolveModelsConfig,
  resolveModelReference,
  resolveModelName,
  resolveDefaultModelFromConfig,
  RuntimeNotReadyError,
} from '@modular-prompt/driver';
import { formatRuntimeNotReadyMessage } from './runtime-status.js';
import {
  buildMlxDriverOptions,
  resolveInferenceSelection,
} from './inference-selection.js';
import { BUNDLED_MODELS_CONFIG } from './default-models.js';
import type { DialogProfile, ChatLog, WorkflowMode } from './types.js';
import chalk from 'chalk';
import { Spinner } from './spinner.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('ai');

/**
 * Chat context interface
 */
export interface ChatContext {
  messages: Array<{ role: string; content: string | Attachment[] }>;
  userMessage: string;
}

/**
 * Base chat prompt module - chat infrastructure
 */
const baseChatModule: PromptModule<ChatContext> = {
  createContext: (): ChatContext => ({
    messages: [],
    userMessage: ''
  }),

  instructions: [
    '- 日本語で応答してください',
  ],

  guidelines: [],

  messages: [
    (ctx) => {
      if (ctx.messages.length === 0) {
        return null;
      }
      return ctx.messages.map((m, i) => ({
        type: 'message' as const,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        cacheHint: i < ctx.messages.length - 1 ? ('immutable' as const) : undefined,
      }));
    }
  ],
};

/**
 * Build chat prompt module from profile
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
  if (mc?.drivers) overlay.drivers = mc.drivers;
  if (profile.drivers) {
    overlay.drivers = { ...(overlay.drivers ?? {}), ...profile.drivers };
  }

  if (Object.keys(overlay).length === 0) {
    return undefined;
  }
  return overlay;
}

/**
 * bundled + user + profile から ModelsConfig を解決する
 */
export function resolveProfileModelsConfig(profile: DialogProfile): ModelsConfig {
  const mode = profile.modelsConfig?.mode ?? 'merge';

  return resolveModelsConfig({
    base: BUNDLED_MODELS_CONFIG,
    overlay: buildModelsOverlay(profile),
    source: 'merge',
    mode,
  });
}

/**
 * Profile と models 設定から使用する ModelSpec を解決する（テスト・デバッグ用）
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
    if (modelRef.provider && modelRef.model) {
      return attachDriverOptions({
        model: modelRef.model,
        provider: resolveProvider(modelRef.provider as DriverProvider),
        capabilities: [],
      });
    }
    throw new Error(
      'workflow.models.default is incomplete: specify ref or provider+model',
    );
  }

  if (profile.model) {
    const spec = resolveModelName(profile.model, resolvedModels, inferProvider);
    return attachDriverOptions({
      ...spec,
      provider: resolveProvider(spec.provider),
    });
  }

  const defaultFromConfig = resolveDefaultModelFromConfig(resolvedModels);
  if (!defaultFromConfig) {
    throw new Error('No model configured: specify -m, profile.model, workflow.models.default, or models.default');
  }

  return attachDriverOptions({
    ...defaultFromConfig,
    provider: resolveProvider(defaultFromConfig.provider),
  });
}

/**
 * Create AIService from profile configuration
 */
export function createAIService(profile: DialogProfile): AIService {
  const resolvedModels = resolveProfileModelsConfig(profile);

  return AIService.fromModelsConfig({
    source: 'overlay',
    overlay: resolvedModels,
    defaultOptions: profile.options,
  });
}

/**
 * Create driver from profile configuration
 */
export async function createDriver(profile: DialogProfile): Promise<AIDriver> {
  const ai = createAIService(profile);
  const spec = resolveProfileModelSpec(profile);
  return ai.createDriver(spec);
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
    if (error instanceof RuntimeNotReadyError) {
      logger.error(formatRuntimeNotReadyMessage(error.profile, error.setupCommand));
      throw error;
    }
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
