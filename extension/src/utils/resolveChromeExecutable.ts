import { delimiter, join } from 'node:path'

import {
  CHROME_LINUX_EXECUTABLE_NAMES,
  CHROME_MACOS_EXECUTABLE_PATH,
} from '../constants'

/**
 * Names the Chrome executable that needs no search; called by {@link resolveChromeExecutable} before PATH is looked at.
 * @param configured - The `codebook.chromeExecutable` value; empty when the learner never set it.
 * @param platform - The extension host's platform.
 * @returns
 * - A non-empty configured value: that value, unchanged
 * - Unset on macOS: {@link CHROME_MACOS_EXECUTABLE_PATH}
 * - Otherwise: undefined
 * @example
 * fixedChromeExecutable('/opt/chrome', 'linux') // => '/opt/chrome'
 * fixedChromeExecutable('', 'darwin')           // => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
 * fixedChromeExecutable('', 'linux')            // => undefined
 */
function fixedChromeExecutable(
  configured: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (configured) return configured
  return platform === 'darwin' ? CHROME_MACOS_EXECUTABLE_PATH : undefined
}

/**
 * Lists the folders of a PATH value; called by {@link linuxChromeCandidates} once per search.
 * @param searchPath - The extension host's PATH; `undefined` when it has none.
 * @returns The folders in PATH order, without empty entries.
 * @example
 * searchDirectories('/usr/local/bin::/usr/bin') // => ['/usr/local/bin', '/usr/bin']
 * searchDirectories(undefined)                  // => []
 */
function searchDirectories(searchPath: string | undefined): string[] {
  return (searchPath ?? '')
    .split(delimiter)
    .filter((directory) => directory.length > 0)
}

/**
 * Names, one at a time, the paths at which Chrome may be installed on a Linux host; called by {@link resolveChromeExecutable}, which checks each path before it asks for the next.
 * @param platform - The extension host's platform (a WSL remote host is `linux`).
 * @param searchPath - The extension host's PATH.
 * @returns Every one of {@link CHROME_LINUX_EXECUTABLE_NAMES} in every folder of PATH, the names outermost; nothing on any other platform.
 * @example
 * [...linuxChromeCandidates('linux', '/usr/local/bin:/usr/bin')]
 * // => ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome-stable', …]
 * [...linuxChromeCandidates('win32', 'C:\\Windows')] // => []
 */
function* linuxChromeCandidates(
  platform: NodeJS.Platform,
  searchPath: string | undefined,
): Generator<string, void, undefined> {
  if (platform !== 'linux') return
  const directories = searchDirectories(searchPath)
  // Name order outranks PATH order: a learner with both Chrome and Chromium gets Google Chrome.
  for (const name of CHROME_LINUX_EXECUTABLE_NAMES)
    for (const directory of directories) yield join(directory, name)
}

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
  const fixed = fixedChromeExecutable(configured, platform)
  if (fixed !== undefined) return fixed
  for (const candidate of linuxChromeCandidates(platform, searchPath))
    if (await isExecutable(candidate)) return candidate
  return undefined
}
