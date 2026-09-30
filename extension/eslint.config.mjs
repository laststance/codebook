import { defineConfig } from 'eslint/config'
import tsPrefixer from 'eslint-config-ts-prefixer'

export default defineConfig([
  {
    // Generated/private outputs and the standalone example are not extension source;
    // bundled skill files are identity-tracked by content hash and version.
    ignores: [
      'dist/**',
      'coverage/**',
      'artifacts/**',
      'examples/**',
      '.fallow/**',
      'skills/**',
    ],
  },
  ...tsPrefixer,
  {
    languageOptions: {
      parserOptions: {
        // scripts/tsconfig.json covers the package/QA scripts; this config file has no project.
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // VS Code, DAP and webview callbacks here distinguish a synchronous throw or an `undefined` return
      // from a returned Promise (for example webview message intercepts). Wrapping them in `async`
      // changes that contract, so this autofix is not behavior-preserving in this codebase.
      '@typescript-eslint/promise-function-async': 'off',
      // Cleanup hooks (for example `context.after`) deliberately close over a binding assigned later.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      // Shared editor/server state is guarded by explicit generation, lifetime and stopping checks; the rule
      // reports every plain post-await assignment of such state, not only read-modify-write races.
      'require-atomic-updates': 'off',
    },
  },
  {
    // Package and native-QA scripts deliberately load the compiled extension from dist after `pnpm build`.
    files: ['scripts/**/*.mjs'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^\\.\\./dist/'] }],
    },
  },
])
