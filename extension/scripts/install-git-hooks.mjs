import { installGitHooks } from './utils/installGitHooks.mjs'

const MESSAGES = {
  installed: 'Installed the lint-staged pre-commit hook.',
  'skipped-ci': 'Skipped Git hook installation in CI.',
  'skipped-no-git': 'Skipped Git hook installation outside a Git checkout.',
  'skipped-hooks-path':
    'Skipped the pre-commit hook: core.hooksPath is set, so another hook manager owns the hooks.',
  'skipped-foreign-hook':
    'Skipped the pre-commit hook: an existing pre-commit hook was left unchanged. Run `pnpm exec lint-staged` from extension/ before committing.',
}

const outcome = await installGitHooks()
console.log(`codebook: ${MESSAGES[outcome]}`)
