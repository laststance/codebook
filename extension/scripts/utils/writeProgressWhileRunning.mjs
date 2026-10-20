import { PROGRESS_LINE_INTERVAL_MS } from './testShardConstants.mjs'

/**
 * Runs an async step and writes a progress line every `intervalMs` until it ends.
 *
 * Why: the package build in the `before` hook of `package.test.mjs` runs several commands in turn (`pnpm --version`, `pnpm build`, the bundling and packaging steps), each with its own limit of `PACKAGE_COMMAND_TIMEOUT_MS`, so the hook may print nothing for longer than any one silence limit. Node's test runner passes a test file's output on as it is written, so the silence watch of {@link watchCallSilence} sees the lines and the run is not ended as hung; a command that hangs is still ended by its own limit.
 * The timer cannot fire while a synchronous Git call of the build blocks the process, so a stretch of that kind stays silent; the silence limit that {@link silenceLimitOfRun} gives that run is above one such call.
 * Called by the `before` hook of `scripts/tests/package.test.mjs` around {@link buildPackage}.
 *
 * @param step - The async function to run.
 * @param options.intervalMs - How often a line is written; {@link PROGRESS_LINE_INTERVAL_MS} by default.
 * @param options.write - Where a line goes; standard output by default.
 * @returns What the step returns.
 * @throws What the step throws; the timer is stopped first.
 *
 * @example
 * ```js
 * receipt = await writeProgressWhileRunning(() => buildPackage(repository, artifact))
 * ```
 */
export async function writeProgressWhileRunning(
  step,
  {
    intervalMs = PROGRESS_LINE_INTERVAL_MS,
    write = (line) => process.stdout.write(line),
  } = {},
) {
  const startedAt = performance.now()
  const timer = setInterval(
    () =>
      write(
        `still running, ${Math.round((performance.now() - startedAt) / 1000)} s so far\n`,
      ),
    intervalMs,
  )
  try {
    return await step()
  } finally {
    clearInterval(timer)
  }
}
