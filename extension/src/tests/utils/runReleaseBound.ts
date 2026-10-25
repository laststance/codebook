/**
 * How long a service test waits for a run's release to end (its final evidence write, its cleanup, its failure) before it reads the wait as a hang.
 * Why: a release that takes about 50 ms on an idle machine took over one second inside `pnpm health`'s instrumented coverage run, so a one-second wait failed although the release came (Cycle 0052 task 58); a release that never ends still fails, at this bound.
 * Read by the configured service tests that wait for a release.
 * @example await waitUntil(() => Boolean(record.cleanupError) && !record.stopping, 'the failed release', RUN_RELEASE_BOUND_MS)
 */
export const RUN_RELEASE_BOUND_MS = 10_000
