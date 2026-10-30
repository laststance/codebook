import { readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

/** The transient files Vite writes beside the default config while it bundles it: `vite.config.ts.timestamp-<ms>-<hash>.mjs`. */
const DEFAULT_TIMESTAMP_FILE = /^vite\.config\..+\.timestamp-.+\.mjs$/

/** The folder Vite 8 bundles an ESM config into, inside the nearest `node_modules`. */
const VITE_TEMP_FOLDER = '.vite-temp'

/** Finds the nearest `node_modules` folder at or above a directory, as Vite does before it writes a bundled config. */
async function findNearestNodeModules(
  start: string,
): Promise<string | undefined> {
  for (let directory = start; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules')
    if (
      await stat(candidate).then(
        (entry) => entry.isDirectory(),
        () => false,
      )
    )
      return candidate
    if (dirname(directory) === directory) return undefined
  }
}

/** Where Vite writes its transient files and which names count: the nearest `node_modules/.vite-temp` (Vite 8) and beside the config it loads (older layouts), named after that config file. */
async function timestampTargets(
  workspace: string,
  configFile: string | undefined,
): Promise<{ directories: string[]; pattern: RegExp }> {
  const path = configFile ? resolve(workspace, configFile) : undefined
  const configDirectory = path ? dirname(path) : workspace
  const nodeModules = await findNearestNodeModules(configDirectory)
  const directories = [
    configDirectory,
    ...(nodeModules ? [join(nodeModules, VITE_TEMP_FOLDER)] : []),
  ]
  if (!path) return { directories, pattern: DEFAULT_TIMESTAMP_FILE }
  const escaped = basename(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Vite names it `<config basename>.timestamp-<Date.now()>-<random hex>.mjs`.
  return {
    directories,
    pattern: new RegExp(`^${escaped}\\.timestamp-\\d+-[0-9a-f]+\\.mjs$`),
  }
}

/**
 * Lists the transient Vite config files beside the config Vite will load and in the nearest `node_modules/.vite-temp` where Vite 8 writes them, for the snapshot taken at launch.
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
  const { directories, pattern } = await timestampTargets(workspace, configFile)
  const found = await Promise.all(
    directories.map(async (directory) =>
      (await readdir(directory).catch(() => []))
        .filter((name) => pattern.test(name))
        .map((name) => resolve(directory, name)),
    ),
  )
  return new Set(found.flat())
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
