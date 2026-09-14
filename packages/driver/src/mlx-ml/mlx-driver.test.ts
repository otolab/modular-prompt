import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { MlxDriver } from './mlx-driver.js';
import { MlxCacheController } from './mlx-cache-controller.js';
import { convertMessages } from './mlx-message-utils.js';
import type { ChatMessage } from '../formatter/types.js';

const META_MARKER = '\x1e__META__:';

// Mock the MlxProcess
vi.mock('./process/index.js', () => ({
  MlxProcess: vi.fn().mockImplementation(() => ({
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    getCapabilities: vi.fn().mockResolvedValue({
      methods: ['render', 'completion', 'format_test', 'capabilities', 'generate'],
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
    render: vi.fn(),
    tokenize: vi.fn(),
    cachePrefill: vi.fn(),
    completion: vi.fn(),
    generate: vi.fn(),
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
        expect.stringContaining('Failed to get runtime info:')
      );

      consoleSpy.mockRestore();
    });

  });

  describe('VLM prompt cache', () => {
    it('keeps VLM cache in memory and reports read/write usage', async () => {
      const cacheController = new MlxCacheController({ cacheDir: '/ignored-for-vlm' });
      const driver = new MlxDriver({
        model: 'test-vlm',
        cacheController,
      });
      const process = (driver as unknown as {
        process: {
          getCapabilities: ReturnType<typeof vi.fn>;
          render: ReturnType<typeof vi.fn>;
          generate: ReturnType<typeof vi.fn>;
          cachePrefill: ReturnType<typeof vi.fn>;
        };
      }).process;
      process.getCapabilities.mockResolvedValueOnce({
        methods: ['render', 'generate', 'cache_prefill'],
        model_kind: 'vlm',
        special_tokens: {},
        features: {
          apply_chat_template: true,
          vocab_size: 32000,
          model_max_length: 4096,
          chat_template: {
            supported_roles: ['system', 'user', 'assistant'],
            preview: null,
            constraints: {},
          },
        },
      });
      process.render.mockResolvedValue({ formatted_prompt: 'rendered', error: null });
      process.cachePrefill.mockResolvedValue({
        cache_path: 'mlx-vlm-memory://backend-ref',
        token_count: 3,
      });
      process.generate.mockResolvedValue(
        Readable.from([`ok${META_MARKER}{"cache_loaded":true}`]),
      );

      const result = await driver.query({
        instructions: [{ type: 'text', content: 'system prompt' }],
        data: [],
        output: [],
      }, { cache: true });

      expect(result.usage?.cacheReadTokens).toBe(3);
      expect(result.usage?.cacheWriteTokens).toBe(3);
      expect(process.cachePrefill).toHaveBeenCalledOnce();
      expect(process.generate).toHaveBeenCalledWith(
        'rendered',
        expect.any(Object),
        undefined,
        undefined,
        expect.stringMatching(/^mlx-vlm-memory:\/\//),
        undefined,
      );

      await driver.close();
    });

    it('does not report a cache read when VLM cache loading fails', async () => {
      const cacheController = new MlxCacheController({ cacheDir: '/ignored-for-vlm' });
      const driver = new MlxDriver({
        model: 'test-vlm',
        cacheController,
      });
      const process = (driver as unknown as {
        process: {
          getCapabilities: ReturnType<typeof vi.fn>;
          render: ReturnType<typeof vi.fn>;
          generate: ReturnType<typeof vi.fn>;
          cachePrefill: ReturnType<typeof vi.fn>;
        };
      }).process;
      process.getCapabilities.mockResolvedValueOnce({
        methods: ['render', 'generate', 'cache_prefill'],
        model_kind: 'vlm',
        special_tokens: {},
        features: {
          apply_chat_template: true,
          vocab_size: 32000,
          model_max_length: 4096,
          chat_template: {
            supported_roles: ['system', 'user', 'assistant'],
            preview: null,
            constraints: {},
          },
        },
      });
      process.render.mockResolvedValue({ formatted_prompt: 'rendered', error: null });
      process.cachePrefill.mockResolvedValue({
        cache_path: 'mlx-vlm-memory://backend-ref',
        token_count: 3,
      });
      process.generate.mockResolvedValue(
        Readable.from([`cold${META_MARKER}{"prompt_tokens":4,"generation_tokens":1,"cache_loaded":false}`]),
      );

      const result = await driver.query({
        instructions: [{ type: 'text', content: 'system prompt' }],
        data: [],
        output: [],
      }, { cache: true });

      // buildQueryUsage omits zero-valued cache fields; absence represents a
      // zero cache read and, importantly, the prefill count is not retained.
      expect(result.usage?.cacheReadTokens ?? 0).toBe(0);
      expect(result.usage).not.toHaveProperty('cacheReadTokens');
      // Prefill did write the backend cache even though this request could
      // not load it; only the read side is zeroed for this cold generation.
      expect(result.usage?.cacheWriteTokens).toBe(3);

      await driver.close();
    });
  });

  describe('hasNativeToolSupport', () => {
    it('should return true when tool_call_format.call_start exists', async () => {
      const driver = new MlxDriver({ model: 'test-model' });
      // @ts-expect-error - Accessing private property for testing
      await driver.ensureInitialized();
      // @ts-expect-error - Accessing private property for testing
      driver.runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
          vocab_size: 32000,
          model_max_length: 4096,
          chat_template: {
            supported_roles: ['system', 'user', 'assistant'],
            tool_call_format: {
              tool_parser_type: 'json_tools',
              call_start: '<tool_call>',
              call_end: '</tool_call>',
            }
          }
        }
      };

      // @ts-expect-error - Accessing private method for testing
      expect(driver.hasNativeToolSupport()).toBe(true);
    });

    it('should return true for harmony format', async () => {
      const driver = new MlxDriver({ model: 'test-model' });
      // @ts-expect-error - Accessing private property for testing
      await driver.ensureInitialized();
      // @ts-expect-error - Accessing private property for testing
      driver.runtimeInfo = {
        methods: ['chat'],
        special_tokens: {},
        features: {
          apply_chat_template: true,
          vocab_size: 32000,
          model_max_length: 4096,
          chat_template: {
            supported_roles: ['system', 'user', 'assistant'],
            tool_call_format: {
              tool_parser_type: 'harmony',
              call_start: 'to=functions.',
              call_end: '<|call|>',
            }
          }
        }
      };

      // @ts-expect-error - Accessing private method for testing
      expect(driver.hasNativeToolSupport()).toBe(true);
    });

    it('should return false when no tool_call_format exists', async () => {
      const driver = new MlxDriver({ model: 'test-model' });
      // @ts-expect-error - Accessing private property for testing
      await driver.ensureInitialized();
      // @ts-expect-error - Accessing private property for testing
      driver.runtimeInfo = {
        methods: ['chat'],
        special_tokens: {
          harmony_call: { text: '<|call|>', id: 100 },
        },
        features: {
          apply_chat_template: true,
          vocab_size: 32000,
          model_max_length: 4096,
        }
      };

      // @ts-expect-error - Accessing private method for testing
      expect(driver.hasNativeToolSupport()).toBe(false);
    });

    it('should return false when runtimeInfo is null', async () => {
      const driver = new MlxDriver({ model: 'test-model' });
      // @ts-expect-error - Accessing private property for testing
      driver.runtimeInfo = null;

      // @ts-expect-error - Accessing private method for testing
      expect(driver.hasNativeToolSupport()).toBe(false);
    });
  });

  describe('convertMessages', () => {
    it('should convert messages with string content', () => {
      const input: ChatMessage[] = [
        { role: 'user', content: 'こんにちは' },
        { role: 'assistant', content: 'はい、どうぞ' }
      ];

      const result = convertMessages(input);

      expect(result).toEqual([
        { role: 'user', content: 'こんにちは' },
        { role: 'assistant', content: 'はい、どうぞ' }
      ]);
    });

    it('should convert messages with Attachment[] content, extracting only text', () => {
      const input: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: 'この画像は何ですか？' },
            { type: 'image_url' as const, image_url: { url: '/path/to/image.jpg' } }
          ]
        }
      ];

      const result = convertMessages(input);

      expect(result).toEqual([
        { role: 'user', content: 'この画像は何ですか？' }
      ]);
    });

    it('should handle multiple text attachments by joining with newline', () => {
      const input: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: '最初のテキスト' },
            { type: 'text' as const, text: '2番目のテキスト' }
          ]
        }
      ];

      const result = convertMessages(input);

      expect(result).toEqual([
        { role: 'user', content: '最初のテキスト\n2番目のテキスト' }
      ]);
    });

    it('should handle mixed content with text and images', () => {
      const input: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: 'テキスト1' },
            { type: 'image_url' as const, image_url: { url: '/image1.jpg' } },
            { type: 'text' as const, text: 'テキスト2' },
            { type: 'image_url' as const, image_url: { url: '/image2.jpg' } }
          ]
        }
      ];

      const result = convertMessages(input);

      expect(result).toEqual([
        { role: 'user', content: 'テキスト1\nテキスト2' }
      ]);
    });
  });
});
