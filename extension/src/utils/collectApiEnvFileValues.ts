import { VITE_MASKED_VALUE_MIN_CHARS } from '../constants'

import { loadExpoEnvFiles } from './loadExpoEnvFiles'
import { REACT_SCRIPTS_ENV_FILE_POLICY } from './readReactScriptsEnvFile'

/**
 * Reads the values of the `.env` files an `apiServer` run's API may load, so the run can hide them in the API's output.
 *
 * Why it exists: the API prints what its own code reads from `<api package>/.env` (and the repository root's files), and those values are in neither the learner's secrets nor the app launcher's mask. Called by {@link ConfiguredBrowserRun} before the API launches, with the same file set and loader the Expo app launch masks with ({@link loadExpoEnvFiles}).
 * An unreadable, oversized or over-expanding folder is skipped: the API's own reading of it is not Codebook's to refuse here.
 * @param roots - Folders to read the files of (the API package root and the repository root); duplicates read once.
 * @returns The distinct values at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters long, so a short word is not blanked everywhere.
 * @example await collectApiEnvFileValues(['/repo/server', '/repo']) // => ['s3cr3t-db-pass'] for server/.env: DB_PASSWORD=s3cr3t-db-pass
 */
export async function collectApiEnvFileValues(
  roots: readonly string[],
): Promise<string[]> {
  const values = new Set<string>()
  for (const root of new Set(roots)) {
    const environment = new Map<string, string>()
    try {
      await loadExpoEnvFiles(root, environment, REACT_SCRIPTS_ENV_FILE_POLICY)
    } catch {
      // A folder whose files Codebook cannot settle contributes no value.
      continue
    }
    for (const value of environment.values())
      if (value.length >= VITE_MASKED_VALUE_MIN_CHARS) values.add(value)
  }
  return [...values]
}
