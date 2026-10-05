/** The start of a process that began long ago, in the form each system's query answers: clock tick 1 of the boot on Linux, the first second of the year 2001 for `ps` and for PowerShell. */
const EARLY_STARTS: Partial<Record<NodeJS.Platform, string>> = {
  linux: 'linux:1',
  darwin: 'ps:Mon Jan  1 00:00:00 2001',
  win32: 'win:2001-01-01T00:00:00.0000000Z',
}

/**
 * Gives the start a killed editor window recorded, for tests whose record names a process id that a live process has now: a start in the form {@link readProcessStart} answers on this system, which no process a test can meet has.
 * Only starts of one form are compared ({@link isRecordedOwnerGone}), so the text depends on the system the test runs on.
 * @returns `linux:1` on Linux, `ps:Mon Jan  1 00:00:00 2001` on macOS, `win:2001-01-01T00:00:00.0000000Z` on Windows.
 * @throws On a system whose process starts cannot be read: the tests that need this start cannot run there.
 * @example
 * startOfKilledWindow() // => 'linux:1'
 */
export function startOfKilledWindow(): string {
  const start = EARLY_STARTS[process.platform]
  if (start === undefined)
    throw new Error(`No process start can be read on ${process.platform}.`)
  return start
}
