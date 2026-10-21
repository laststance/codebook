import { spawn } from 'node:child_process'

import { planCallEnd } from './planCallEnd.mjs'
import { takeEndStep } from './takeEndStep.mjs'
import { CALL_KILL_GRACE_MS } from './testShardConstants.mjs'

/**
 * Runs the build and ends it, with everything it started, when it takes longer than its limit.
 *
 * Why: a kill of the build's own process (`spawnSync`'s `killSignal`) leaves the processes the build started running. On POSIX the build gets a process group of its own, so one SIGKILL to the group ends the whole tree, also at a SIGINT or SIGTERM of the runner (the build is not in the terminal's group, so the signal would not reach it). On Windows the system's `taskkill /T /F` ends the tree ({@link planCallEnd}, {@link takeEndStep}).
 * Called by `scripts/run-pregate-tests.mjs` before any test runs.
 * @param options.command - The program to start.
 * @param options.args - Its arguments.
 * @param options.cwd - Its working folder.
 * @param options.timeoutMs - How long the build may take.
 * @param options.killGraceMs - On Windows, how long `taskkill` may take before the build is killed alone ({@link CALL_KILL_GRACE_MS} by default).
 * @param options.platform - A value of `process.platform`; a test passes `win32` to take the Windows path.
 * @param options.environment - The environment of the runner, for `SystemRoot` on Windows.
 * @returns `{ status, timedOut, error }` once the build has closed: its exit code (`null` when a signal ended it), whether it was ended for its time, and the error of a build that could not start.
 * @example
 * await runBuildWithLimit({ command: process.execPath, args: ['scripts/build-fast.mjs'], cwd: '/repo/extension', timeoutMs: 300_000 })
 * // => { status: 0, timedOut: false, error: undefined }
 */
export function runBuildWithLimit({
  command,
  args,
  cwd,
  timeoutMs,
  killGraceMs = CALL_KILL_GRACE_MS,
  platform = process.platform,
  environment = process.env,
}) {
  return new Promise((resolve) => {
    const ownGroup = platform !== 'win32'
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      // A group of its own on POSIX: the whole tree is one target for a signal.
      detached: ownGroup,
    })
    let timedOut = false
    let forceTimer
    const stillRuns = () => child.exitCode === null && child.signalCode === null

    /** Ends the build's whole tree now: SIGKILL to the group, or taskkill on Windows with the forced step after the grace. */
    const endTree = () => {
      if (child.pid === undefined) return
      if (ownGroup) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The group is gone already, or the system refused; the build alone is still ended.
          child.kill('SIGKILL')
        }
        return
      }
      const { terminate, force } = planCallEnd(platform, child.pid, environment)
      takeEndStep(child, terminate, killGraceMs)
      forceTimer = setTimeout(() => {
        if (stillRuns()) takeEndStep(child, force, killGraceMs)
      }, killGraceMs)
    }

    const limitTimer = setTimeout(() => {
      timedOut = true
      endTree()
    }, timeoutMs)

    // The runner's own end by signal ends the build too: the build is not in the terminal's group.
    const endWithRunner = (signal) => {
      endTree()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    process.once('SIGINT', endWithRunner)
    process.once('SIGTERM', endWithRunner)
    const stop = () => {
      clearTimeout(limitTimer)
      clearTimeout(forceTimer)
      process.removeListener('SIGINT', endWithRunner)
      process.removeListener('SIGTERM', endWithRunner)
    }
    child.on('error', (error) => {
      stop()
      resolve({ status: null, timedOut, error })
    })
    child.on('close', (status) => {
      stop()
      resolve({ status, timedOut, error: undefined })
    })
  })
}
