/**
 * 対話ログ抽出サンプル: messages + materials
 *
 * 実行例（リポジトリルート）:
 *   npx tsx packages/extract/examples/dialogue-extraction.ts
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
        materials: [{
          title: 'Product Spec',
          content: 'The API rate limit is 1000 requests per minute. Premium tier allows 5000.',
        }],
        messages: [
          { role: 'user', content: 'What is the rate limit for the free tier?' },
          { role: 'assistant', content: 'The free tier allows 1000 requests per minute.' },
          { role: 'user', content: 'Can we increase it for enterprise customers?' },
          { role: 'assistant', content: 'Premium tier supports 5000 requests per minute.' },
        ],
      },
    });

    const result = await session.extract({
      cue: 'Extract discussed constraints, tier differences, and any agreements from the dialogue.',
      options: { maxTokens: 200, temperature: 0 },
    });

    console.log(result.text);
    await session.close();
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
