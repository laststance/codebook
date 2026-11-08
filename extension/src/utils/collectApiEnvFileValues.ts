import { EXPO_WEB_ENV_FILES, VITE_MASKED_VALUE_MIN_CHARS } from '../constants'

import { loadExpoEnvFiles } from './loadExpoEnvFiles'
import { parseExpoEnvText } from './parseExpoEnvText'
import {
  REACT_SCRIPTS_ENV_FILE_POLICY,
  readReactScriptsEnvFile,
} from './readReactScriptsEnvFile'

/**
 * Reads the values of the `.env` files an `apiServer` run's API may load, so the run can hide them in the API's output.
 *
 * Why it exists: the API prints what its own code reads from `<api package>/.env` (and the repository root's files), and those values are in neither the learner's secrets nor the app launcher's mask. Called by {@link ConfiguredBrowserRun} before the API launches, with the same file set and loader the Expo app launch masks with ({@link loadExpoEnvFiles}).
 * Each file is read on its own (raw, unexpanded values included) and the folder's expanded values are added when they settle, so one oversized, irregular or over-expanding file skips only itself, never the readable files beside it. The API's own reading of a skipped file is not Codebook's to refuse here.
 * @param roots - Folders to read the files of (the API package root and the repository root); duplicates read once.
 * @returns The distinct values at least {@link VITE_MASKED_VALUE_MIN_CHARS} characters long, so a short word is not blanked everywhere.
 * @example await collectApiEnvFileValues(['/repo/server', '/repo']) // => ['s3cr3t-db-pass'] for server/.env: DB_PASSWORD=s3cr3t-db-pass
 */
export async function collectApiEnvFileValues(
  roots: readonly string[],
): Promise<string[]> {
  const values = new Set<string>()
  for (const root of new Set(roots)) {
    // Raw values per file: one failing file skips only itself.
    for (const name of EXPO_WEB_ENV_FILES) {
      try {
        const text = await readReactScriptsEnvFile(
          root,
          name,
          REACT_SCRIPTS_ENV_FILE_POLICY,
        )
        if (text !== undefined)
          addLongValues(values, parseExpoEnvText(text).values())
      } catch {
        // A file Codebook cannot settle contributes no value.
      }
    }
    // Expanded values of the whole folder; an over-expanding folder adds nothing beyond its raw values.
    const environment = new Map<string, string>()
    try {
      await loadExpoEnvFiles(root, environment, REACT_SCRIPTS_ENV_FILE_POLICY)
    } catch {
      continue
    }
    addLongValues(values, environment.values())
  }
  return [...values]
}

/**
 * Adds the values long enough to mask to the set.
 *
 * Called by {@link collectApiEnvFileValues} for raw and expanded values alike.
 * @param target - The set collecting values.
 * @param found - Candidate values.
 * @example addLongValues(new Set(), ['s3cr3t-db-pass'].values())
 */
function addLongValues(target: Set<string>, found: Iterable<string>): void {
  for (const value of found)
    if (value.length >= VITE_MASKED_VALUE_MIN_CHARS) target.add(value)
}
