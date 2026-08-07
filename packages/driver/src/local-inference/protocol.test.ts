import { describe, expect, it } from 'vitest';
import type {
  InferenceCapabilities,
  InferenceMessage,
} from './protocol.js';
import type {
  MlxRuntimeInfo,
  MlxMessage,
  MlxChatRequest,
} from '../mlx-ml/process/types.js';

describe('local-inference protocol aliases', () => {
  it('MlxRuntimeInfo is assignable from InferenceCapabilities', () => {
    const capabilities: InferenceCapabilities = {
      methods: ['capabilities', 'chat', 'completion'],
      special_tokens: {},
      features: {
        apply_chat_template: true,
      },
    };
    const runtimeInfo: MlxRuntimeInfo = capabilities;
    expect(runtimeInfo.methods).toContain('chat');
  });

  it('MlxMessage accepts InferenceMessage shapes', () => {
    const message: InferenceMessage = {
      role: 'user',
      content: 'hello',
    };
    const mlxMessage: MlxMessage = message;
    expect(mlxMessage.role).toBe('user');
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
