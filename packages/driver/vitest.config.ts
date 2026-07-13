import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // デフォルトではシステムテストを除外
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test/system/**/*.test.ts',  // システムテストを除外
      '**/test/e2e/**/*.test.ts'      // E2Eテストを除外
    ],
    // MLX 等のオンメモリモデルテストは逐次実行（並行禁止）
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      concurrent: false,
    },
    // タイムアウト設定
    testTimeout: 10000,     // ユニットテスト: 10秒
    hookTimeout: 300_000,   // MLX 統合テストの beforeAll（モデルロード）向け
  }
});