import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // システムテスト用の設定
    include: [
      '**/test/system/**/*.test.ts'
    ],
    // オンメモリ MLX モデルは逐次実行
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      concurrent: false,
    },
    // システムテストは時間がかかるため長めのタイムアウト
    testTimeout: 60000,     // 60秒
    hookTimeout: 60000,
  }
});