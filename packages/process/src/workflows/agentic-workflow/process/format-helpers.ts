import type { ToolCall } from '@modular-prompt/core';
import type { AgenticTaskExecutionLog, AgenticTask } from '../types.js';

/**
 * ToolCall（未実行の外部ツール呼び出し）を表示用文字列にフォーマット
 */
export function formatToolCall(tc: ToolCall): string {
  return `- ${tc.name}(${JSON.stringify(tc.arguments)})`;
}

/**
 * 実行ログの共通部分（Result + Pending Tool Calls + State）を文字列パーツとして生成
 */
export function formatLogContentParts(log: AgenticTaskExecutionLog): string[] {
  const parts: string[] = [];

  parts.push(`[Result]\n${log.result}`);

  if (log.pendingToolCalls && log.pendingToolCalls.length > 0) {
    parts.push(`[Pending Tool Calls]\n${log.pendingToolCalls.map(formatToolCall).join('\n')}`);
  }

  if (log.state) {
    parts.push(`[State]\n${log.state}`);
  }

  return parts;
}

/**
 * タスクの guidelines/constraints をフォーマット
 */
export function formatTaskDetails(task: AgenticTask): string[] {
  const parts: string[] = [];

  if (task.guidelines && task.guidelines.length > 0) {
    parts.push('**Guidelines:**');
    task.guidelines.forEach(item => parts.push(`- ${item}`));
  }

  if (task.constraints && task.constraints.length > 0) {
    parts.push('**Constraints:**');
    task.constraints.forEach(item => parts.push(`- ${item}`));
  }

  return parts;
}
