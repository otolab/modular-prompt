import type { ToolCall } from '../../types.js';
import type { MlxRuntimeInfo } from './types.js';
import { extractThinkingContent } from '../../content-utils.js';
import { parseToolCalls } from '../tool-call-parser.js';

export interface ResponseParseResult {
  content: string;
  thinkingContent?: string;
  toolCalls?: ToolCall[];
}

export type ResponseProcessor = (rawText: string) => ResponseParseResult;

/**
 * デフォルトResponseProcessorファクトリ
 *
 * thinking抽出（<think>, <|channel>thought等）とツールコール解析を合成する。
 * 専用パーサ（harmony等）を持たないモデル向けの汎用プロセッサ。
 */
export function createDefaultProcessor(runtimeInfo: MlxRuntimeInfo | null): ResponseProcessor {
  return (rawText: string): ResponseParseResult => {
    const { content: afterThinking, thinkingContent } = extractThinkingContent(rawText);
    const { content, toolCalls } = parseToolCalls(afterThinking, runtimeInfo);
    return {
      content,
      thinkingContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  };
}
