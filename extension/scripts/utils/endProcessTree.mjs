import { planCallEnd } from './planCallEnd.mjs'
import { takeEndStep } from './takeEndStep.mjs'
import { CALL_KILL_GRACE_MS } from './testShardConstants.mjs'
import { trackProcessTree } from './trackProcessTree.mjs'

/** How long after its forced step a Windows end still waits for the child's exit, so the forced step's effect is seen before the caller goes on. */
const WAIT_AFTER_FORCED_STEP_MS = 250

/** Tells whether a spawned child has not exited yet. @example stillRuns(child) // => true */
function stillRuns(child) {
  return child.exitCode === null && child.signalCode === null
}

/** Ends the child and everything under it with SIGKILL, the tree read first (the child's children lose their parent link once it is gone). @example endTreeWithSigkill(child, 'linux') */
function endTreeWithSigkill(child, platform) {
  const tree = trackProcessTree(child.pid, { platform })
  tree.look()
  child.kill('SIGKILL')
  // A second look finds what the child started between the first look and its end.
  tree.look()
  tree.killRemaining()
}

/**
 * Ends a child's whole process tree now: on POSIX the child and every process under it at that moment get SIGKILL; on Windows the system's `taskkill /T /F` ends the tree, with its second start for a `taskkill` that hangs and the forced step after the grace.
 *
 * Why: the build, a `node --test` call and the recording's file processes start processes of their own, and a signal or a kill of the child alone leaves those running (a test file that ignores SIGTERM, a compiler of the build). The children stay in the script's own process group, so whoever ends that group (the pre-gate's supervisor, a terminal's Ctrl-C) ends them too; this function is for the ends the script takes itself.
 * Called by {@link runBuildWithLimit} at the build's limit, and by {@link endChildrenOnSignal}'s handler for every live child when the script gets SIGINT, SIGTERM or SIGHUP.
 * @param child - The spawned process.
 * @param options.platform - A value of `process.platform`; a test passes `win32` to take the Windows path.
 * @param options.environment - The environment, for `SystemRoot` on Windows ({@link planCallEnd}).
 * @param options.killGraceMs - On Windows, how long `taskkill` may take before the forced step ({@link takeEndStep}).
 * @returns A promise that resolves when the tree has been ended: at once on POSIX (SIGKILL is not caught), on Windows when the child has exited or just after the forced step at the end of the grace, so a caller that is about to exit has given every step its time.
 * @example
 * await endProcessTree(child, { platform: process.platform, environment: process.env })
 */
export function endProcessTree(
  child,
  {
    platform = process.platform,
    environment = process.env,
    killGraceMs = CALL_KILL_GRACE_MS,
  } = {},
) {
  if (child.pid === undefined || !stillRuns(child)) return Promise.resolve()
  if (platform !== 'win32') {
    endTreeWithSigkill(child, platform)
    return Promise.resolve()
  }
  const { terminate, force } = planCallEnd(platform, child.pid, environment)
  takeEndStep(child, terminate, killGraceMs)
  return new Promise((resolve) => {
    let forcedTimer
    const forceTimer = setTimeout(() => {
      if (stillRuns(child)) takeEndStep(child, force, killGraceMs)
      forcedTimer = setTimeout(finish, WAIT_AFTER_FORCED_STEP_MS)
    }, killGraceMs)
    function finish() {
      clearTimeout(forceTimer)
      clearTimeout(forcedTimer)
      resolve()
    }
    child.once('exit', finish)
  })
}
