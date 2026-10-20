import { readRunSummary, SUMMARY_LINE } from './readRunSummary.mjs'

/**
 * Splits the files the gstack pre-gate selected into the runs that `node --test` makes of them, in order: the compiled product tests first, then the other tests (the script tests and the compaction hook's test), four at a time.
 *
 * Why: the package tests among the script tests rebuild `extension/dist` while they run, so a product test that reads `dist` beside them fails to load its module (as `pnpm --dir extension check` orders them too: `test` before `test:package`).
 * Called by `run-pregate-tests.mjs` after {@link mapPregateTests}.
 *
 * @param files - The absolute paths to run, as {@link mapPregateTests} answered them.
 * @returns The runs in order, each with its files and the extra arguments of `node --test`; a run with no file is left out.
 *
 * @example
 * ```js
 * planPregateRuns(['/repo/extension/scripts/tests/package.test.mjs', '/repo/extension/dist/tests/citation.test.js'])
 * // => [{ files: ['/repo/extension/dist/tests/citation.test.js'], args: [] }, { files: ['/repo/extension/scripts/tests/package.test.mjs'], args: ['--test-concurrency=4'] }]
 * ```
 */
export function planPregateRuns(files) {
  const isProductTest = (file) =>
    file.replaceAll('\\', '/').includes('/extension/dist/tests/')
  return [
    { files: files.filter(isProductTest), args: [] },
    {
      files: files.filter((file) => !isProductTest(file)),
      args: ['--test-concurrency=4'],
    },
  ].filter((run) => run.files.length > 0)
}

/**
 * Renames the runner's summary lines of one run, so that the pre-gate reads only the combined summary that {@link combinedSummary} prints after the last run.
 *
 * Why: the pre-gate takes the first `ℹ tests N` line of the output as the count of the whole lane.
 * Called by `run-pregate-tests.mjs` for each line of each run's output.
 *
 * @param line - One line of a run's output, without its line end.
 * @returns The line, or for a summary line the same line marked as the run's own (`ℹ run tests 12`).
 *
 * @example
 * ```js
 * runSummaryLine('ℹ tests 12') // => 'ℹ run tests 12'
 * runSummaryLine('✔ opens the reader (2ms)') // => '✔ opens the reader (2ms)'
 * ```
 */
export function runSummaryLine(line) {
  const match = SUMMARY_LINE.exec(line)
  return match ? `ℹ run ${match[1]} ${match[2]}` : line
}

/**
 * Adds up the summary of every run into one summary in the runner's own form: the last summary block of each run ({@link readRunSummary}), never a line a test printed in that form.
 *
 * Called by `run-pregate-tests.mjs` after the last run, with the output of each run.
 *
 * @param outputs - The whole output of each run.
 * @returns The combined summary lines (`ℹ tests`, `ℹ pass`, `ℹ fail`, `ℹ cancelled`, `ℹ skipped`, `ℹ todo`), the counts of every run added up.
 *
 * @example
 * ```js
 * combinedSummary(['ℹ tests 2\nℹ pass 2\nℹ fail 0', 'ℹ tests 3\nℹ pass 2\nℹ fail 1'])
 * // => ['ℹ tests 5', 'ℹ pass 4', 'ℹ fail 1', 'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0']
 * ```
 */
export function combinedSummary(outputs) {
  const names = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']
  const totals = Object.fromEntries(names.map((name) => [name, 0]))
  for (const output of outputs) {
    // Only the run's own summary (its last block) is added; a line a test printed in that form is the test's text.
    const summary = readRunSummary(output) ?? {}
    // Only the counts are added; the duration of a run is no count.
    for (const name of names) totals[name] += summary[name] ?? 0
  }
  return names.map((name) => `ℹ ${name} ${totals[name]}`)
}
