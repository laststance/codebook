import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { z } from 'zod'

import { StudyError } from '../errors'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'

import { isInsideFolder } from './isInsideFolder'
import { repositoryPosixPath } from './repositoryPosixPath'

/** How node runs the server's entry: directly, or through the repository's own tsx loader, named by its real path and the file URL `--import` receives. */
export type NodeServerLoader =
  { kind: 'node' } | { kind: 'tsx'; path: string; url: string }

/** The real paths a node-server launch runs: the folder it starts in, its entry and its loader. */
export type ResolvedNodeServerLaunch = {
  packageRoot: string
  entry: string
  loader: NodeServerLoader
}

/** The one field of a package manifest the loader lookup reads. */
const packageManifestSchema = z.looseObject({ exports: z.unknown() })

/** The export conditions node's ESM loader matches when `--import` loads a package's `.` export. */
const IMPORT_CONDITIONS = new Set(['node', 'import', 'default'])

/**
 * Builds the refusal of a node-server launch input, raised before anything is spawned.
 * @param message - What is wrong, naming the field as the declaration wrote it.
 * @returns The `NODE_SERVER_SOURCE_REFUSED` {@link StudyError}.
 * @example refusal("node-server's entry src/server.ts is not a file inside packageRoot apps/api by its real path.")
 */
function refusal(message: string): StudyError {
  return new StudyError('NODE_SERVER_SOURCE_REFUSED', message)
}

/**
 * Answers a path's real path, or `undefined` when it does not exist or cannot be read.
 * @param path - Any path.
 * @returns The real path, or `undefined`.
 * @example await realPathOrNothing('/repo/missing') // => undefined
 */
async function realPathOrNothing(path: string): Promise<string | undefined> {
  return realpath(path).catch(() => undefined)
}

/**
 * Says whether a real path is the folder itself or lies below it.
 * @param folder - The folder's real path.
 * @param realPath - The real path to place.
 * @returns `true` for the folder or a path inside it.
 * @example isFolderOrInside('/repo', '/repo') // => true
 */
function isFolderOrInside(folder: string, realPath: string): boolean {
  return realPath === folder || isInsideFolder(folder, realPath)
}

/**
 * Picks the target node's ESM loader would load for `--import <package>` from a package's `exports` field: the `.` export, through the first condition of {@link IMPORT_CONDITIONS} in the field's own order.
 * @param exportsField - The package's `exports` value.
 * @returns The package-relative target (`./dist/loader.mjs`), or `undefined` when the package exports nothing for import as `.`.
 * @example
 * importTarget('./dist/loader.mjs')                                              // => './dist/loader.mjs'
 * importTarget({ '.': { require: './dist/a.cjs', import: './dist/a.mjs' } })     // => './dist/a.mjs'
 */
function importTarget(exportsField: unknown): string | undefined {
  if (typeof exportsField === 'string') return exportsField
  // A fallback list: the first entry that resolves is node's choice.
  if (Array.isArray(exportsField))
    return firstImportTarget(exportsField.values())
  if (!exportsField || typeof exportsField !== 'object') return undefined
  const entries = Object.entries(exportsField)
  // Subpath keys start with "."; without them the object is the `.` export's conditions.
  const dotExport = entries.find(([key]) => key === '.')
  if (dotExport) return importTarget(dotExport[1])
  if (entries.some(([key]) => key.startsWith('.'))) return undefined
  return firstImportTarget(
    entries
      .filter(([condition]) => IMPORT_CONDITIONS.has(condition))
      .map(([, target]) => target),
  )
}

/**
 * Answers the first of several export candidates that resolves for import, in their given order, as node tries a fallback list or the matching conditions of an object.
 * @param candidates - The candidates, in order.
 * @returns The first {@link importTarget} that is not `undefined`, or `undefined`.
 * @example firstImportTarget([{ require: './a.cjs' }, './a.mjs']) // => './a.mjs'
 */
function firstImportTarget(candidates: Iterable<unknown>): string | undefined {
  for (const candidate of candidates) {
    const target = importTarget(candidate)
    if (target !== undefined) return target
  }
  return undefined
}

/**
 * Finds the `node_modules/tsx` node would resolve from the package root, folder by folder up to the repository's root and no further.
 * @param workspace - The opened repository's real root.
 * @param packageRoot - The package root's real path, inside the workspace.
 * @returns The `node_modules/tsx` folder as reached from its folder (a pnpm link is not yet followed), or `undefined` when none is installed in the repository.
 * @example await findInstalledTsx('/repo', '/repo/apps/api') // => '/repo/node_modules/tsx'
 */
async function findInstalledTsx(
  workspace: string,
  packageRoot: string,
): Promise<string | undefined> {
  // Walk from the package root up to the repository root, as node's own lookup would before it leaves the repository.
  for (let folder = packageRoot; ; folder = dirname(folder)) {
    const candidate = join(folder, 'node_modules', 'tsx')
    if (await realPathOrNothing(join(candidate, 'package.json')))
      return candidate
    if (folder === workspace || !isInsideFolder(workspace, folder))
      return undefined
  }
}

