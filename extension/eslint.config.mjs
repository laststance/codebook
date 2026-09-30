import { defineConfig } from 'eslint/config'
import tsPrefixer from 'eslint-config-ts-prefixer'

export default defineConfig([
  {
    // Generated/private outputs and the standalone example are not extension source;
    // bundled skill files are identity-tracked by content hash and version.
    ignores: ['dist/**', 'artifacts/**', 'examples/**', '.fallow/**', 'skills/**'],
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
    // Package and native-QA scripts deliberately load the compiled extension from dist after `pnpm build`.
    files: ['scripts/**/*.mjs'],
    rules: {
      'import-x/no-unresolved': ['error', { ignore: ['^\\.\\./dist/'] }],
    },
  },
])
