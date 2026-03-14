import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { Logger } from '@modular-prompt/utils';

export async function writeTrace(traceDir: string): Promise<void> {
  // Logger からすべての蓄積エントリを取得
  const logger = new Logger();
  const entries = logger.getLogEntries({ filterByContext: false });

  if (entries.length === 0) {
    return;
  }

  // ディレクトリ作成
  await mkdir(traceDir, { recursive: true });

  // summary.json を書き出す
  const contexts = [...new Set(entries.map(e => e.context || 'unknown'))];
  const summary = {
    timestamp: new Date().toISOString(),
    totalEntries: entries.length,
    contexts,
  };
  await writeFile(join(traceDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // context ごとにグループ化してファイルに書き出す
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const ctx = entry.context || 'unknown';
    if (!grouped.has(ctx)) {
      grouped.set(ctx, []);
    }
    grouped.get(ctx)!.push(entry);
  }

  for (const [context, contextEntries] of grouped) {
    // ファイル名: context の : を _ に置換（ファイルシステム安全）
    const filename = context.replace(/:/g, '_') + '.log';

    // 各エントリを読みやすい形式で書き出す
    const lines = contextEntries.map(entry => {
      const time = entry.timestamp;
      const level = entry.level.toUpperCase().padEnd(7);
      const message = entry.message;
      const args = entry.args && entry.args.length > 0
        ? '\n' + entry.args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join('\n')
        : '';
      return `${time} ${level} ${message}${args}`;
    });

    await writeFile(join(traceDir, filename), lines.join('\n\n') + '\n');
  }
}
