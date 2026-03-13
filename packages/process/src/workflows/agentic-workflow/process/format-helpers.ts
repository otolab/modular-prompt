import type { ToolCall } from '@modular-prompt/core';
import type { AgenticTaskExecutionLog } from '../types.js';

/**
 * ToolCall（未実行の外部ツール呼び出し）を表示用文字列にフォーマット
 */
export function formatToolCall(tc: ToolCall): string {
  return `- ${tc.name}(${JSON.stringify(tc.arguments)})`;
}

/**
 * 実行ログの内容を文字列パーツとして生成
 */
export function formatLogContentParts(log: AgenticTaskExecutionLog): string[] {
  const parts: string[] = [];

  parts.push(`[Result]\n${log.result}`);

  if (log.pendingToolCalls && log.pendingToolCalls.length > 0) {
    parts.push(`[Pending Tool Calls]\n${log.pendingToolCalls.map(formatToolCall).join('\n')}`);
  }

  return parts;
}
