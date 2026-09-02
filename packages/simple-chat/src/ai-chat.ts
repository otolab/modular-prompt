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
import type { DialogProfile, ChatLog, WorkflowMode, ModelOverrides } from './types.js';
import chalk from 'chalk';
import { Spinner } from './spinner.js';
import { logger as baseLogger } from './logger.js';

const logger = baseLogger.context('ai');

export interface ChatContext {
  messages: Array<{ role: string; content: string | Attachment[] }>;
  userMessage: string;
}

/** performAIChat のオプション */
export interface AIChatRunOptions {
  materials?: MaterialContext['materials'];
  modelOverrides?: ModelOverrides;
  overrideDriver?: AIDriver;
}

const baseChatModule: PromptModule<ChatContext> = {
  createContext: (): ChatContext => ({
    messages: [],
    userMessage: '',
  }),
  instructions: ['- 日本語で応答してください'],
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
    },
  ],
};

export function buildChatModule(profile: DialogProfile): PromptModule<ChatContext & MaterialContext> {
  if (!profile.module) return baseChatModule;
  return merge(baseChatModule, withMaterials, profile.module as PromptModule<any>);
}

function inferProvider(model: string): DriverProvider {
  if (model.startsWith('test-')) return 'test' as DriverProvider;
  if (model.startsWith('echo-')) return 'echo';
  return 'mlx';
}

function profileModelsOverlay(profile: DialogProfile): ModelsConfig | undefined {
  const mc = profile.modelsConfig;
  const overlay: ModelsConfig = {};

  if (mc?.models) overlay.models = mc.models;
  const drivers = { ...mc?.drivers, ...profile.drivers };
  if (Object.keys(drivers).length > 0) overlay.drivers = drivers;

  return Object.keys(overlay).length > 0 ? overlay : undefined;
}

function createAIService(profile: DialogProfile): AIService {
  const mc = profile.modelsConfig;

  return AIService.fromMergedConfig(
    BUNDLED_MODELS_CONFIG,
    profileModelsOverlay(profile),
    { defaultOptions: profile.options, mode: mc?.mode ?? 'merge' },
  );
}

/** bundled + user + profile から ModelsConfig を解決する */
export function resolveMergedModels(profile: DialogProfile): ModelsConfig {
  return createAIService(profile).modelsConfig;
}

/**
 * profile と merged models から使用する ModelSpec を解決する
 *
 * 優先順位: override.model → profile.model → workflow.models.default → models.default
 */
export function resolveModelSpec(
  profile: DialogProfile,
  models: ModelsConfig,
  overrides?: ModelOverrides,
): ModelSpec {
  const selection = resolveInferenceSelection(profile, overrides);
  const mlxOptions = buildMlxDriverOptions(profile, selection.mlxBackend, overrides);

  const finalize = (spec: ModelSpec): ModelSpec => ({
    ...spec,
    provider: selection.provider ?? spec.provider,
    driverOptions: mlxOptions ?? spec.driverOptions,
  });

  const explicitModel = overrides?.model ?? profile.model;
  if (explicitModel) {
    return finalize(resolveModelName(explicitModel, models, inferProvider));
  }

  const workflowDefault = profile.workflow?.models?.default;
  if (workflowDefault) {
    const spec = resolveModelReference(workflowDefault, models);
    if (spec) return finalize(spec);
    if (workflowDefault.ref) {
      throw new Error(`Unknown model ref '${workflowDefault.ref}' in models configuration`);
    }
    throw new Error('workflow.models.default is incomplete: specify ref or provider+model');
  }

  const fallback = resolveDefaultModelFromConfig(models);
  if (!fallback) {
    throw new Error(
      'No model configured: specify -m, profile.model, workflow.models.default, or models.default',
    );
  }
  return finalize(fallback);
}

/** merged models 込みで ModelSpec を解決する（統合テスト・デバッグ用） */
export function resolveProfileModelSpec(
  profile: DialogProfile,
  overrides?: ModelOverrides,
): ModelSpec {
  const models = resolveMergedModels(profile);
  return resolveModelSpec(profile, models, overrides);
}

export async function createDriver(
  profile: DialogProfile,
  overrides?: ModelOverrides,
): Promise<AIDriver> {
  const ai = createAIService(profile);
  const spec = resolveModelSpec(profile, ai.modelsConfig, overrides);
  return ai.createDriver(spec);
}

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
          ...m.images.map(p => ({ type: 'image_url' as const, image_url: { url: p } })),
        ];
        return { role: m.role, content: attachments };
      }
      return { role: m.role, content: m.content };
    });
  context.userMessage = userMessage;
  context.materials = materials;

  return context;
}

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

export async function performAIChat(
  profile: DialogProfile,
  chatLog: ChatLog,
  userMessage: string,
  options?: AIChatRunOptions,
): Promise<{ response: string; driver: AIDriver }> {
  const spinner = new Spinner();

  spinner.start('Initializing AI driver...');
  const driver = options?.overrideDriver
    ?? await createDriver(profile, options?.modelOverrides);

  try {
    spinner.update('Preparing context...');

    const chatModule = buildChatModule(profile);
    const mode: WorkflowMode = profile.workflow?.mode ?? 'direct';
    let response: string;

    spinner.stop();

    switch (mode) {
      case 'direct':
        response = await executeDirect(
          driver, chatModule, chatLog, userMessage, profile.options, options?.materials,
        );
        break;
      case 'default':
        response = await executeDefault(
          driver, chatModule, chatLog, userMessage, profile.options, options?.materials,
        );
        break;
      case 'agentic':
        response = await executeAgentic(
          driver, chatModule, chatLog, userMessage, profile, options?.materials,
        );
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

export async function closeDriver(driver: AIDriver): Promise<void> {
  if (driver.close) {
    await driver.close();
  }
}
