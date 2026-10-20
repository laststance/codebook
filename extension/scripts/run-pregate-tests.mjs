// Runs the tests the gstack pre-gate selected, as `node --test` runs them in this repository.
//
//   node extension/scripts/run-pregate-tests.mjs <repository-relative test files…>
//
// The pre-gate calls it through `runner` in `.gstack/pregate.json` from the repository root. It writes dist with
// `build-fast` first, so the TypeScript tests run as the JavaScript of the current tree, then runs the product tests
// and, after them, the other tests four at a time (the package tests rebuild dist), and prints one summary of both.
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { mapPregateTests } from './utils/mapPregateTests.mjs'
import {
  combinedSummary,
  planPregateRuns,
  runSummaryLine,
} from './utils/planPregateRuns.mjs'

const extension = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

const selected = process.argv.slice(2)
// No selection is a mistake of the caller, never a pass of "0 tests".
if (selected.length === 0) {
  console.error('run-pregate-tests: no test file was given.')
  process.exit(2)
}
const runs = planPregateRuns(mapPregateTests(repositoryRoot, selected))

const build = spawnSync(process.execPath, ['scripts/build-fast.mjs'], {
  cwd: extension,
  stdio: 'inherit',
})
// A failed build leaves no current dist to test.
if (build.status !== 0) process.exit(build.status ?? 1)

/** Runs one planned `node --test` call, prints its output with its summary lines marked as the run's own, and answers its exit code and output. @example await runTests({ files: ['/repo/extension/dist/tests/a.test.js'], args: [] }) // => { code: 0, output: '✔ …' } */
function runTests({ files, args }) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--test', ...args, ...files], {
      cwd: extension,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let output = ''
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines)
        process.stdout.write(runSummaryLine(line) + '\n')
    })
    child.on('close', (code) => {
      // The last line may come without its line end.
      if (pending) process.stdout.write(runSummaryLine(pending) + '\n')
      resolveRun({ code: code ?? 1, output })
    })
  })
}

const results = []
// The runs go one after the other: the product tests must end before the package tests rebuild dist.
for (const run of runs) results.push(await runTests(run))
for (const line of combinedSummary(results.map(({ output }) => output)))
  process.stdout.write(line + '\n')
process.exit(results.some(({ code }) => code !== 0) ? 1 : 0)
