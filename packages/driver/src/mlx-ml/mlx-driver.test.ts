import { describe, it, expect, vi } from 'vitest';
import { MlxDriver, convertMessages } from './mlx-driver.js';
import type { ChatMessage } from '../formatter/types.js';

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