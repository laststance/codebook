import { constants } from 'node:os'

/** The signals that end a script of this repository: Ctrl-C, a plain kill and a closed terminal. */
const ENDING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** The ways to end what is running, one per live child (or group of processes), whether an end is already under way, and the ends already started (the exit waits for every one of them). */
const liveEnds = new Set()
const startedEnds = []
let isEnding = false

/** Starts one end in a microtask, so an end that throws or fails settles as a rejection that the exit does not mind, and remembers it for the exit to wait for. @example startEnd(() => endProcessTree(child)) */
function startEnd(end) {
  startedEnds.push(Promise.resolve().then(end))
}

/** Waits for every end started so far, and for the ones started while it waited (a child registered after the first signal), then exits with 128 plus the signal's number. @example await exitAfterEnds('SIGTERM') // exits with 143 */
async function exitAfterEnds(signal) {
  // The list can grow while the ends run: wait for each batch, and look again until no end is left unwaited for.
  for (let waitedFor = 0; waitedFor < startedEnds.length;) {
    const batch = startedEnds.slice(waitedFor)
    waitedFor = startedEnds.length
    await Promise.allSettled(batch)
  }
  process.exit(128 + constants.signals[signal])
}

/** Ends everything that runs, waits for it, then exits with 128 plus the signal's number, as a shell reports a process that a signal ended. @example handleSignal('SIGTERM') // exits with 143 */
function handleSignal(signal) {
  // A second signal while the first is handled changes nothing: the ends are under way.
  if (isEnding) return
  isEnding = true
  for (const end of liveEnds) startEnd(end)
  void exitAfterEnds(signal)
}

/**
 * Makes this process end a child's whole tree, and exit, when it gets SIGINT, SIGTERM or SIGHUP while the child runs.
 *
 * Why: a child that is not killed with its parent keeps running, and keeps writing `dist` or holding the CPU, after the script that started it was ended. The handlers exist only while a child is registered, so a script with nothing running keeps Node's own reaction to a signal, and a test that checks the handler count after a call finds none. Once a signal is handled the handlers stay until the exit, whatever is released.
 *
 * A child registered after the first signal (a lane that starts its next call while the handler still waits for the first ends) is ended at once, and the exit waits for that end too; its release is a function that changes nothing.
 * Called by {@link watchCallSilence} for every `node --test` call of `test-shard.mjs` and `run-pregate-tests.mjs`, by {@link runBuildWithLimit} for the build, and by {@link collectTestRun} for the file processes of the recording.
 * @param end - Ends the child's whole tree and answers a promise that resolves when the end is done ({@link endProcessTree}); the exit waits for it, so on Windows the `taskkill` steps get their time before Node exits.
 * @returns A function that unregisters the child (call it when the child has closed); the last one removes the handlers, unless a signal is being handled. Calling it again changes nothing.
 * @example
 * const release = endChildrenOnSignal(() => endProcessTree(child))
 * child.on('close', release)
 */
export function endChildrenOnSignal(end) {
  // A signal is being handled: the child is ended at once and the exit waits for it; there is nothing to unregister.
  if (isEnding) {
    startEnd(end)
    return () => {}
  }
  if (liveEnds.size === 0)
    for (const signal of ENDING_SIGNALS) process.on(signal, handleSignal)
  liveEnds.add(end)
  return () => {
    liveEnds.delete(end)
    // The handlers stay while a signal is handled: the exit comes after the ends, and a second signal must still find the handler.
    if (liveEnds.size === 0 && !isEnding)
      for (const signal of ENDING_SIGNALS)
        process.removeListener(signal, handleSignal)
  }
}

/**
 * Tells whether a signal is ending this process: a handler of {@link endChildrenOnSignal} is ending every live child's tree and exits with 128 plus the signal's number once those ends are done.
 *
 * Why: on Windows the handler waits for a child's own exit, and a child closes together with that exit, before the handler has exited (the build has no pipes; a call's pipes close with its exit); a caller that got an answer then would go on first: the pre-gate runner would exit with the build's code, a lane of the shard script or the pre-gate's loop would start its next call or run, after the handler took its list of ends, and nothing would end that child before the exit. On POSIX the handler can wait for another end while a child has closed, too. Called by {@link runBuildWithLimit}, {@link runTestInvocation} and `scripts/run-pregate-tests.mjs`, in the `close` handler of the child they started, so a child that closes while a signal ends the script answers nothing.
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
