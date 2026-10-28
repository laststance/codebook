/**
 * Copies the process environment without any inherited `GIT_*` variable, so Git runs against the opened folder and not where `GIT_DIR`, `GIT_CONFIG_*` and the like point.
 * Called by the repository's Git readers (the command runner of `readRepositoryRevision` and `RepositorySourceService`) before they add their own Git variables.
 * @returns A new environment object; the caller may add keys to it.
 * @example
 * const env = { ...gitEnvironmentWithoutInherited(), GIT_OPTIONAL_LOCKS: '0' }
 */
export function gitEnvironmentWithoutInherited(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    // Case-insensitive: Windows environment names are, so `git_dir` reaches Git as `GIT_DIR`.
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith('GIT_'),
    ),
  )
}
