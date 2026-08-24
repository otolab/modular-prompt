/**
 * 段階的深掘りサンプル: inputs 積み上げ + キャッシュ活用
 *
 * 実行例（リポジトリルート）:
 *   npx tsx packages/extract/examples/progressive-deep-dive.ts
 */
import {
  buildPreviousExtractionsInputs,
  createExtractSession,
  createMlxExtractRuntime,
  inputChunksFromJson,
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
        materials: [{
          title: 'Project Notes',
          content: [
            'Alice met Bob in Paris to discuss the modular-prompt project.',
            'They agreed to add extract sessions with KV cache support.',
            'Charlie joined remotely from Tokyo.',
          ].join(' '),
        }],
      },
    });

    const overview = await session.extract({
      cue: 'Summarize the meeting in one sentence.',
      options: { maxTokens: 100, temperature: 0 },
    });
    console.log('--- Overview ---');
    console.log(overview.text);

    const details = await session.extract({
      cue: 'Based on the overview, list decisions and open questions.',
      inputs: buildPreviousExtractionsInputs([overview]),
      options: { maxTokens: 150, temperature: 0 },
    });
    console.log('--- Details ---');
    console.log(details.text);
    console.log('cacheReadTokens:', details.usage?.cacheReadTokens ?? 0);

    const focused = await session.extract({
      cue: 'Extract only action items related to extract sessions.',
      inputs: inputChunksFromJson({ focus: 'extract sessions', pass: 3 }),
      options: { maxTokens: 120, temperature: 0 },
    });
    console.log('--- Focused ---');
    console.log(focused.text);

    await session.close();
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
