import { spawn } from 'node:child_process'

/** How many times the program that ends a tree is started when it hangs and is stopped: the first start and one more. */
const TREE_END_ATTEMPTS = 2

/**
 * Takes one step of {@link planCallEnd} against a child process: a signal for the child, or a program (`taskkill`) that ends its whole tree.
 *
 * A program that cannot start, or starts and exits with a failure (access denied, no process id), falls back to ending the child alone, so a call is never left running for want of `taskkill`. A program that hangs is stopped after half of `killGraceMs` and started once more, so the tree is still ended before the forced step of the plan (which ends the child alone) follows; a second start that hangs falls back to the child alone as well.
 *
 * Called by {@link watchCallSilence} for both steps of a silent call and by {@link endProcessTree} for the Windows end of a build at its limit and of every live child when the script gets SIGINT, SIGTERM or SIGHUP; on POSIX the plan's steps are signals, and the tree under the child is ended by {@link watchCallSilence} and {@link endProcessTree} themselves.
 * @param child - The spawned process.
 * @param step - `{ signal }` for `child.kill(signal)` or `{ command, args }` for a program to start.
 * @param killGraceMs - The time the caller leaves before its forced step; half of it bounds one start of the program.
 * @example
 * takeEndStep(child, { signal: 'SIGTERM' }, 5_000)
 * takeEndStep(child, { command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/pid', '4242', '/T', '/F'] }, 5_000)
 */
export function takeEndStep(child, step, killGraceMs) {
  if (step.signal) {
    child.kill(step.signal)
    return
  }
  const stillRuns = () => child.exitCode === null && child.signalCode === null
  // A failed start emits 'error' and may emit 'exit' too; the child is ended alone once, and only while it still runs.
  let fellBack = false
  const endChildAlone = () => {
    if (fellBack || !stillRuns()) return
    fellBack = true
    child.kill()
  }
  const start = (attemptsLeft) => {
    const ender = spawn(step.command, step.args, {
      stdio: 'ignore',
      windowsHide: true,
      timeout: Math.max(1, Math.floor(killGraceMs / 2)),
    })
    ender.on('error', endChildAlone)
    ender.on('exit', (code, signal) => {
      if (code === 0) return
      // A program stopped for its time (a signal ended it) gets one more start while the child runs.
      if (signal !== null && attemptsLeft > 1 && stillRuns()) {
        start(attemptsLeft - 1)
        return
      }
      endChildAlone()
    })
  }
  start(TREE_END_ATTEMPTS)
}
