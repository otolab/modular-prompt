#!/usr/bin/env npx tsx
/**
 * MLXモデルの特殊トークンサポート状況を確認するスクリプト
 *
 * Usage:
 *   npx tsx scripts/check-special-tokens.ts <model-name>
 *   npx tsx scripts/check-special-tokens.ts mlx-community/gemma-3-270m-it-qat-8bit
 */

import { MlxDriver } from '../src/mlx-ml/mlx-driver.js';

const modelName = process.argv[2];

if (!modelName) {
  console.error('Usage: npx tsx scripts/check-special-tokens.ts <model-name>');
  console.error('Example: npx tsx scripts/check-special-tokens.ts mlx-community/gemma-3-270m-it-qat-8bit');
  process.exit(1);
}

async function checkSpecialTokens(modelName: string) {
  console.log(`\n========== ${modelName} ==========`);

  try {
    const driver = new MlxDriver({ model: modelName });
    const capabilities = await driver.getCapabilities();
    const tokens = capabilities.specialTokens;

    if (!tokens) {
      console.log('❌ 特殊トークンを取得できませんでした');
      await driver.close();
      return;
    }

    // 構造化関連のトークンを確認
    const structuredTokens = [
      'code', 'python', 'javascript', 'bash',
      'quote', 'ref', 'citation',
      'table', 'context', 'knowledge',
      'json', 'xml', 'yaml'
    ];

    console.log('\n📋 構造化トークンのサポート状況:');
    for (const tokenName of structuredTokens) {
      const token = tokens[tokenName];
      if (token) {
        if (typeof token === 'object' && 'start' in token && 'end' in token) {
          console.log(`  ✅ ${tokenName}: ${token.start.text} ... ${token.end.text}`);
        } else if (typeof token === 'object' && 'text' in token) {
          console.log(`  ✅ ${tokenName}: ${token.text}`);
        }
      }
    }

    // 実際に存在するトークンをすべて表示
    console.log('\n📌 実際に存在する特殊トークン:');
    const tokenNames = Object.keys(tokens);
    const relevantTokens = tokenNames.filter(name => {
      // 一般的なロールトークン以外を表示
      return !['system', 'user', 'assistant', 'pad', 'eos', 'bos', 'unk'].includes(name);
    });

    if (relevantTokens.length > 0) {
      for (const name of relevantTokens.slice(0, 10)) {
        const token = tokens[name];
        if (typeof token === 'object' && 'start' in token && 'end' in token) {
          console.log(`  - ${name}: ${token.start.text} ... ${token.end.text}`);
        } else if (typeof token === 'object' && 'text' in token) {
          console.log(`  - ${name}: ${token.text}`);
        }
      }
      if (relevantTokens.length > 10) {
        console.log(`  ... 他 ${relevantTokens.length - 10} 個のトークン`);
      }
    } else {
      console.log('  （構造化用の特殊トークンは見つかりませんでした）');
    }

    await driver.close();
  } catch (error) {
    console.error(`❌ エラー: ${error}`);
  }
}

await checkSpecialTokens(modelName);
