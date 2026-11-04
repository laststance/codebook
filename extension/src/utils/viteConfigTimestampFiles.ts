import { readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { isFolderOrInside } from './resolveNextPackage'

/** The transient files Vite writes beside the default config while it bundles it: `vite.config.ts.timestamp-<ms>-<hash>.mjs`. */
const DEFAULT_TIMESTAMP_FILE = /^vite\.config\..+\.timestamp-.+\.mjs$/

/** The folder Vite 8 bundles an ESM config into, inside the nearest `node_modules`. */
const VITE_TEMP_FOLDER = '.vite-temp'

/**
 * Keeps, for a nested app, only the directories whose real path lies at or inside the app folder's real path (decision D8).
 *
 * Why it exists: a hoisted ancestor `node_modules`, a symlinked `node_modules` or `.vite-temp`, or a `--config` value leading outside the app all point at folders other apps share, where Codebook cannot tell its own transient files from another app's. Real paths are compared, so a link to a shared folder counts as shared. A directory whose real path cannot be read (missing) is dropped.
 * Called by {@link timestampTargets}, which {@link listViteTimestampFiles} runs at launch and again inside {@link removeNewViteTimestampFiles} at the end, so a link created during the run is caught at removal.
 * @param directories - The candidate directories.
 * @param appRoot - The app folder.
 * @returns The candidates that belong to the app.
 * @example await keepDirectoriesInsideApp(['/repo/apps/a/node_modules/.vite-temp'], '/repo/apps/a') // => [] when that folder links to '/repo/node_modules/.vite-temp'
 */
async function keepDirectoriesInsideApp(
  directories: string[],
  appRoot: string,
): Promise<string[]> {
  const realAppRoot = await realpath(appRoot).catch(() => undefined)
  if (realAppRoot === undefined) return []
  const realDirectories = await Promise.all(
    directories.map((directory) => realpath(directory).catch(() => undefined)),
  )
  return directories.filter((_, index) => {
    const realDirectory = realDirectories[index]
    return (
      realDirectory !== undefined &&
      isFolderOrInside(realAppRoot, realDirectory)
    )
  })
}

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

/** Where Vite writes its transient files and which names count: the nearest `node_modules/.vite-temp` (Vite 8) and beside the config it loads (older layouts), named after that config file. For a nested app each folder must have its real path inside the app (decision D8, {@link keepDirectoriesInsideApp}). */
async function timestampTargets(
  workspace: string,
  configFile: string | undefined,
  nested: boolean,
): Promise<{ directories: string[]; pattern: RegExp }> {
  const path = configFile ? resolve(workspace, configFile) : undefined
  const configDirectory = path ? dirname(path) : workspace
  const nodeModules = await findNearestNodeModules(configDirectory)
  const candidates = [
    configDirectory,
    ...(nodeModules ? [join(nodeModules, VITE_TEMP_FOLDER)] : []),
  ]
  // A root run keeps every candidate; a nested app keeps only folders whose real path is inside it.
  const directories = nested
    ? await keepDirectoriesInsideApp(candidates, workspace)
    : candidates
  if (!path) return { directories, pattern: DEFAULT_TIMESTAMP_FILE }
  const escaped = basename(path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Vite names it `<config basename>.timestamp-<Date.now()>-<random hex>.mjs`.
  return {
    directories,
    pattern: new RegExp(`^${escaped}\\.timestamp-\\d+-[0-9a-f]+\\.mjs$`),
  }
}

/**
 * Lists the transient Vite config files beside the config Vite will load and in the app's own `node_modules/.vite-temp` where Vite 8 writes them, for the snapshot taken at launch. A folder whose real path lies outside the app (shared ancestor `node_modules`, a linked `.vite-temp`, a `--config` outside the app) is never listed for a nested app, so it is never cleaned.
 * @param workspace - The package root.
 * @param configFile - The dev script's `--config` value; omitted when Vite finds the default `vite.config.*`.
 * @param nested - Whether the run is a nested app; only then are folders whose real path is outside the app left out. Defaults to a root run.
 * @returns The absolute paths present now.
 * @example
 * await listViteTimestampFiles('/repo') // => Set { '/repo/vite.config.ts.timestamp-1-a.mjs' }
 * await listViteTimestampFiles('/repo', 'custom.config.ts') // => Set { '/repo/custom.config.ts.timestamp-1-a.mjs' }
 */
export async function listViteTimestampFiles(
  workspace: string,
  configFile?: string,
  nested = false,
): Promise<Set<string>> {
  const { directories, pattern } = await timestampTargets(
    workspace,
    configFile,
    nested,
  )
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
 * @param nested - The same nested flag the snapshot was taken with.
 * @example
 * await removeNewViteTimestampFiles('/repo', before, 'custom.config.ts')
 */
export async function removeNewViteTimestampFiles(
  workspace: string,
  before: ReadonlySet<string>,
  configFile?: string,
  nested = false,
): Promise<void> {
  for (const path of await listViteTimestampFiles(
    workspace,
    configFile,
    nested,
  ))
    if (!before.has(path)) await rm(path, { force: true })
}
