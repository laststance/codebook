/**
 * Answers how to end a `node --test` call that went silent on one system, as the steps {@link watchCallSilence} takes.
 *
 * Why: on POSIX, SIGTERM makes the runner end the test-file processes it started and print what it was running, and SIGKILL is only for a runner that ignores it. On Windows, `child.kill()` is TerminateProcess on the runner alone, so the test-file processes it started would keep running; `taskkill /T /F` ends the runner and its whole process tree at once (there is no gentler step to wait for).
 * Called by {@link watchCallSilence} with `process.platform` and the runner's pid.
 * @param platform - A value of `process.platform`.
 * @param pid - The runner's process id.
 * @returns `{ terminate, force }`: the first step, and the step to take when the call is still alive after the grace (`undefined` when the first step is already forced). A step is `{ signal }` for `child.kill(signal)` or `{ command, args }` for a program to start.
 * @example
 * planCallEnd('linux', 4242) // => { terminate: { signal: 'SIGTERM' }, force: { signal: 'SIGKILL' } }
 * planCallEnd('win32', 4242) // => { terminate: { command: 'taskkill', args: ['/pid', '4242', '/T', '/F'] }, force: undefined }
 */
export function planCallEnd(platform, pid) {
  if (platform === 'win32')
    return {
      terminate: {
        command: 'taskkill',
        args: ['/pid', String(pid), '/T', '/F'],
      },
      force: undefined,
    }
  return { terminate: { signal: 'SIGTERM' }, force: { signal: 'SIGKILL' } }
}
