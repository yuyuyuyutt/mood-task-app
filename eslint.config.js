// eslint.config.js（ESLint 9 flat config）
//
// 定位：**只拦真问题**，不做风格争论（格式交给编辑器/Prettier，不进 lint）。
// - 错误级：react-hooks 的 rules-of-hooks（hooks 顺序是硬约束，写错必崩）；
// - 警告级：exhaustive-deps、no-explicit-any、no-unused-vars（存量代码有历史包袱，
//   先以警告暴露，避免一次性淹没 diff）。
// 运行：npm run lint
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'scripts/**',
      'tailwind.config.js',
      'postcss.config.js',
      '**/*.cjs',
      '.tmp-*',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // react-hooks v7 的 recommended-latest 里还有一批实验性规则
      // （set-state-in-effect / use-memo / immutability 等），对存量代码噪声过大，
      // 这里只启用两条"真能拦到 bug"的：hooks 顺序错误 + 依赖数组遗漏。
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 存量代码里 `any` 与未使用参数较多，先降级为警告
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // TS 自带未定义检查，且 vite/vitest 配置里用到 __dirname 等 Node 全局
      'no-undef': 'off',
      // 允许空的 catch 块（本仓库大量用于"尽力而为"的清理路径）
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
    },
  },
);
