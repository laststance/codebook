import { execFile } from 'node:child_process'

import { EXTENSION_CHROME_VERSION_READ_BOUND_MS } from '../../constants'

/**
 * Reads what a Chrome executable prints for `--version`, without starting a browser session.
 * Called by the owned launch's real dependencies before it spawns anything, so an unsupported Chrome is refused with nothing launched.
 * @param executable - The resolved Chrome executable.
 * @returns The trimmed output, for example `Google Chrome 156.0.8078.74`; an empty string when the executable cannot run, fails or prints nothing within {@link EXTENSION_CHROME_VERSION_READ_BOUND_MS}.
 * @example
 * await readChromeExecutableVersion('/usr/bin/google-chrome') // => 'Google Chrome 156.0.8078.74'
 */
export function readChromeExecutableVersion(
  executable: string,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      executable,
      ['--version'],
      { timeout: EXTENSION_CHROME_VERSION_READ_BOUND_MS, windowsHide: true },
      (error, stdout) => resolve(error === null ? stdout.trim() : ''),
    )
  })
}
