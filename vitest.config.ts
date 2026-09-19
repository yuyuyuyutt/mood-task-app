// vitest.config.ts
// 测试基线配置。
// 说明：本项目的单测定位为「纯逻辑 + 显式 mock」，默认跑在 node 环境；
// 依赖 DOM 的模块（组件/IndexedDB）由测试文件自行注入桩对象，
// 因此不引入 jsdom，保持依赖精简。
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    // 每个用例前恢复被 spy 的原实现，避免跨用例污染
    restoreMocks: true,
  },
});
