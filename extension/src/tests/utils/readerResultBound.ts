/**
 * How long a test waits for the reader's own work to show (a render, a store read, a debugger presentation) before it reads the wait as a hang.
 * Why: a loaded machine takes seconds for what an idle one does at once, so a one-second wait for a result fails although the result comes (Cycle 0050 F231); a reader that never shows it still fails, at this bound.
 * Read by the Study workspace and Wiki update tests whose waits failed under load.
 * @example await waitUntil(() => shown(), 'the restored stop', READER_RESULT_BOUND_MS)
 */
export const READER_RESULT_BOUND_MS = 10_000
