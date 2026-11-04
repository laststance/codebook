import { access, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

import { VITE_VERSION_MAX_CHARS } from '../constants'
import { viteRefusal } from '../viteRefusals'

import {
  findViteInsideRepository,
  type ViteNotFoundReason,
} from './findViteInsideRepository'
import { isSemverLikeVersion } from './isSemverLikeVersion'
import { repositoryPosixPath } from './repositoryPosixPath'
import { isFolderOrInside, readJsonInside } from './resolveNextPackage'

const vitePackageSchema = z.object({
  name: z.string().optional(),
  version: z.string(),
  engines: z.object({ node: z.string().optional() }).optional(),
  exports: z.unknown().optional(),
  module: z.string().optional(),
  main: z.string().optional(),
})

/** What the app's own `vite` package says about itself. */
export type ViteInstallation = {
  /** The package folder. */
  directory: string
  version: string
  major: number
  /** The `engines.node` range, when the package has one. */
  enginesNode: string | undefined
  /** The absolute path of the ESM entry the launcher imports. */
  entry: string
}

/** What looking for Vite found: it, or why there is none. */
export type ViteInstallationLookup =
  | { found: true; installation: ViteInstallation }
  | { found: false; reason: ViteNotFoundReason }

/** Picks the import entry of a package `exports["."]` value: `import`, `node` or `default`, depth-first. */
function importEntryOf(exported: unknown): string | undefined {
  if (typeof exported === 'string') return exported
  if (typeof exported !== 'object' || exported === null) return undefined
  const conditions = new Map(Object.entries(exported))
  for (const condition of ['import', 'node', 'default']) {
    const entry = importEntryOf(conditions.get(condition))
    if (entry) return entry
  }
  return undefined
}

/**
 * Reads the Vite manifest; a nested app's is read through the repository's containment check and must name `vite` (decision D7).
 *
 * Called by {@link resolveViteInstallation}.
 *
 * @param packagePath - The real `vite/package.json` path.
 * @param nestedRoot - The repository's real root for a nested app; `undefined` keeps the root run's unchecked read.
 * @returns The manifest, or `undefined` for a nested manifest that is unreadable, outside the repository, invalid or names another package.
 * @throws For the root run, a read or parse failure, as it always did.
 * @example
 * await readViteManifest('/repo/node_modules/vite/package.json', '/repo') // => { name: 'vite', version: '8.3.5', … }
 */
async function readViteManifest(
  packagePath: string,
  nestedRoot: string | undefined,
): Promise<z.infer<typeof vitePackageSchema> | undefined> {
  if (nestedRoot === undefined)
    return vitePackageSchema.parse(
      JSON.parse(await readFile(packagePath, 'utf8')),
    )
  const manifest = await readJsonInside(
    nestedRoot,
    repositoryPosixPath(nestedRoot, packagePath),
    vitePackageSchema,
  )
  return manifest?.name === 'vite' ? manifest : undefined
}

/**
 * Judges a nested app's import entry by real path: it must exist and stay inside the repository.
 *
 * Called by {@link resolveViteInstallation} after the entry is named.
 *
 * @param entry - The absolute import entry.
 * @param nestedRoot - The repository's real root; `undefined` for the root run, which is not judged.
 * @returns `undefined` when acceptable, else the refusal reason.
 * @example
 * await nestedEntryRefusal('/repo/node_modules/vite/index.mjs', '/repo') // => undefined
 */
async function nestedEntryRefusal(
  entry: string,
  nestedRoot: string | undefined,
): Promise<'outside-repository' | 'not-vite' | undefined> {
  if (nestedRoot === undefined) return undefined
  const realEntry = await realpath(entry).catch(() => undefined)
  if (realEntry === undefined) return 'not-vite'
  return isFolderOrInside(nestedRoot, realEntry)
    ? undefined
    : 'outside-repository'
}

/**
 * Finds the `vite/package.json` of the app: the bounded walk for a nested app (decision D7), Node's own resolution for the root app.
 *
 * Called by {@link resolveViteInstallation}.
 *
 * @param workspace - The package root.
 * @param repositoryRoot - Set for a nested app; absent or equal to `workspace` keeps Node's resolution.
 * @returns The package path (with the repository's real root for a nested app), or the reason there is none.
 * @example
 * await locateVitePackage('/repo/examples/basic', '/repo') // => { packagePath: '/repo/node_modules/vite/package.json', nestedRoot: '/repo' }
 */
async function locateVitePackage(
  workspace: string,
  repositoryRoot: string | undefined,
): Promise<
  | { packagePath: string; nestedRoot: string | undefined }
  | { reason: ViteNotFoundReason }
> {
  // A nested app finds Vite only inside the repository; the root app keeps Node's own resolution.
  if (
    repositoryRoot !== undefined &&
    resolve(repositoryRoot) !== resolve(workspace)
  ) {
    const bounded = await findViteInsideRepository(workspace, repositoryRoot)
    if (!bounded.found) return { reason: bounded.reason }
    return {
      packagePath: bounded.packagePath,
      nestedRoot: await realpath(repositoryRoot).catch(() => repositoryRoot),
    }
  }
  const requireFromRoot = createRequire(
    join(resolve(workspace), 'package.json'),
  )
  try {
    return {
      packagePath: requireFromRoot.resolve('vite/package.json'),
      nestedRoot: undefined,
    }
  } catch {
    const isPnp = await access(join(workspace, '.pnp.cjs')).then(
      () => true,
      () => false,
    )
    return { reason: isPnp ? 'yarn-pnp' : 'not-installed' }
  }
}

/**
 * Finds the app's own `vite` package from the package root with Node's resolution, for {@link assessViteWorkspace} and {@link readCodebookStatus}'s Vite prerequisite.
 *
 * Why it exists: Codebook runs the project's Vite, never one of its own, so pnpm and npm workspaces work as the project does. A Yarn Plug-n-Play project with no `node_modules` has nothing to resolve and is told apart.
 *
 * @param workspace - The package root.
 * @param repositoryRoot - Set for a nested app: Vite is then the nearest `node_modules/vite` from the package root up to this root with its real path inside it ({@link findViteInsideRepository}); absent or equal to `workspace` keeps Node's resolution.
 * @returns The installation, or the reason there is none: `yarn-pnp`, `not-installed`, `outside-repository` (a nested app's nearest Vite, its manifest or its import entry resolves outside the repository, or its link is broken) or `not-vite` (a nested app's nearest `node_modules/vite` manifest is unreadable or names another package).
 * @throws `VITE_UNSUPPORTED` when the `vite/package.json` version is not semver-like or is longer than {@link VITE_VERSION_MAX_CHARS} (the study records it, so it must fit the study schema); an error when it lacks a version or names no importable entry (the message names it); a manifest Node's resolution cannot parse fails that resolution first and reads as `not-installed`.
 * @example
 * await resolveViteInstallation('/repo') // => { found: true, installation: { version: '8.3.5', major: 8, … } }
 */
export async function resolveViteInstallation(
  workspace: string,
  repositoryRoot?: string,
): Promise<ViteInstallationLookup> {
  const located = await locateVitePackage(workspace, repositoryRoot)
  if ('reason' in located) return { found: false, reason: located.reason }
  const { packagePath, nestedRoot } = located
  const manifest = await readViteManifest(packagePath, nestedRoot)
  if (manifest === undefined) return { found: false, reason: 'not-vite' }
  if (!isSemverLikeVersion(manifest.version, VITE_VERSION_MAX_CHARS))
    throw viteRefusal(
      'VITE_UNSUPPORTED',
      `The installed vite/package.json version is not a semantic version of at most ${VITE_VERSION_MAX_CHARS} characters; reinstall the workspace dependencies so vite reports a real version.`,
    )
  const directory = dirname(packagePath)
  const exported =
    typeof manifest.exports === 'object' && manifest.exports !== null
      ? new Map(Object.entries(manifest.exports)).get('.')
      : manifest.exports
  const relativeEntry =
    importEntryOf(exported) ?? manifest.module ?? manifest.main
  if (!relativeEntry)
    throw new Error('vite/package.json names no importable entry')
  const entry = resolve(directory, relativeEntry)
  const entryReason = await nestedEntryRefusal(entry, nestedRoot)
  if (entryReason !== undefined) return { found: false, reason: entryReason }
  return {
    found: true,
    installation: {
      directory,
      version: manifest.version,
      major: Number.parseInt(manifest.version, 10),
      enginesNode: manifest.engines?.node,
      entry,
    },
  }
}
