import { constants } from 'node:os'

/** The signals that end a script of this repository: Ctrl-C, a plain kill and a closed terminal. */
const ENDING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** The ways to end what is running, one per live child (or group of processes), and whether an end is already under way. */
const liveEnds = new Set()
let isEnding = false

/** Ends everything that runs, waits for it, then exits with 128 plus the signal's number, as a shell reports a process that a signal ended. @example handleSignal('SIGTERM') // exits with 143 */
function handleSignal(signal) {
  // A second signal while the first is handled changes nothing: the ends are under way.
  if (isEnding) return
  isEnding = true
  const ends = [...liveEnds].map((end) => Promise.resolve().then(end))
  Promise.allSettled(ends).then(() =>
    process.exit(128 + constants.signals[signal]),
  )
}

/**
 * Makes this process end a child's whole tree, and exit, when it gets SIGINT, SIGTERM or SIGHUP while the child runs.
 *
 * Why: a child that is not killed with its parent keeps running, and keeps writing `dist` or holding the CPU, after the script that started it was ended. The handlers exist only while a child is registered, so a script with nothing running keeps Node's own reaction to a signal, and a test that checks the handler count after a call finds none.
 * Called by {@link watchCallSilence} for every `node --test` call of `test-shard.mjs` and `run-pregate-tests.mjs`, by {@link runBuildWithLimit} for the build, and by {@link collectTestRun} for the file processes of the recording.
 * @param end - Ends the child's whole tree and answers a promise that resolves when the end is done ({@link endProcessTree}); the exit waits for it, so on Windows the `taskkill` steps get their time before Node exits.
 * @returns A function that unregisters the child (call it when the child has closed); the last one removes the handlers.
 * @example
 * const release = endChildrenOnSignal(() => endProcessTree(child))
 * child.on('close', release)
 */
export function endChildrenOnSignal(end) {
  if (liveEnds.size === 0 && !isEnding)
    for (const signal of ENDING_SIGNALS) process.on(signal, handleSignal)
  liveEnds.add(end)
  return () => {
    liveEnds.delete(end)
    if (liveEnds.size === 0 && !isEnding)
      for (const signal of ENDING_SIGNALS)
        process.removeListener(signal, handleSignal)
  }
}

/**
 * Tells whether a signal is ending this process: a handler of {@link endChildrenOnSignal} is ending every live child's tree and exits with 128 plus the signal's number once those ends are done.
 *
 * Why: on Windows the handler waits for a child's own exit, and a child with no pipes closes together with that exit, before the handler has exited; a caller that got an answer then would go on first, and exit with the child's code. Called by {@link runBuildWithLimit}, whose build closes that way, so the pre-gate runner's `process.exit(build.status ?? 1)` never comes before the handler's exit.
 * @returns `true` from the first SIGINT, SIGTERM or SIGHUP that came while a child was registered; `false` before.
 * @example
 * child.on('close', (status) => {
 *   if (isEndingForSignal()) return
 *   resolve(status)
 * })
 */
export function isEndingForSignal() {
  return isEnding
}
