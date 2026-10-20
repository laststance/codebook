import { spawn } from 'node:child_process'

import { createResettingTimer } from './createResettingTimer.mjs'
import { planCallEnd } from './planCallEnd.mjs'

/** Takes one step of {@link planCallEnd} against a call: a signal for the runner, or a program (`taskkill`) that ends its tree. A program that cannot start falls back to ending the runner alone, so a call is never left running for want of `taskkill`. */
function takeEndStep(child, step) {
  if (step.signal) {
    child.kill(step.signal)
    return
  }
  const ender = spawn(step.command, step.args, {
    stdio: 'ignore',
    windowsHide: true,
  })
  ender.on('error', () => child.kill())
}

/**
 * Ends a spawned `node --test` call that prints nothing for `silenceTimeoutMs`: the first step of {@link planCallEnd} at once, the second after `killGraceMs` when the call is still alive.
 *
 * Called by {@link runTestInvocation} for every planned shard call and by `scripts/run-pregate-tests.mjs` for every pre-gate run; the caller passes each chunk of the call's output to `keepAlive()` and calls `stop()` when the call has closed or failed to start.
 * @param child - The spawned runner.
 * @param options.silenceTimeoutMs - How long the call may print nothing before it is ended as hung.
 * @param options.killGraceMs - How long the first step may take before the forced one.
 * @returns `{ keepAlive, stop, timedOut }`: `keepAlive()` restarts the silence time, `stop()` clears every timer, `timedOut` is true once the call was ended for its silence.
 * @example
 * const watch = watchCallSilence(child, { silenceTimeoutMs: 120_000, killGraceMs: 5_000 })
 * child.stdout.on('data', () => watch.keepAlive())
 * child.on('close', () => watch.stop())
 */
export function watchCallSilence(child, { silenceTimeoutMs, killGraceMs }) {
  let timedOut = false
  let killTimer
  const silenceTimer = createResettingTimer(silenceTimeoutMs, () => {
    timedOut = true
    const { terminate, force } = planCallEnd(process.platform, child.pid)
    takeEndStep(child, terminate)
    if (force)
      killTimer = setTimeout(() => takeEndStep(child, force), killGraceMs)
  })
  return {
    keepAlive: () => silenceTimer.reset(),
    stop() {
      silenceTimer.stop()
      clearTimeout(killTimer)
    },
    get timedOut() {
      return timedOut
    },
  }
}
