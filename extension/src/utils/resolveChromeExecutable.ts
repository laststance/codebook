import { delimiter, join } from 'node:path'

import {
  CHROME_LINUX_EXECUTABLE_NAMES,
  CHROME_MACOS_EXECUTABLE_PATH,
} from '../constants'

/**
 * Chooses the Chrome executable that the repository-browser prerequisite checks, so an unset `codebook.chromeExecutable` means the host's usual Chrome.
 * Called by {@link createChromeExecutableLookup}, which remembers a PATH search between the environment's prerequisite checks (every status and start).
 * @param configured - The `codebook.chromeExecutable` value; empty when the learner never set it.
 * @param platform - The extension host's platform (a WSL remote host is `linux`).
 * @param searchPath - The extension host's PATH, searched only on Linux.
 * @param isExecutable - Whether a path is an executable file; the caller's own filesystem check.
 * @returns
 * - A non-empty configured value: that value, unchanged
 * - Unset on macOS: {@link CHROME_MACOS_EXECUTABLE_PATH}
 * - Unset on Linux: the first of {@link CHROME_LINUX_EXECUTABLE_NAMES} found executable on PATH
 * - Otherwise: undefined
 * @example
 * await resolveChromeExecutable('/opt/chrome', 'linux', '/usr/bin', isExecutable) // => '/opt/chrome'
 * await resolveChromeExecutable('', 'darwin', '', isExecutable) // => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
 * await resolveChromeExecutable('', 'linux', '/usr/bin', isExecutable) // => '/usr/bin/google-chrome' when installed there
 */
export async function resolveChromeExecutable(
  configured: string,
  platform: NodeJS.Platform,
  searchPath: string | undefined,
  isExecutable: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (configured) return configured
  if (platform === 'darwin') return CHROME_MACOS_EXECUTABLE_PATH
  if (platform !== 'linux') return undefined
  const directories = (searchPath ?? '')
    .split(delimiter)
    .filter((directory) => directory.length > 0)
  // Name order outranks PATH order: a learner with both Chrome and Chromium gets Google Chrome.
  for (const name of CHROME_LINUX_EXECUTABLE_NAMES)
    for (const directory of directories) {
      const candidate = join(directory, name)
      if (await isExecutable(candidate)) return candidate
    }
  return undefined
}
