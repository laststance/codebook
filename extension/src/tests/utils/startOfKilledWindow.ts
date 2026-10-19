import { processStartFormHere } from '../../utils/processStartFormHere'

/** When a process that began long ago began, as each system's query words it: clock tick 1 of the boot on Linux, the first second of the year 2001 for `ps` and for PowerShell. */
const EARLY_TIMES: Partial<Record<NodeJS.Platform, string>> = {
  linux: '1',
  darwin: 'Mon Jan  1 00:00:00 2001',
  win32: '2001-01-01T00:00:00.0000000Z',
}

/**
 * Gives the start a killed editor window recorded, for tests whose record names a process id that a live process has now: a start in the form {@link readProcessStart} answers in this process ({@link processStartFormHere}, on Linux with this process's pid namespace), which no process a test can meet has.
 * Only a record whose start has this process's form is judged here ({@link canJudgeOwnerHere}), so the text depends on the system the test runs on.
 * @returns `linux@<this pid namespace>:1` on Linux, `ps:Mon Jan  1 00:00:00 2001` on macOS, `win:2001-01-01T00:00:00.0000000Z` on Windows.
 * @throws On a system whose process starts cannot be read: the tests that need this start cannot run there.
 * @example
 * startOfKilledWindow() // => 'linux@4026531836:1'
 */
export function startOfKilledWindow(): string {
  const form = processStartFormHere(),
    time = EARLY_TIMES[process.platform]
  if (form === undefined || time === undefined)
    throw new Error(`No process start can be read on ${process.platform}.`)
  return `${form}:${time}`
}
