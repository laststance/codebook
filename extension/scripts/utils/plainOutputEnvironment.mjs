/**
 * Copies an environment for a `node --test` call whose summary lines are read as text: without `FORCE_COLOR`, and with no `NO_COLOR` added.
 *
 * Why: with `FORCE_COLOR` set, the spec reporter colours its summary lines also on a pipe (`ESC[34mℹ tests 1ESC[39m`), so the counts that {@link runTestInvocation}'s caller and {@link combinedSummary} read from them are 0. Without `FORCE_COLOR` the reporter writes no colour to a pipe, so `NO_COLOR` is not needed; setting it made Node warn on stderr ("The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set") for every nested child that sets `FORCE_COLOR` itself (Cycle 0048 task 116).
 * Called by {@link runTestInvocation} for each call of `test-shard.mjs` and by `run-pregate-tests.mjs` for each run it starts.
 *
 * @param environment - The environment to copy, usually `process.env`. A `NO_COLOR` the caller already set stays as it is.
 * @returns A new object that holds every variable of `environment` except `FORCE_COLOR`.
 *
 * @example
 * ```js
 * plainOutputEnvironment({ FORCE_COLOR: '1', PATH: '/usr/bin' }) // => { PATH: '/usr/bin' }
 * ```
 */
export function plainOutputEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => name !== 'FORCE_COLOR'),
  )
}
