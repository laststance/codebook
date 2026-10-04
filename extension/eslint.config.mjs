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
    },
  },
  {
    // Shared editor/server state here is guarded by explicit generation, lifetime and stopping checks; the rule
    // reports every plain post-await assignment of such state, not only read-modify-write races.
    files: [
      'src/extension.ts',
      'src/nativeRepositoryBootstrap.ts',
      'src/ownedNodeTestRun.ts',
      'src/server.ts',
      'src/studyWorkspace.ts',
      'src/tests/studyWorkspaceHarness.ts',
    ],
    rules: {
      'require-atomic-updates': 'off',
    },
  },
  {
    // The editor turns `[label](command:…)` in a notification into a link that runs a command, and it shows a rejected
    // command's message in a notification of its own. Both texts can quote outside text (a path, a setting, an error),
    // so only the two helpers reach the editor; a modal confirmation renders no link and stays a direct call.
    files: ['src/**/*.ts'],
    ignores: [
      'src/tests/**',
      'src/utils/showPlainNotice.ts',
      'src/utils/registerPlainCommand.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^show(Information|Warning|Error)Message$/]:not(:has(Property[key.name="modal"][value.value=true]))',
          message:
            'Show a notification through showNotice(severity, message, ...actions) inside activate() of extension.ts, or through showPlainNotice(vscode.window, severity, message, ...actions) elsewhere: it takes link syntax out of the message. Only a modal confirmation ({ modal: true }) calls the editor directly.',
        },
        {
          selector: 'CallExpression[callee.property.name="registerCommand"]',
          message:
            'Register a command through registerCommand(command, handler) inside activate() of extension.ts (registerPlainCommand): a failed command then rejects with a message the editor cannot turn into a link.',
        },
      ],
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
