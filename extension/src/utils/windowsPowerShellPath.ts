import { win32 } from 'node:path'

/** The environment the Windows system root is read from (`SystemRoot`, then `windir`): `process.env` in the product, a test's own object in tests. */
export type SystemRootEnvironment = { SystemRoot?: string; windir?: string }

/** Where Windows PowerShell lies under the Windows system root. */
const POWERSHELL_UNDER_SYSTEM_ROOT = [
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
]

/**
 * Names the program a Windows query starts, by its full path under the Windows system root, so that no `powershell.exe` of another folder is ever started in its place; called by {@link readProcessStart}'s Windows query and by {@link listProcesses} for the Windows listing.
 * Windows PowerShell lies at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; `windir` names the same root where `SystemRoot` is missing. A bare name or a relative path would be looked up in the current directory and the search path, where another program of that name could run with the user's rights, so none is ever given.
 * @param environment - Where the system root is read from; `process.env`, whose names Windows reads without regard to case, unless a test names its own.
 * @returns
 * - The full path under `SystemRoot` when it is an absolute Windows path
 * - Otherwise the full path under `windir` when that is one
 * - `undefined` when neither is: the caller refuses its query then, and starts no program
 * @example
 * windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }) // => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 * windowsPowerShellPath({ windir: 'D:\\WINNT' })       // => 'D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 * windowsPowerShellPath({})                            // => undefined
 */
export function windowsPowerShellPath(
  environment: SystemRootEnvironment = process.env,
): string | undefined {
  const systemRoot = [environment.SystemRoot, environment.windir].find(
    (root): root is string => root !== undefined && win32.isAbsolute(root),
  )
  return systemRoot === undefined
    ? undefined
    : win32.join(systemRoot, ...POWERSHELL_UNDER_SYSTEM_ROOT)
}
