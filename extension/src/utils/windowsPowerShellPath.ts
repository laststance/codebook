import { win32 } from 'node:path'

/** The environment the Windows system root is read from (`SystemRoot`): `process.env` in the product, a test's own object in tests. */
export type SystemRootEnvironment = { SystemRoot?: string }

/** Where Windows PowerShell lies under the Windows system root, and its bare name, by which it is started only where that root is unknown. */
const WINDOWS_POWERSHELL = {
  underSystemRoot: ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
  bareName: 'powershell.exe',
}

/**
 * Names the program a Windows query starts, by its full path, so that no `powershell.exe` in the process's current directory or earlier in the search path is started in its place; called by {@link readProcessStart}'s Windows query and by {@link listProcesses} for the Windows listing.
 * Windows PowerShell lies at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. A bare name is looked up in the current directory first and then in the search path.
 * @param environment - Where the system root is read from; `process.env`, whose names Windows reads without regard to case, unless a test names its own.
 * @returns The full path under `SystemRoot`; the bare name `powershell.exe` where that variable is absent, empty or no absolute Windows path, since a path that is not absolute would again be looked up from the current directory.
 * @example
 * windowsPowerShellPath({ SystemRoot: 'C:\\Windows' }) // => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
 * windowsPowerShellPath({})                            // => 'powershell.exe'
 */
export function windowsPowerShellPath(
  environment: SystemRootEnvironment = process.env,
): string {
  const systemRoot = environment.SystemRoot
  return systemRoot !== undefined && win32.isAbsolute(systemRoot)
    ? win32.join(systemRoot, ...WINDOWS_POWERSHELL.underSystemRoot)
    : WINDOWS_POWERSHELL.bareName
}
