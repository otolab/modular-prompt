import { describe, expect, it } from 'vitest';
import type {
  InferenceCapabilities,
  InferenceMessage,
} from './protocol.js';
import type {
  MlxRuntimeInfo,
  MlxMessage as ProcessMlxMessage,
  MlxChatRequest,
} from '../mlx-ml/process/types.js';
import type { MlxMessage as PublicMlxMessage } from '../mlx-ml/types.js';

describe('local-inference protocol aliases', () => {
  const sampleCapabilities: InferenceCapabilities = {
    methods: ['capabilities', 'render', 'completion'],
    special_tokens: {},
    features: {
      apply_chat_template: true,
    },
  };

  const sampleMessage: InferenceMessage = {
    role: 'user',
    content: 'hello',
  };

  it('MlxRuntimeInfo is assignable from InferenceCapabilities', () => {
    const runtimeInfo: MlxRuntimeInfo = sampleCapabilities;
    expect(runtimeInfo.methods).toContain('render');
  });

  it('InferenceCapabilities is assignable from MlxRuntimeInfo', () => {
    const runtimeInfo: MlxRuntimeInfo = sampleCapabilities;
    const capabilities: InferenceCapabilities = runtimeInfo;
    expect(capabilities.features.apply_chat_template).toBe(true);
  });

  it('process MlxMessage accepts InferenceMessage shapes', () => {
    const mlxMessage: ProcessMlxMessage = sampleMessage;
    expect(mlxMessage.role).toBe('user');
  });

  it('InferenceMessage accepts process MlxMessage shapes', () => {
    const mlxMessage: ProcessMlxMessage = sampleMessage;
    const message: InferenceMessage = mlxMessage;
    expect(message.content).toBe('hello');
  });

  it('public MlxMessage and process MlxMessage are mutually assignable', () => {
    const fromPublic: PublicMlxMessage = sampleMessage;
    const toProcess: ProcessMlxMessage = fromPublic;
    const backToPublic: PublicMlxMessage = toProcess;
    expect(backToPublic.role).toBe('user');
  });

  it('MlxChatRequest accepts MlxMlModelOptions in camelCase', () => {
    const request: MlxChatRequest = {
      method: 'chat',
      messages: [{ role: 'user', content: 'hi' }],
      options: {
        maxTokens: 100,
        temperature: 0.7,
      },
    };
    expect(request.options?.maxTokens).toBe(100);
  });
});
