import { readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { isFolderOrInside } from './resolveNextPackage'

/** The transient files Vite writes beside the default config while it bundles it: `vite.config.ts.timestamp-<ms>-<hash>.mjs`. */
const DEFAULT_TIMESTAMP_FILE = /^vite\.config\..+\.timestamp-.+\.mjs$/

/** The folder Vite 8 bundles an ESM config into, inside the nearest `node_modules`. */
const VITE_TEMP_FOLDER = '.vite-temp'

/**
 * Finds the nearest `node_modules` folder at or above a directory, as Vite does before it writes a bundled config, and for a nested app keeps it only when it belongs to the app (decision D8).
 *
 * Why it exists: in a hoisted layout the nearest `node_modules` can be an ancestor's, shared with other apps, where Codebook cannot tell its own transient files from another app's; such a folder is never cleaned for a nested app. A root run keeps the nearest folder whatever its place, as before Cycle 0077.
 * The check compares real paths, so an app `node_modules` that is a symlink to a shared folder outside the app counts as shared.
 * @param start - The directory the config lies in.
 * @param appRoot - The app folder; for a nested app the `node_modules` must lie at or inside it.
 * @param nested - Whether the run is a nested app (not the repository root app).
 * @returns The nearest `node_modules` for a root run; for a nested app its own `node_modules`, or `undefined` when there is none or the nearest one is shared.
 * @example await findOwnNodeModules('/repo/examples/basic', '/repo/examples/basic', true) // => '/repo/examples/basic/node_modules'
 */
async function findOwnNodeModules(
  start: string,
  appRoot: string,
  nested: boolean,
): Promise<string | undefined> {
  const nearest = await findNearestNodeModules(start)
  if (nearest === undefined || !nested) return nearest
  // Real paths on both sides: a symlinked node_modules pointing outside the app is shared.
  const [realAppRoot, realNodeModules] = await Promise.all([
    realpath(appRoot).catch(() => undefined),
    realpath(nearest).catch(() => undefined),
  ])
  return realAppRoot !== undefined &&
    realNodeModules !== undefined &&
    isFolderOrInside(realAppRoot, realNodeModules)
    ? nearest
    : undefined
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

/** Where Vite writes its transient files and which names count: the nearest `node_modules/.vite-temp` (Vite 8; for a nested app only its own, never a shared ancestor's, decision D8) and beside the config it loads (older layouts), named after that config file. */
async function timestampTargets(
  workspace: string,
  configFile: string | undefined,
  nested: boolean,
): Promise<{ directories: string[]; pattern: RegExp }> {
  const path = configFile ? resolve(workspace, configFile) : undefined
  const configDirectory = path ? dirname(path) : workspace
  const nodeModules = await findOwnNodeModules(
    configDirectory,
    workspace,
    nested,
  )
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
 * Lists the transient Vite config files beside the config Vite will load and in the app's own `node_modules/.vite-temp` where Vite 8 writes them, for the snapshot taken at launch. A `.vite-temp` in a shared ancestor `node_modules` is never listed, so it is never cleaned.
 * @param workspace - The package root.
 * @param configFile - The dev script's `--config` value; omitted when Vite finds the default `vite.config.*`.
 * @param nested - Whether the run is a nested app; only then is a shared ancestor `node_modules` left out. Defaults to a root run.
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
