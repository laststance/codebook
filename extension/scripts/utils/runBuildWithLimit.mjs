import { spawn } from 'node:child_process'

import {
  endChildrenOnSignal,
  isEndingForSignal,
} from './endChildrenOnSignal.mjs'
import { endProcessTree } from './endProcessTree.mjs'
import { CALL_KILL_GRACE_MS } from './testShardConstants.mjs'

/**
 * Runs the build and ends it, with everything it started, when it takes longer than its limit or when the runner itself is ended by SIGINT, SIGTERM or SIGHUP.
 *
 * Why: a kill of the build's own process (`spawnSync`'s `killSignal`) leaves the processes the build started running. The build stays in the runner's process group (it gets no session of its own), so whoever ends that group ends the build too: the pre-gate's supervisor kills a lane's group, a terminal's Ctrl-C reaches it. The build (`build-fast.mjs`) starts no process of its own, so no group of its own exists below it; the one exception to "the lane's group holds everything the runner starts" is the package commands of `package.test.mjs` inside a test run, which run in groups of their own (`runPackageCommand`, `detached: true`) and end at their own limit and at a SIGINT, SIGTERM, SIGHUP or SIGQUIT to the package test. The runner's own ends go through {@link endProcessTree}: on POSIX the build and every process under it at that moment, read from the process table, get SIGKILL; on Windows the system's `taskkill /T /F` ends the tree, with its second start and the forced step ({@link planCallEnd}, {@link takeEndStep}), and the runner waits for those steps before it exits with 128 plus the signal's number ({@link endChildrenOnSignal}). A build that closes while a signal ends the runner answers nothing, so the runner's own exit with the build's code never comes before that one ({@link isEndingForSignal}).
 * Called by `scripts/run-pregate-tests.mjs` before any test runs.
 * @param options.command - The program to start.
 * @param options.args - Its arguments.
 * @param options.cwd - Its working folder.
 * @param options.timeoutMs - How long the build may take.
 * @param options.killGraceMs - On Windows, how long `taskkill` may take before the build is killed alone ({@link CALL_KILL_GRACE_MS} by default).
 * @param options.platform - A value of `process.platform`; a test passes `win32` to take the Windows path.
 * @param options.environment - The environment of the runner, for `SystemRoot` on Windows.
 * @returns `{ status, signal, timedOut, error }` once the build has closed (never while a signal ends the runner): its exit code (`null` when a signal ended it), the signal that ended it (`null` when it exited), whether it was ended for its time, and the error of a build that could not start.
 * @example
 * await runBuildWithLimit({ command: process.execPath, args: ['scripts/build-fast.mjs'], cwd: '/repo/extension', timeoutMs: 300_000 })
 * // => { status: 0, signal: null, timedOut: false, error: undefined }
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
    // Inside the runner's process group: a signal to the group reaches the build.
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    let timedOut = false
    const endTree = () =>
      endProcessTree(child, { platform, environment, killGraceMs })
    const limitTimer = setTimeout(() => {
      timedOut = true
      endTree()
    }, timeoutMs)
    // The runner's own end by a signal ends the build's tree, and waits for it, before the runner exits.
    const releaseSignalEnd = endChildrenOnSignal(endTree)
    const stop = () => {
      clearTimeout(limitTimer)
      releaseSignalEnd()
    }
    child.on('error', (error) => {
      stop()
      resolve({ status: null, signal: null, timedOut, error })
    })
    child.on('close', (status, signal) => {
      stop()
      // The build has no pipes, so it closes with its exit; on Windows that comes while the signal's handler still waits for it, and the handler exits next.
      if (isEndingForSignal()) return
      resolve({ status, signal, timedOut, error: undefined })
    })
  })
}
