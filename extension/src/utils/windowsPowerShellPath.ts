import { win32 } from 'node:path'

/** The environment the Windows system root is read from (`SystemRoot`, then `windir`, by names compared without regard to case as Windows compares them): `process.env` in the product, a test's own object in tests. */
export type SystemRootEnvironment = Readonly<Record<string, string | undefined>>

/** Where Windows PowerShell lies under the Windows system root. */
const POWERSHELL_UNDER_SYSTEM_ROOT = [
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
]

/** A path on a drive named by its letter, from that drive's root: `C:\…` or `C:/…`. A path rooted on the current drive (`\Windows`) or on a network share (`\\server\share`) is none. */
const DRIVE_LETTER_PATH = /^[A-Za-z]:[\\/]/

/**
 * Reads one variable of an environment as Windows does, without regard to the case of its name; called by {@link windowsPowerShellPath} for `SystemRoot` and `windir`.
 * Why: `process.env` of Windows already answers any case, but a plain object (a copy of the environment, a test's own) holds the name as it was written, for example `SYSTEMROOT`.
 * @param environment - The environment.
 * @param name - The variable's name.
 * @returns The value of the first name that equals `name` in any case; `undefined` when none does.
 * @example
 * variableOf({ SYSTEMROOT: 'C:\\Windows' }, 'SystemRoot') // => 'C:\\Windows'
 */
function variableOf(
  environment: SystemRootEnvironment,
  name: string,
): string | undefined {
  const key = Object.keys(environment).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  )
  return key === undefined ? undefined : environment[key]
}

/**
 * Names the program a Windows query starts, by its full path under the Windows system root, so that no `powershell.exe` of another folder is ever started in its place; called by {@link readProcessStart}'s Windows query and by {@link listProcesses} for the Windows listing.
 * Windows PowerShell lies at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; `windir` names the same root where `SystemRoot` is missing. Only a path on a drive named by its letter is taken: a bare name or a relative path would be looked up in the current directory and the search path, a path rooted on the current drive (`\Windows`) changes with that drive, and a network share (`\\server\share`) is no system root of this machine; another program of that name could run there with the user's rights, so none of them is ever given.
 * @param environment - Where the system root is read from; `process.env` unless a test names its own. Names are compared without regard to case ({@link variableOf}).
 * @returns
 * - The full path under `SystemRoot` when it is a path on a drive named by its letter
 * - Otherwise the full path under `windir` when that is one
 * - `undefined` when neither is: the caller refuses its query then, and starts no program
 * @example
 * windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }) // => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 * windowsPowerShellPath({ windir: 'D:\\WINNT' })       // => 'D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 * windowsPowerShellPath({ SystemRoot: '\\Windows' })   // => undefined
 */
export function windowsPowerShellPath(
  environment: SystemRootEnvironment = process.env,
): string | undefined {
  const systemRoot = ['SystemRoot', 'windir']
    .map((name) => variableOf(environment, name))
    .find(
      (root): root is string =>
        root !== undefined && DRIVE_LETTER_PATH.test(root),
    )
  return systemRoot === undefined
    ? undefined
    : win32.join(systemRoot, ...POWERSHELL_UNDER_SYSTEM_ROOT)
}
