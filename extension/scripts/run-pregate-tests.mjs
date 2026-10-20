// Runs the tests the gstack pre-gate selected, as `node --test` runs them in this repository.
//
//   node extension/scripts/run-pregate-tests.mjs <repository-relative test files…>
//
// The pre-gate calls it through `runner` in `.gstack/pregate.json` from the repository root. It writes dist with
// `build-fast` first, so the TypeScript tests run as the JavaScript of the current tree.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { mapPregateTests } from './utils/mapPregateTests.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

const selected = process.argv.slice(2)
// No selection is a mistake of the caller, never a pass of "0 tests".
if (selected.length === 0) {
  console.error('run-pregate-tests: no test file was given.')
  process.exit(2)
}
const files = mapPregateTests(repositoryRoot, selected)

const build = spawnSync(process.execPath, ['scripts/build-fast.mjs'], {
  cwd: extension,
  stdio: 'inherit',
})
// A failed build leaves no current dist to test.
if (build.status !== 0) process.exit(build.status ?? 1)

const tests = spawnSync(process.execPath, ['--test', ...files], {
  cwd: extension,
  stdio: 'inherit',
})
process.exit(tests.status ?? 1)
