import { LocalInferenceDriver } from '../local-inference/driver.js';
import type { InferenceCapabilities } from '../local-inference/protocol.js';
import type { FormatterOptions } from '../formatter/types.js';
import type { PyTorchQueryOptions } from './pytorch-options.js';
import { PyTorchProcess } from './process/index.js';
import { pytorchLocalInferenceAdapters } from './pytorch-local-inference-adapters.js';

export interface PyTorchModelCapabilities {
  methods: InferenceCapabilities['methods'];
  specialTokens: InferenceCapabilities['special_tokens'];
  features: {
    hasChatTemplate: boolean;
    vocabSize?: number;
    modelMaxLength?: number;
    chatTemplate?: InferenceCapabilities['features']['chat_template'];
  };
  chatRestrictions?: InferenceCapabilities['chat_restrictions'];
}

export interface PyTorchDriverConfig {
  model: string;
  defaultOptions?: Partial<PyTorchQueryOptions>;
  formatterOptions?: FormatterOptions;
  /** 外部 venv パス（未指定時は ~/.modular-prompt/runtimes/pytorch/.venv） */
  venvPath?: string;
  /** PYTORCH_DEVICE（例: cpu, cuda）。未指定時は Python 側で cpu */
  device?: string;
}

/**
 * Transformers + PyTorch バックエンド（LIP）。
 * 共通ロジックは LocalInferenceDriver に委譲する。
 */
export class PyTorchDriver extends LocalInferenceDriver {
  constructor(config: PyTorchDriverConfig) {
    const process = new PyTorchProcess(config.model, {
      venvPath: config.venvPath,
      device: config.device,
    });

    super({
      model: config.model,
      process,
      adapters: pytorchLocalInferenceAdapters,
      formatterOptions: config.formatterOptions,
      defaultOptions: config.defaultOptions,
      loggerPrefix: 'PyTorch',
    });
  }

  get defaultOptions(): Partial<PyTorchQueryOptions> {
    return super.defaultOptions as Partial<PyTorchQueryOptions>;
  }

  set defaultOptions(value: Partial<PyTorchQueryOptions>) {
    super.defaultOptions = value ?? {};
  }

  async getCapabilities(): Promise<PyTorchModelCapabilities> {
    await this.ensureInitialized();

    const runtimeInfo = this.getRuntimeInfo();
    if (!runtimeInfo) {
      throw new Error('Failed to retrieve model capabilities');
    }

    return {
      methods: runtimeInfo.methods,
      specialTokens: runtimeInfo.special_tokens,
      features: {
        hasChatTemplate: runtimeInfo.features.apply_chat_template,
        vocabSize: runtimeInfo.features.vocab_size,
        modelMaxLength: runtimeInfo.features.model_max_length,
        chatTemplate: runtimeInfo.features.chat_template,
      },
      chatRestrictions: runtimeInfo.chat_restrictions,
    };
  }
}
