import { describe, it, expect, vi } from 'vitest';
import { MlxDriver } from './mlx-driver.js';

// Mock the MlxProcess
vi.mock('./process/index.js', () => ({
  MlxProcess: vi.fn().mockImplementation(() => ({
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({
      methods: ['chat', 'completion', 'format_test', 'capabilities'],
      special_tokens: {
        eod: { text: '<|endoftext|>', id: 0 },
        system: {
          start: { text: '<|system|>', id: 1 },
          end: { text: '<|/system|>', id: 2 }
        },
        user: {
          start: { text: '<|user|>', id: 3 },
          end: { text: '<|/user|>', id: 4 }
        },
        assistant: {
          start: { text: '<|assistant|>', id: 5 },
          end: { text: '<|/assistant|>', id: 6 }
        },
        code: {
          start: { text: '<|code_start|>', id: 7 },
          end: { text: '<|code_end|>', id: 8 }
        },
        thinking: {
          start: { text: '<|thinking|>', id: 9 },
          end: { text: '</thinking>', id: 10 }
        }
      },
      features: {
        apply_chat_template: true,
        vocab_size: 32000,
        model_max_length: 4096,
        chat_template: {
          template_string: 'some_template',
          supported_roles: ['system', 'user', 'assistant'],
          preview: null,
          constraints: {}
        }
      }
    }),
    getStatus: vi.fn().mockReturnValue({ modelSpec: true }),
    getSpecManager: vi.fn().mockReturnValue({
      canUseChat: vi.fn().mockReturnValue(true),
      canUseCompletion: vi.fn().mockReturnValue(true),
      preprocessMessages: vi.fn((msgs) => msgs),
      determineApi: vi.fn().mockReturnValue('chat')
    }),
    chat: vi.fn(),
    completion: vi.fn(),
    exit: vi.fn()
  }))
}));

describe('MlxDriver', () => {
  describe('initialization', () => {
    it('should initialize process and cache capabilities', async () => {
      const driver = new MlxDriver({
        model: 'test-model'
      });

      // Access private method through type assertion for testing
      // @ts-expect-error - Accessing private method for testing
      const ensureInitialized = driver.ensureInitialized.bind(driver);
      await ensureInitialized();

      // Verify process was initialized
      // @ts-expect-error - Accessing private property for testing
      const process = driver.process;
      expect(process.ensureInitialized).toHaveBeenCalled();
      expect(process.getCapabilities).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      const driver = new MlxDriver({
        model: 'test-model'
      });

      // Mock error
      // @ts-expect-error - Accessing private property for testing
      const process = driver.process;
      process.getCapabilities.mockRejectedValueOnce(new Error('Process error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // @ts-expect-error - Accessing private method for testing
      const ensureInitialized = driver.ensureInitialized.bind(driver);
      await ensureInitialized();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get MLX runtime info:')
      );

      consoleSpy.mockRestore();
    });

  });
});