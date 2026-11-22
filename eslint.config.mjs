import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * 最小可行的 lint 配置：只启用「能确定是错误」的规则，不引入风格类规则。
 *
 * 覆盖范围 = 仓库里实际提交的 JS/TS 源码（构建产物与依赖目录不参与）。
 * 规则取舍：
 *   - no-unused-vars / no-undef / 语法类错误全开；
 *   - 格式化、命名、复杂度等风格规则不引入（仓库没有既有风格约定）；
 *   - `no-irregular-whitespace` 跳过正则与字符串：本仓库有若干「清理零宽字符」
 *     的正则（见 apps/desktop/src/main/services/browser/page-scripts.ts），
 *     字面量里的零宽字符正是被测对象，不是笔误。
 * TS 文件用 @typescript-eslint 的 no-unused-vars（能识别仅用于类型的导入），
 * 基础规则在 TS 上关闭，避免同一处重复报错。
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/*.min.js',
      '**/.tmp/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true }]
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx,mts,cts}']
  })),
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true, skipTemplates: true }]
    }
  },
  {
    // 浏览器侧：preload 层 shim、渲染层、移动端、Web 页面脚本、插件前端
    files: [
      'apps/desktop/src/renderer/**/*.{js,jsx,ts,tsx}',
      'apps/desktop/src/mobile/**/*.{js,jsx,ts,tsx}',
      'apps/desktop/src/preload/**/*.{js,jsx,ts,tsx}',
      'apps/web/src/web/**/*.js',
      'apps/web/src/electron-shim.js',
      'plugins/deva-agent/client.mjs',
      // 插件模板是交给第三方开发者改的前端入口（挂载到 Studio 页面里，直接用 DOM）
      'plugins/deva-agent/sdk/template/client.mjs'
    ],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },
  {
    // React 组件：hooks 规则只作用于渲染层与移动端（preload / 服务端代码没有组件）。
    files: [
      'apps/desktop/src/renderer/**/*.{js,jsx,ts,tsx}',
      'apps/desktop/src/mobile/**/*.{js,jsx,ts,tsx}'
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  }
)
