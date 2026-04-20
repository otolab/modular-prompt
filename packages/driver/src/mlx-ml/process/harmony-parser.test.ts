import { describe, it, expect } from 'vitest';
import { parseHarmonyResponse } from './harmony-parser.js';

describe('parseHarmonyResponse', () => {
  it('parses analysis and final messages', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>analysis<|message|>ユーザーは天気を聞いている<|end|><|start|>assistant<|channel|>final<|message|>今日は晴れです。<|end|>'
    );

    expect(result).toEqual({
      content: '今日は晴れです。',
      thinkingContent: 'ユーザーは天気を聞いている',
      toolCalls: undefined,
    });
  });

  it('parses a final-only response', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>final<|message|>こんにちは<|end|>'
    );

    expect(result).toEqual({
      content: 'こんにちは',
      thinkingContent: undefined,
      toolCalls: undefined,
    });
  });

  it('extracts a tool call', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant to=functions.get_weather<|channel|>commentary json<|message|>{"location":"Tokyo"}<|call|>'
    );

    expect(result).toEqual({
      content: '',
      thinkingContent: undefined,
      toolCalls: [
        {
          id: 'harmony_call_0',
          name: 'get_weather',
          arguments: { location: 'Tokyo' },
        },
      ],
    });
  });

  it('parses a full tool call flow and skips tool results', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>analysis<|message|>天気APIを呼ぶ<|end|><|start|>assistant to=functions.get_weather<|channel|>commentary json<|message|>{"location":"Tokyo"}<|call|><|start|>functions.get_weather to=assistant<|channel|>commentary<|message|>"sunny"<|end|><|start|>assistant<|channel|>final<|message|>東京は晴れです。<|end|>'
    );

    expect(result).toEqual({
      content: '東京は晴れです。',
      thinkingContent: '天気APIを呼ぶ',
      toolCalls: [
        {
          id: 'harmony_call_0',
          name: 'get_weather',
          arguments: { location: 'Tokyo' },
        },
      ],
    });
  });

  it('handles an incomplete response without an end token', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>final<|message|>途中で切れた'
    );

    expect(result).toEqual({
      content: '途中で切れた',
      thinkingContent: undefined,
      toolCalls: undefined,
    });
  });

  it('handles a response terminated by a return token', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>final<|message|>最終回答<|return|>'
    );

    expect(result).toEqual({
      content: '最終回答',
      thinkingContent: undefined,
      toolCalls: undefined,
    });
  });

  it('joins multiple analysis messages', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>analysis<|message|>まず考える<|end|><|start|>assistant<|channel|>analysis<|message|>さらに検討<|end|><|start|>assistant<|channel|>final<|message|>結論<|end|>'
    );

    expect(result).toEqual({
      content: '結論',
      thinkingContent: 'まず考える\nさらに検討',
      toolCalls: undefined,
    });
  });

  it('trims surrounding whitespace from content', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>final<|message|>  コンテンツ  <|end|>'
    );

    expect(result).toEqual({
      content: 'コンテンツ',
      thinkingContent: undefined,
      toolCalls: undefined,
    });
  });

  it('returns empty values for an empty response', () => {
    const result = parseHarmonyResponse('');

    expect(result).toEqual({
      content: '',
      thinkingContent: undefined,
      toolCalls: undefined,
    });
  });

  it('parses stream output where initial <|start|> is omitted', () => {
    // chat templateのadd_generation_promptが<|start|>assistantを付与するため、
    // ストリーム出力では最初の<|start|>が含まれない
    const result = parseHarmonyResponse(
      '<|channel|>analysis<|message|>ユーザーは天気を聞いている<|end|><|start|>assistant<|channel|>final<|message|>今日は晴れです。<|end|>'
    );

    expect(result).toEqual({
      content: '今日は晴れです。',
      thinkingContent: 'ユーザーは天気を聞いている',
      toolCalls: undefined,
    });
  });

  it('parses stream output with leading space before <|channel|>', () => {
    // 実際の出力では <|channel|> の前にスペースがある場合がある
    const result = parseHarmonyResponse(
      ' <|channel|> analysis<|message|> We need to check<|end|><|start|> assistant<|channel|> final<|message|> 1 + 1 = 2<|end|>'
    );

    expect(result).toEqual({
      content: '1 + 1 = 2',
      thinkingContent: 'We need to check',
      toolCalls: undefined,
    });
  });

  it('parses stream output with tool call and no initial <|start|>', () => {
    const result = parseHarmonyResponse(
      '<|channel|>analysis<|message|>天気を調べる<|end|><|start|>assistant to=functions.get_weather<|channel|>commentary json<|message|>{"location":"Tokyo"}<|call|>'
    );

    expect(result).toEqual({
      content: '',
      thinkingContent: '天気を調べる',
      toolCalls: [
        {
          id: 'harmony_call_0',
          name: 'get_weather',
          arguments: { location: 'Tokyo' },
        },
      ],
    });
  });

  it('skips constrain tokens before the message payload', () => {
    const result = parseHarmonyResponse(
      '<|start|>assistant<|channel|>final<|constrain|>json<|message|>{"result": true}<|end|>'
    );

    expect(result).toEqual({
      content: '{"result": true}',
      thinkingContent: undefined,
      toolCalls: undefined,
    });
  });
});
