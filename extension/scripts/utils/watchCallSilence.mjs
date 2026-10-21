import { childStillRuns } from './childStillRuns.mjs'
import { createResettingTimer } from './createResettingTimer.mjs'
import { endChildrenOnSignal } from './endChildrenOnSignal.mjs'
import { endProcessTree } from './endProcessTree.mjs'
import { planCallEnd } from './planCallEnd.mjs'
import { takeEndStep } from './takeEndStep.mjs'
import { trackProcessTree } from './trackProcessTree.mjs'

/** How often the tree of a call that is being ended is read again, so a process started under a known one after the first look is found before the call is killed. */
const TREE_LOOK_INTERVAL_MS = 250

/**
 * Watches a spawned `node --test` call: ends it, with its whole process tree, when it prints nothing for `silenceTimeoutMs`, and ends it too when this process is ended by SIGINT, SIGTERM or SIGHUP.
 *
 * A silent call is ended in the steps of {@link planCallEnd}: the first at once, the second after `killGraceMs` when the call is still alive. On POSIX the runner gets SIGTERM first (it prints what it was running, which names the hung test), and its tree is read before that signal, because the test-file processes it started lose their parent when it exits. When the grace has passed the runner is stopped (SIGSTOP, which it cannot ignore), so it starts nothing more, its tree is read once more and the runner is killed; as soon as the runner has exited, if that comes first, the tree read so far is ended without that look. Every process of that tree that still runs gets SIGKILL, those started under them after the first look included ({@link killProcessIds} stops each of them first and reads what it started): a test file that ignores SIGTERM and hangs ends with its call. On Windows the first step is `taskkill /T /F`, which ends the tree itself.
 * The call stays in this process's own group, so whoever ends that group (a terminal's Ctrl-C, the pre-gate's supervisor) ends it too; a signal this process can handle ends the call's tree by {@link endProcessTree}, and the process exits after that ({@link endChildrenOnSignal}).
 *
 * Called by {@link runTestInvocation} for every planned shard call and by `scripts/run-pregate-tests.mjs` for every pre-gate run; the caller passes each chunk of the call's output to `keepAlive()` and calls `stop()` when the call has closed or failed to start.
 * @param child - The spawned runner.
 * @param options.silenceTimeoutMs - How long the call may print nothing before it is ended as hung.
 * @param options.killGraceMs - How long the first step may take before the forced one.
 * @returns `{ keepAlive, stop, timedOut }`: `keepAlive()` restarts the silence time, `stop()` clears every timer and ends what is left of a call that was ended for its silence, `timedOut` is true once the call was ended for its silence.
 * @example
 * const watch = watchCallSilence(child, { silenceTimeoutMs: 120_000, killGraceMs: 5_000 })
 * child.stdout.on('data', () => watch.keepAlive())
 * child.on('close', () => watch.stop())
 */
export function watchCallSilence(child, { silenceTimeoutMs, killGraceMs }) {
  let timedOut = false
  let killTimer
  let lookTimer
  let tree
  const releaseSignalEnd = endChildrenOnSignal(() =>
    endProcessTree(child, {
      platform: process.platform,
      environment: process.env,
      killGraceMs,
    }),
  )
  const endForSilence = () => {
    timedOut = true
    const { terminate, force } = planCallEnd(
      process.platform,
      child.pid,
      process.env,
    )
    // On Windows `taskkill /T` ends the tree; on POSIX the tree is read now, before the runner's own end hides it.
    if (process.platform !== 'win32') {
      tree = trackProcessTree(child.pid)
      tree.look()
      lookTimer = setInterval(() => tree.look(), TREE_LOOK_INTERVAL_MS)
      // The runner has gone: what it started is killed at once, not at the end of the grace.
      child.once('exit', () => tree.killRemaining())
    }
    takeEndStep(child, terminate, killGraceMs)
    killTimer = setTimeout(() => {
      // The runner is stopped before its tree is read, so it starts nothing between the look and its kill; a runner that has exited gives its tree no more, and a plain look is all that is left.
      if (tree && childStillRuns(child)) tree.stopAndLook(child)
      else tree?.look()
      takeEndStep(child, force, killGraceMs)
      tree?.killRemaining()
    }, killGraceMs)
  }
  const silenceTimer = createResettingTimer(silenceTimeoutMs, endForSilence)
  return {
    keepAlive: () => silenceTimer.reset(),
    stop() {
      silenceTimer.stop()
      clearTimeout(killTimer)
      clearInterval(lookTimer)
      releaseSignalEnd()
      // The call has closed: nothing that was found under it may stay.
      tree?.killRemaining()
    },
    get timedOut() {
      return timedOut
    },
  }
}
