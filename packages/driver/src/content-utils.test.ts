import { describe, it, expect } from 'vitest';
import { contentToString, extractImagePaths, extractThinkingContent } from './content-utils.js';
import type { Attachment } from '@modular-prompt/core';

describe('contentToString', () => {
  it('should return string input as-is', () => {
    const input = 'Hello, world!';
    const result = contentToString(input);
    expect(result).toBe('Hello, world!');
  });

  it('should join text attachments with newline', () => {
    const input: Attachment[] = [
      { type: 'text', text: 'First line' },
      { type: 'text', text: 'Second line' },
      { type: 'text', text: 'Third line' }
    ];
    const result = contentToString(input);
    expect(result).toBe('First line\nSecond line\nThird line');
  });

  it('should ignore image_url attachments', () => {
    const input: Attachment[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
    ];
    const result = contentToString(input);
    expect(result).toBe('');
  });

  it('should extract only text from mixed attachments', () => {
    const input: Attachment[] = [
      { type: 'text', text: 'Text before' },
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      { type: 'text', text: 'Text after' }
    ];
    const result = contentToString(input);
    expect(result).toBe('Text before\nText after');
  });

  it('should return empty string for empty array', () => {
    const input: Attachment[] = [];
    const result = contentToString(input);
    expect(result).toBe('');
  });

  it('should ignore text attachments with undefined text field', () => {
    const input: Attachment[] = [
      { type: 'text', text: 'Valid text' },
      { type: 'text' }, // Missing text field
      { type: 'text', text: 'Another valid text' }
    ];
    const result = contentToString(input);
    expect(result).toBe('Valid text\nAnother valid text');
  });

  it('should ignore file attachments', () => {
    const input: Attachment[] = [
      { type: 'text', text: 'Text content' },
      { type: 'file', file: { path: '/path/to/file.pdf', mime_type: 'application/pdf' } },
      { type: 'text', text: 'More text' }
    ];
    const result = contentToString(input);
    expect(result).toBe('Text content\nMore text');
  });
});

describe('extractThinkingContent', () => {
  it('should extract a single think block', () => {
    const result = extractThinkingContent('<think>考え中...</think>回答です。');
    expect(result.content).toBe('回答です。');
    expect(result.thinkingContent).toBe('考え中...');
  });

  it('should extract multiple think blocks', () => {
    const result = extractThinkingContent('<think>最初の思考</think>中間テキスト<think>追加の思考</think>最終回答');
    expect(result.content).toBe('中間テキスト最終回答');
    expect(result.thinkingContent).toBe('最初の思考\n追加の思考');
  });

  it('should handle closing tag only (stream truncation)', () => {
    const result = extractThinkingContent('途中の思考</think>回答です。');
    expect(result.content).toBe('回答です。');
    expect(result.thinkingContent).toBe('途中の思考');
  });

  it('should return undefined thinkingContent when no think tags', () => {
    const result = extractThinkingContent('普通のテキストです。');
    expect(result.content).toBe('普通のテキストです。');
    expect(result.thinkingContent).toBeUndefined();
  });

  it('should handle empty think block', () => {
    const result = extractThinkingContent('<think></think>回答');
    expect(result.content).toBe('回答');
    expect(result.thinkingContent).toBeUndefined();
  });

  it('should handle multiline think content', () => {
    const result = extractThinkingContent('<think>\nステップ1: 分析\nステップ2: 判断\n</think>\n結果です。');
    expect(result.content).toBe('結果です。');
    expect(result.thinkingContent).toBe('ステップ1: 分析\nステップ2: 判断');
  });

  it('should handle empty string input', () => {
    const result = extractThinkingContent('');
    expect(result.content).toBe('');
    expect(result.thinkingContent).toBeUndefined();
  });
});

describe('extractImagePaths', () => {
  it('should return empty array for string input', () => {
    const input = 'This is a string';
    const result = extractImagePaths(input);
    expect(result).toEqual([]);
  });

  it('should extract image URLs from image_url attachments', () => {
    const input: Attachment[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/image1.png' } },
      { type: 'image_url', image_url: { url: 'https://example.com/image2.jpg' } }
    ];
    const result = extractImagePaths(input);
    expect(result).toEqual([
      'https://example.com/image1.png',
      'https://example.com/image2.jpg'
    ]);
  });

  it('should ignore text attachments', () => {
    const input: Attachment[] = [
      { type: 'text', text: 'Some text' }
    ];
    const result = extractImagePaths(input);
    expect(result).toEqual([]);
  });

  it('should extract only image URLs from mixed attachments', () => {
    const input: Attachment[] = [
      { type: 'text', text: 'Text content' },
      { type: 'image_url', image_url: { url: 'https://example.com/photo.png' } },
      { type: 'text', text: 'More text' },
      { type: 'image_url', image_url: { url: 'file:///local/image.jpg' } }
    ];
    const result = extractImagePaths(input);
    expect(result).toEqual([
      'https://example.com/photo.png',
      'file:///local/image.jpg'
    ]);
  });

  it('should return empty array for empty array input', () => {
    const input: Attachment[] = [];
    const result = extractImagePaths(input);
    expect(result).toEqual([]);
  });

  it('should ignore image_url attachments with undefined image_url field', () => {
    const input: Attachment[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/valid.png' } },
      { type: 'image_url' }, // Missing image_url field
      { type: 'image_url', image_url: { url: 'https://example.com/another.png' } }
    ];
    const result = extractImagePaths(input);
    expect(result).toEqual([
      'https://example.com/valid.png',
      'https://example.com/another.png'
    ]);
  });

  it('should ignore file attachments', () => {
    const input: Attachment[] = [
      { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
      { type: 'file', file: { path: '/path/to/file.pdf', mime_type: 'application/pdf' } }
    ];
    const result = extractImagePaths(input);
    expect(result).toEqual(['https://example.com/image.png']);
  });
});
