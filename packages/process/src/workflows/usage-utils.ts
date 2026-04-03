import type { QueryResult } from '@modular-prompt/driver';
import type { LogEntry } from '@modular-prompt/utils';

type Usage = NonNullable<QueryResult['usage']>;

/**
 * 複数の usage を合算する。
 * リトライや複数タスクの usage を集計するのに使用。
 */
export function aggregateUsage(usages: (Usage | undefined)[]): Usage | undefined {
  const valid = usages.filter((u): u is Usage => u != null);
  if (valid.length === 0) return undefined;
  return {
    promptTokens: valid.reduce((sum, u) => sum + u.promptTokens, 0),
    completionTokens: valid.reduce((sum, u) => sum + u.completionTokens, 0),
    totalTokens: valid.reduce((sum, u) => sum + u.totalTokens, 0),
  };
}

/**
 * 複数の LogEntry 配列をフラット化する。
 * 全タスク・全クエリのログを1つの配列にまとめるのに使用。
 */
export function aggregateLogEntries(entries: (LogEntry[] | undefined)[]): LogEntry[] | undefined {
  const flat = entries.filter((e): e is LogEntry[] => e != null).flat();
  return flat.length > 0 ? flat : undefined;
}
