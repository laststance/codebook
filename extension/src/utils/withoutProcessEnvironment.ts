/**
 * Runs a synchronous read with `process.env` emptied, then restores it.
 *
 * Why it exists: Vite's `loadEnv(mode, dir, '')` also returns every `process.env` entry, so the values of the env files cannot be told from `HOME` or `PATH`. With an empty environment it returns what the env files hold, parsed the way Vite parses them. Called by the Vite launcher (`viteLauncher.ts`) to learn the values to mask.
 * The read must be synchronous: nothing else runs while the environment is empty.
 *
 * @param read - A synchronous read of the env files.
 * @returns What `read` returned.
 * @throws What `read` threw, after the environment is restored.
 * @example
 * withoutProcessEnvironment(() => Object.keys(process.env)) // => []
 */
export function withoutProcessEnvironment<Result>(read: () => Result): Result {
  const saved = { ...process.env }
  for (const name of Object.keys(process.env)) delete process.env[name]
  try {
    return read()
  } finally {
    Object.assign(process.env, saved)
  }
}
