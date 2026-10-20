import { join, relative, sep } from 'node:path'

/** Where the TypeScript tests of the extension live, and where `build-fast` writes them as JavaScript. */
const SOURCE_TESTS = 'extension/src/tests/'
const COMPILED_TESTS = 'extension/dist/tests/'

/**
 * Turns the test files the gstack pre-gate selected into the files `node --test` runs, as absolute paths.
 *
 * Why: the pre-gate selects tests as repository paths, and the extension's TypeScript tests run only as the JavaScript that the build writes to `dist/tests`; the script and compaction-hook tests run as they are.
 * Called by `run-pregate-tests.mjs` for the pre-gate's `runner` in `.gstack/pregate.json`.
 *
 * @param repositoryRoot - The repository's root folder; the selected paths are relative to it.
 * @param selected - The selected test files, as the pre-gate names them.
 * @returns The absolute paths to run, in the order given.
 * @throws When a selected file is no test this runner can run, with its path, so a selection never passes as "0 tests".
 *
 * @example
 * ```js
 * mapPregateTests('/repo', ['extension/src/tests/citation.test.ts', '.codex/restore-product-context.test.mjs'])
 * // => ['/repo/extension/dist/tests/citation.test.js', '/repo/.codex/restore-product-context.test.mjs']
 * ```
 */
export function mapPregateTests(repositoryRoot, selected) {
  return selected.map((file) => {
    // The pre-gate names repository paths; an absolute path is read relative to the root, as written on any system.
    const path = relative(repositoryRoot, join(repositoryRoot, file))
      .split(sep)
      .join('/')
    // A TypeScript test runs as the JavaScript the build wrote for it.
    if (path.startsWith(SOURCE_TESTS) && path.endsWith('.test.ts'))
      return join(
        repositoryRoot,
        COMPILED_TESTS,
        `${path.slice(SOURCE_TESTS.length, -'.ts'.length)}.js`,
      )
    // The script tests and the compaction hook's test are JavaScript already.
    if (
      (path.startsWith('extension/scripts/tests/') ||
        path.startsWith('.codex/')) &&
      path.endsWith('.test.mjs')
    )
      return join(repositoryRoot, path)
    throw new Error(
      `The pre-gate selected ${file}, which is no test this runner runs (TypeScript tests under ${SOURCE_TESTS}, script tests under extension/scripts/tests/, or .codex/*.test.mjs).`,
    )
  })
}