/**
 * Resolves the repository's own tsx loader for a TypeScript entry: the file its `.` export gives `--import`, by its real path inside the repository.
 * @param workspace - The opened repository's real root.
 * @param packageRoot - The package root's real path.
 * @param declaredPackageRoot - `packageRoot` as the declaration wrote it, for the refusal's words.
 * @returns The loader's real path and its file URL.
 * @throws `NODE_SERVER_SOURCE_REFUSED` when no tsx is installed in the repository, when it lies outside the repository by its real path (pnpm's `enableGlobalVirtualStore` links it so), or when it exports no loader file inside the repository.
 * @example await resolveTsxLoader('/repo', '/repo/apps/api', 'apps/api') // => { kind: 'tsx', path: '/repo/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs', url: 'file:///repo/…/loader.mjs' }
 */
async function resolveTsxLoader(
  workspace: string,
  packageRoot: string,
  declaredPackageRoot: string,
): Promise<NodeServerLoader> {
  const installed = await findInstalledTsx(workspace, packageRoot)
  if (!installed)
    throw refusal(
      `node-server's TypeScript entry runs through the repository's own tsx, and none is installed for ${declaredPackageRoot} (${declaredPackageRoot === '.' ? 'searched node_modules/tsx at the repository root' : `searched node_modules/tsx from ${declaredPackageRoot} up to the repository root`}); install the repository's dependencies.`,
    )
  const installedName = repositoryPosixPath(workspace, installed)
  const packageFolder = await realPathOrNothing(installed)
  if (!packageFolder || !isInsideFolder(workspace, packageFolder))
    throw refusal(
      `node-server's tsx for ${declaredPackageRoot} (${installedName}) lies outside the opened repository by its real path, as with pnpm's enableGlobalVirtualStore; Codebook loads only a tsx inside the repository.`,
    )
  let manifest: unknown
  try {
    manifest = JSON.parse(
      await readFile(join(packageFolder, 'package.json'), 'utf8'),
    )
  } catch {
    // An unreadable manifest exports nothing; the refusal below names it.
    manifest = undefined
  }
  const parsedManifest = packageManifestSchema.safeParse(manifest)
  const target = parsedManifest.success
    ? importTarget(parsedManifest.data.exports)
    : undefined
  const loader = target
    ? await realPathOrNothing(resolve(packageFolder, target))
    : undefined
  // The loader file itself must also stay inside the repository and be a file.
  if (
    !loader ||
    !isInsideFolder(workspace, loader) ||
    !(await stat(loader)).isFile()
  )
    throw refusal(
      `node-server's tsx for ${declaredPackageRoot} (${installedName}) exports no loader file inside the repository as "." for import; install the repository's dependencies again.`,
    )
  return { kind: 'tsx', path: loader, url: pathToFileURL(loader).href }
}

/**
 * Checks a node-server declaration's launch inputs on disk before anything is spawned: the package root is a folder inside the opened repository, the entry a file inside the package root, and a TypeScript entry's loader the repository's own tsx, each by its real path.
 * Called by the node-server run's preparation after the declaration parsed ({@link nodeServerConfigSchema}) and before the launch ({@link launchNodeServer}), which runs exactly these real paths.
 * @param workspace - The opened repository's real root.
 * @param configuration - The declaration's packageRoot, entry and (defaulted) loader.
 * @returns The real package root, the real entry and the loader ({@link ResolvedNodeServerLaunch}).
 * @throws `NODE_SERVER_SOURCE_REFUSED` naming the field whose real path is missing or leaves the repository, or the tsx that is missing, outside the repository or without a loader.
 * @example
 * await resolveNodeServerLaunch('/repo', { packageRoot: 'apps/api', entry: 'src/server.ts', loader: 'tsx' })
 * // => { packageRoot: '/repo/apps/api', entry: '/repo/apps/api/src/server.ts', loader: { kind: 'tsx', path: '/repo/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs', url: 'file:///repo/…' } }
 */
export async function resolveNodeServerLaunch(
  workspace: string,
  configuration: Pick<
    NodeServerConfiguration,
    'packageRoot' | 'entry' | 'loader'
  >,
): Promise<ResolvedNodeServerLaunch> {
  const packageRoot = await realPathOrNothing(
    join(workspace, configuration.packageRoot),
  )
  if (
    !packageRoot ||
    !isFolderOrInside(workspace, packageRoot) ||
    !(await stat(packageRoot)).isDirectory()
  )
    throw refusal(
      `node-server's packageRoot ${configuration.packageRoot} is not a folder inside the opened repository by its real path.`,
    )
  const entry = await realPathOrNothing(join(packageRoot, configuration.entry))
  if (
    !entry ||
    !isInsideFolder(packageRoot, entry) ||
    !(await stat(entry)).isFile()
  )
    throw refusal(
      `node-server's entry ${configuration.entry} is not a file inside packageRoot ${configuration.packageRoot} by its real path.`,
    )
  const loader =
    configuration.loader === 'tsx'
      ? await resolveTsxLoader(
          workspace,
          packageRoot,
          configuration.packageRoot,
        )
      : ({ kind: 'node' } as const)
  return { packageRoot, entry, loader }
}
