import { uptime } from 'node:os'

import {
  LINUX_CLOCK_TICKS_PER_SECOND,
  MILLISECONDS_PER_SECOND,
  PROCESS_START_FORMS,
  PROCESS_START_NAMESPACE_MARK,
} from '../constants'

/**
 * Turns a process start as {@link readProcessStart} reads it into the time of the wall clock at which the process began; called by {@link recordingMayStillBeWritten} to tell a recording's writer from a later process that got its id.
 * Windows and macOS give a UTC time. Linux gives clock ticks since the kernel's boot, which are added to the boot time (the wall clock minus the uptime): a correction of the clock moves that by seconds, so a caller compares with a tolerance.
 * @param processStart - `win:<UTC time>`, `ps:<text of ps -o lstart= in UTC>`, or `linux[@<pid namespace>]:<ticks>`.
 * @param bootedAtMs - When this machine booted, by the wall clock; computed from the uptime unless a test names its own.
 * @returns The start in milliseconds since the epoch; `undefined` for a form or a text that names no time.
 * @example
 * processStartedAtMs('win:2026-10-05T09:12:33.1234567Z')                // => 1791191553123
 * processStartedAtMs('ps:Mon Oct  5 09:12:33 2026')                     // => 1791191553000
 * processStartedAtMs('linux@4026531836:16362446', 1_790_000_000_000)    // => 1790163624460
 */
export function processStartedAtMs(
  processStart: string,
  bootedAtMs: number = Date.now() - uptime() * MILLISECONDS_PER_SECOND,
): number | undefined {
  const separator = processStart.indexOf(':')
  const form = processStart.slice(0, separator),
    value = processStart.slice(separator + 1)
  // The pid namespace names no time; only the system before it decides how the value is read.
  const system = form.split(PROCESS_START_NAMESPACE_MARK)[0]
  let startedAtMs = Number.NaN
  if (system === PROCESS_START_FORMS.linux && /^\d+$/.test(value))
    startedAtMs =
      bootedAtMs +
      (Number(value) / LINUX_CLOCK_TICKS_PER_SECOND) * MILLISECONDS_PER_SECOND
  else if (system === PROCESS_START_FORMS.win32) startedAtMs = Date.parse(value)
  // `ps` prints the start in UTC (its query sets TZ=UTC) without saying so.
  else if (system === PROCESS_START_FORMS.darwin)
    startedAtMs = Date.parse(`${value} UTC`)
  return separator > 0 && Number.isFinite(startedAtMs) ? startedAtMs : undefined
}
