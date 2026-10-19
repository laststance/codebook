/** An environment as Node.js gives it (`process.env`), or a test's own object. */
export type ProcessEnvironment = Readonly<Record<string, string | undefined>>

/**
 * Reads one variable of an environment as the system does: on Windows without regard to the case of its name, elsewhere by its exact name; called by {@link windowsPowerShellPath} for `SystemRoot` and `windir` and by {@link gitExecutablePath} for `PATH` and `PATHEXT`.
 * Why: `process.env` of Windows already answers any case, but a plain object (a copy of the environment, a test's own) holds the name as it was written, for example `SYSTEMROOT` or `Path`.
 * @param environment - The environment.
 * @param name - The variable's name.
 * @param platform - The system whose rule applies; Windows' when left out.
 * @returns The value of the variable; `undefined` when the environment has none.
 * @example
 * environmentVariable({ SYSTEMROOT: 'C:\\Windows' }, 'SystemRoot')     // => 'C:\\Windows'
 * environmentVariable({ Path: '/usr/bin' }, 'PATH', 'linux')           // => undefined
 */
export function environmentVariable(
  environment: ProcessEnvironment,
  name: string,
  platform: NodeJS.Platform = 'win32',
): string | undefined {
  if (platform !== 'win32') return environment[name]
  const key = Object.keys(environment).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  )
  return key === undefined ? undefined : environment[key]
}
