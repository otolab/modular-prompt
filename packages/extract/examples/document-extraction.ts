/**
 * 文書抽出サンプル: materials + 複数 cue
 *
 * 実行例（リポジトリルート）:
 *   npx tsx packages/extract/examples/document-extraction.ts
 *
 * 前提: macOS + MLX モデルが利用可能であること
 */
import {
  createExtractSession,
  createMlxExtractRuntime,
} from '@modular-prompt/extract';

const MODEL = process.env.MLX_MODEL ?? 'prism-ml/Ternary-Bonsai-1.7B-mlx-2bit';

async function main() {
  const runtime = await createMlxExtractRuntime({ model: MODEL });

  try {
    const session = createExtractSession({
      driver: runtime.driver,
      cacheController: runtime.cacheController,
      model: runtime.model,
      corpus: {
        materials: [
          {
            title: 'Meeting Notes',
            content: [
              'Alice met Bob in Paris on Monday.',
              'They agreed to add extract sessions with KV cache support.',
              'Charlie joined remotely from Tokyo.',
            ].join(' '),
          },
        ],
      },
    });

    const people = await session.extract({
      cue: 'List people mentioned in the document.',
      options: { maxTokens: 120, temperature: 0 },
    });
    console.log('--- People ---');
    console.log(people.text);

    const cities = await session.extract({
      cue: 'List cities mentioned in the document.',
      options: { maxTokens: 120, temperature: 0 },
    });
    console.log('--- Cities ---');
    console.log(cities.text);
    console.log('cacheReadTokens (2nd call):', cities.usage?.cacheReadTokens ?? 0);

    await session.close();
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
