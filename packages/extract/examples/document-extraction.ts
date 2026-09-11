/**
 * 文書抽出サンプル: materials + 複数 cue
 *
 * 実行例（リポジトリルート）:
 *   npx tsx packages/extract/examples/document-extraction.ts
 *
 * 前提: macOS + MLX モデルが利用可能で、user models.yaml に
 *       models.default が設定されていること
 */
import {
  createExtractSession,
  createMlxExtractRuntime,
} from '@modular-prompt/extract';

async function main() {
  const runtime = await createMlxExtractRuntime({});

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
