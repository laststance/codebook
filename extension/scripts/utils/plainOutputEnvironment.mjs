/**
 * Copies an environment for a `node --test` call whose summary lines are read as text: without `FORCE_COLOR`, with `NO_COLOR`.
 *
 * Why: with `FORCE_COLOR` set, the spec reporter colours its summary lines also on a pipe (`ESC[34mℹ tests 1ESC[39m`), so the counts that {@link runTestInvocation}'s caller and {@link combinedSummary} read from them are 0.
 * Called by {@link runTestInvocation} for each call of `test-shard.mjs` and by `run-pregate-tests.mjs` for each run it starts.
 *
 * @param environment - The environment to copy, usually `process.env`.
 * @returns A new object that holds every variable of `environment` except `FORCE_COLOR`, with `NO_COLOR` set to `1`.
 *
 * @example
 * ```js
 * plainOutputEnvironment({ FORCE_COLOR: '1', PATH: '/usr/bin' }) // => { PATH: '/usr/bin', NO_COLOR: '1' }
 * ```
 */
export function plainOutputEnvironment(environment) {
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(([name]) => name !== 'FORCE_COLOR'),
    ),
    NO_COLOR: '1',
  }
}
