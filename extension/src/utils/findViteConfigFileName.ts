import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { VITE_DEFAULT_CONFIG_FILE_NAMES } from '../constants'

/**
 * Names the project's Vite config file for a failure report, without evaluating it.
 *
 * Why it exists: a config that fails before it resolves never reports its path, yet the refusal should name the file to open. Called by the Vite launcher (`viteLauncher.ts`) when it reports such a failure.
 *
 * @param root - The package root.
 * @param configFile - The dev script's `--config`, relative to the root; the default config names are tried when it is absent.
 * @returns The `--config` value, or the first default config file name that exists; `undefined` when the project has none.
 * @example
 * findViteConfigFileName('/repo', undefined) // => 'vite.config.ts' when /repo/vite.config.ts exists
 */
export function findViteConfigFileName(
  root: string,
  configFile: string | undefined,
): string | undefined {
  if (configFile) return configFile
  return VITE_DEFAULT_CONFIG_FILE_NAMES.find((name) =>
    existsSync(resolve(root, name)),
  )
}
