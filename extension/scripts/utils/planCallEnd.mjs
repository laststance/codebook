import { join } from 'node:path'

/**
 * Answers how to end a `node --test` call that went silent on one system, as the steps {@link watchCallSilence} takes.
 *
 * Why: on POSIX, SIGTERM makes the runner print what it was running (which names the hung test) and pass the signal on to the test-file processes it started, which a test file that ignores it survives; {@link watchCallSilence} therefore reads the runner's process tree before the signal and kills with SIGKILL every process of it that still runs, after the grace or as soon as the runner has exited, while the plan's own forced step ends the runner itself. On Windows, `child.kill()` is TerminateProcess on the runner alone, so the test-file processes it started would keep running; `taskkill /T /F` ends the runner and its whole process tree at once. The program is the system's own `taskkill.exe` by its full path, never the bare name `taskkill`: Windows looks for a bare name in the working folder before `PATH`, and the working folder can be a cloned repository. The forced step is `child.kill('SIGKILL')` (TerminateProcess on the runner alone), for a `taskkill` that failed and a runner that did not end after the fallback of {@link watchCallSilence}.
 * Called by {@link watchCallSilence} with `process.platform`, the runner's pid and `process.env`.
 * @param platform - A value of `process.platform`.
 * @param pid - The runner's process id.
 * @param environment - The environment variables, for `SystemRoot` (`C:\\Windows` when it is not set).
 * @returns `{ terminate, force }`: the first step, and the step to take when the call is still alive after the grace. A step is `{ signal }` for `child.kill(signal)` or `{ command, args }` for a program to start.
 * @example
 * planCallEnd('linux', 4242, {}) // => { terminate: { signal: 'SIGTERM' }, force: { signal: 'SIGKILL' } }
 * planCallEnd('win32', 4242, { SystemRoot: 'C:\\Windows' }) // => { terminate: { command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/pid', '4242', '/T', '/F'] }, force: { signal: 'SIGKILL' } }
 */
export function planCallEnd(platform, pid, environment = process.env) {
  if (platform === 'win32')
    return {
      terminate: {
        command: join(
          environment.SystemRoot ?? 'C:\\Windows',
          'System32',
          'taskkill.exe',
        ),
        args: ['/pid', String(pid), '/T', '/F'],
      },
      force: { signal: 'SIGKILL' },
    }
  return { terminate: { signal: 'SIGTERM' }, force: { signal: 'SIGKILL' } }
}
