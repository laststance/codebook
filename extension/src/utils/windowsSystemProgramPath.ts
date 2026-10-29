import { win32 } from 'node:path'

import {
  environmentVariable,
  type ProcessEnvironment,
} from './environmentVariable'

/** A path on a drive named by its letter, from that drive's root: `C:\…` or `C:/…`. A path rooted on the current drive (`\Windows`) or on a network share (`\\server\share`) is none. */
const DRIVE_LETTER_PATH = /^[A-Za-z]:[\\/]/

/**
 * Names a Windows program by its full path under the Windows system root, so that no program of that name in another folder is ever started in its place; called by {@link windowsPowerShellPath} and by the owned browser's `taskkill` ({@link REAL_PROCESS_STOPPER}).
 * `windir` names the same root where `SystemRoot` is missing. Only a path on a drive named by its letter is taken: a bare name or a relative path would be looked up in the current directory and the search path, a path rooted on the current drive (`\Windows`) changes with that drive, and a network share (`\\server\share`) is no system root of this machine; another program of that name could run there with the user's rights, so none of them is ever given.
 * @param segments - The program's path below the system root, for example `['System32', 'taskkill.exe']`.
 * @param environment - Where the system root is read from (`SystemRoot`, then `windir`, by names compared without regard to case as Windows compares them); `process.env` unless a test names its own.
 * @returns
 * - The full path under `SystemRoot` when it is a path on a drive named by its letter
 * - Otherwise the full path under `windir` when that is one
 * - `undefined` when neither is: the caller starts no program then
 * @example
 * windowsSystemProgramPath(['System32', 'taskkill.exe'], { SystemRoot: 'C:\\Windows' }) // => 'C:\\Windows\\System32\\taskkill.exe'
 * windowsSystemProgramPath(['System32', 'taskkill.exe'], { windir: 'D:\\WINNT' })       // => 'D:\\WINNT\\System32\\taskkill.exe'
 * windowsSystemProgramPath(['System32', 'taskkill.exe'], { SystemRoot: '\\Windows' })   // => undefined
 */
export function windowsSystemProgramPath(
  segments: readonly string[],
  environment: ProcessEnvironment = process.env,
): string | undefined {
  const systemRoot = ['SystemRoot', 'windir']
    .map((name) => environmentVariable(environment, name))
    .find(
      (root): root is string =>
        root !== undefined && DRIVE_LETTER_PATH.test(root),
    )
  return systemRoot === undefined
    ? undefined
    : win32.join(systemRoot, ...segments)
}
