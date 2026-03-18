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

  // ファイル名を生成するヘルパー関数
  const generateFilename = (prefix?: string, context?: string): string => {
    const p = prefix || '';
    const c = context || '';

    if (p && c) {
      // prefix あり + context あり: {prefix}_{context}.log
      return `${p}_${c.replace(/:/g, '_')}.log`;
    } else if (p) {
      // prefix あり + context なし: {prefix}.log
      return `${p}.log`;
    } else if (c) {
      // prefix なし + context あり: {context}.log
      return `${c.replace(/:/g, '_')}.log`;
    } else {
      // prefix なし + context なし: unknown.log
      return 'unknown.log';
    }
  };

  // summary.json を書き出す
  const fileNames = [...new Set(entries.map(e => generateFilename(e.prefix, e.context)))];
  const summary = {
    timestamp: new Date().toISOString(),
    totalEntries: entries.length,
    fileNames,
  };
  await writeFile(join(traceDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // prefix + context ごとにグループ化してファイルに書き出す
  const grouped = new Map<string, typeof entries>();
  for (const entry of entries) {
    const filename = generateFilename(entry.prefix, entry.context);
    if (!grouped.has(filename)) {
      grouped.set(filename, []);
    }
    grouped.get(filename)!.push(entry);
  }

  for (const [filename, contextEntries] of grouped) {
    // ファイル名はすでに生成済み

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
