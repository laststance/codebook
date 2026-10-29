import type { ProcessEnvironment } from './environmentVariable'
import { windowsSystemProgramPath } from './windowsSystemProgramPath'

/** The environment the Windows system root is read from (`SystemRoot`, then `windir`, by names compared without regard to case as Windows compares them): `process.env` in the product, a test's own object in tests. */
export type SystemRootEnvironment = ProcessEnvironment

/** Where Windows PowerShell lies under the Windows system root. */
const POWERSHELL_UNDER_SYSTEM_ROOT = [
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
]

/**
 * Names the program a Windows query starts, by its full path under the Windows system root, so that no `powershell.exe` of another folder is ever started in its place; called by {@link readProcessStart}'s Windows query and by {@link listProcesses} for the Windows listing.
 * Windows PowerShell lies at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`; `windir` names the same root where `SystemRoot` is missing. Only a path on a drive named by its letter is taken: a bare name or a relative path would be looked up in the current directory and the search path, a path rooted on the current drive (`\Windows`) changes with that drive, and a network share (`\\server\share`) is no system root of this machine; another program of that name could run there with the user's rights, so none of them is ever given.
 * @param environment - Where the system root is read from; `process.env` unless a test names its own. Names are compared without regard to case ({@link environmentVariable}).
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
  return windowsSystemProgramPath(POWERSHELL_UNDER_SYSTEM_ROOT, environment)
}
