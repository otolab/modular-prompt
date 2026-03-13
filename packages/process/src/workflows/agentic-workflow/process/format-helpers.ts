import type { AgenticTaskExecutionLog, AgenticTask, ToolCallLog } from '../types.js';

/**
 * ToolCallLog を表示用文字列にフォーマット
 */
export function formatToolCall(tc: ToolCallLog): string {
  const resultStr = typeof tc.result === 'string'
    ? tc.result
    : JSON.stringify(tc.result, null, 2);
  return `- ${tc.name}(${JSON.stringify(tc.arguments)}) → ${resultStr}`;
}

/**
 * 実行ログの共通部分（Result + Tool Calls + State）を文字列パーツとして生成
 */
export function formatLogContentParts(log: AgenticTaskExecutionLog): string[] {
  const parts: string[] = [];

  parts.push(`[Result]\n${log.result}`);

  if (log.toolCalls && log.toolCalls.length > 0) {
    parts.push(`[Tool Calls]\n${log.toolCalls.map(formatToolCall).join('\n')}`);
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
