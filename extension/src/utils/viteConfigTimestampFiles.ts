import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

/** The transient files Vite writes beside the default config while it bundles it: `vite.config.ts.timestamp-<ms>-<hash>.mjs`. */
const DEFAULT_TIMESTAMP_FILE = /^vite\.config\..+\.timestamp-.+\.mjs$/

/** Where Vite writes its transient files and which names count: beside the config it loads, named after that config file. */
function timestampTarget(
  workspace: string,
  configFile: string | undefined,
): { directory: string; pattern: RegExp } {
  if (!configFile)
    return { directory: workspace, pattern: DEFAULT_TIMESTAMP_FILE }
  const path = resolve(workspace, configFile)
  const escaped = basename(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    directory: dirname(path),
    // Vite names it `<config basename>.timestamp-<Date.now()>-<random hex>.mjs`.
    pattern: new RegExp(`^${escaped}\\.timestamp-\\d+-[0-9a-f]+\\.mjs$`),
  }
}

/**
 * Lists the transient Vite config files beside the config Vite will load, for the snapshot taken at launch.
 * @param workspace - The package root.
 * @param configFile - The dev script's `--config` value; omitted when Vite finds the default `vite.config.*`.
 * @returns The absolute paths present now.
 * @example
 * await listViteTimestampFiles('/repo') // => Set { '/repo/vite.config.ts.timestamp-1-a.mjs' }
 * await listViteTimestampFiles('/repo', 'custom.config.ts') // => Set { '/repo/custom.config.ts.timestamp-1-a.mjs' }
 */
export async function listViteTimestampFiles(
  workspace: string,
  configFile?: string,
): Promise<Set<string>> {
  const { directory, pattern } = timestampTarget(workspace, configFile)
  const names = await readdir(directory).catch(() => [])
  return new Set(
    names
      .filter((name) => pattern.test(name))
      .map((name) => resolve(directory, name)),
  )
}

/**
 * Removes transient Vite config files that were absent before the launch, after the launcher is gone: a forced kill leaves them behind, and Vite removes them itself on a clean exit.
 * Only names matching the pattern and absent from the snapshot are removed; nothing else.
 * @param workspace - The package root.
 * @param before - The snapshot from {@link listViteTimestampFiles}.
 * @param configFile - The same `--config` value the snapshot was taken with.
 * @example
 * await removeNewViteTimestampFiles('/repo', before, 'custom.config.ts')
 */
export async function removeNewViteTimestampFiles(
  workspace: string,
  before: ReadonlySet<string>,
  configFile?: string,
): Promise<void> {
  for (const path of await listViteTimestampFiles(workspace, configFile))
    if (!before.has(path)) await rm(path, { force: true })
}
