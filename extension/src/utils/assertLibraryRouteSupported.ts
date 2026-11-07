import { readFile, realpath, stat } from 'node:fs/promises'
import { delimiter, dirname, join, relative, sep } from 'node:path'

import { MIN_NODE_MAJOR_VERSION } from '../constants'
import type { StudyError } from '../errors'
import { LIBRARY_REACHED_THROUGH_LIMIT } from '../libraryRunFactsSchema'

import { createLibraryBuildError } from './createLibraryBuildError'
import { isAtOrInsideFolder } from './isAtOrInsideFolder'
import { isNpmPackageName } from './isNpmPackageName'
import { readInstalledPackageManifest } from './readInstalledPackageManifest'
import {
  resolveRepositoryPackageManager,
  type RepositoryPackageManagerResult,
} from './resolveRepositoryPackageManager'

/** The field path the library refusals name when the declared folder is at fault. */
const LIBRARY_PACKAGE_ROOT_FIELD = 'configuration.library.packageRoot'

/**
 * How the Example must relate to the declared library (API 1.35, D4).
 * - `direct`: the Example's package.json lists the library in `dependencies`, `devDependencies` or `peerDependencies` (the `node-script` and `vite-dev` routes).
 * - `direct-or-installed`: the same, or one of the Example's listed dependencies, as installed for the Example, itself lists the library in its `dependencies`, `optionalDependencies` or `peerDependencies` (one level, no version-range comparison; the `react-scripts-dev` route).
 */
export type LibraryDependencyRelation = 'direct' | 'direct-or-installed'

/** What {@link assertLibraryRouteSupported} checks. */
export type LibraryRouteInputs = {
  /** The Git repository root (a real path). */
  repositoryRoot: string
  /** The Example's `packageRoot` (a real path inside the repository). */
  examplePackageRoot: string
  /** The declared `library.packageRoot`, relative to the repository root. */
  declaredPackageRoot: string
  /** The external Node, or none when it could not be resolved. */
  node: { executable: string; version: string } | undefined
  /** The `PATH` the build runs with. */
  pathText: string
  platform?: NodeJS.Platform
  isProgramFile?: (path: string) => Promise<boolean>
  /** How the Example must depend on the library; `direct` when absent. */
  dependencyRelation?: LibraryDependencyRelation
}

/** What the checks learned about a supported library. */
export type SupportedLibrary = {
  /** The library folder's real path. */
  libraryRoot: string
  /** The folder as the facts and messages name it: relative to the repository root with forward slashes, `.` for the root. */
  relativeRoot: string
  name: string
  version: string | undefined
  /** The names in the library's `peerDependencies` that are not optional. */
  peers: string[]
  packageManager: Extract<RepositoryPackageManagerResult, { ok: true }>
  /** Only when the Example does not list the library itself and `direct-or-installed` found it through installed dependencies: their names, sorted, at most {@link LIBRARY_REACHED_THROUGH_LIMIT}. */
  reachedThrough?: string[]
  /** The number of all such dependencies (at least the length of `reachedThrough`); present with it. */
  reachedThroughCount?: number
}

/** The parts of a `package.json` the checks read. */
type Manifest = {
  name: string | undefined
  version: string | undefined
  scripts: Record<string, unknown>
  dependencies: string[]
  devDependencies: string[]
  peerDependencies: string[]
  optionalPeers: string[]
}

function namesOf(value: unknown): string[] {
  return typeof value === 'object' && value !== null ? Object.keys(value) : []
}

/** Reads a `package.json`; `undefined` when absent, unreadable or not a JSON object. */
async function readManifest(folder: string): Promise<Manifest | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(folder, 'package.json'), 'utf8'),
    )
    if (typeof value !== 'object' || value === null) return undefined
    const name: unknown = Reflect.get(value, 'name')
    const version: unknown = Reflect.get(value, 'version')
    const scripts: unknown = Reflect.get(value, 'scripts')
    const peerMeta: unknown = Reflect.get(value, 'peerDependenciesMeta')
    return {
      name: typeof name === 'string' && name !== '' ? name : undefined,
      version: typeof version === 'string' ? version : undefined,
      scripts:
        typeof scripts === 'object' && scripts !== null
          ? Object.fromEntries(Object.entries(scripts))
          : {},
      dependencies: namesOf(Reflect.get(value, 'dependencies')),
      devDependencies: namesOf(Reflect.get(value, 'devDependencies')),
      peerDependencies: namesOf(Reflect.get(value, 'peerDependencies')),
      optionalPeers: Object.entries(
        typeof peerMeta === 'object' && peerMeta !== null ? peerMeta : {},
      )
        .filter(
          ([, meta]) =>
            typeof meta === 'object' &&
            meta !== null &&
            Reflect.get(meta, 'optional') === true,
        )
        .map(([peer]) => peer),
    }
  } catch {
    return undefined
  }
}

/** How many installed manifests are read at once while looking for a transitive relation. */
const INSTALLED_READ_BATCH = 16

/**
 * Reads the dependency names an installed package declares for the library relation: `dependencies`, `optionalDependencies` and `peerDependencies` (optional peers included).
 * @param manifestPath - The installed `package.json` path.
 * @returns The names, or an empty list when the file is unreadable.
 */
async function declaredDependencyNames(
  manifestPath: string,
): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (typeof value !== 'object' || value === null) return []
    return ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap(
      (field) => namesOf(Reflect.get(value, field)),
    )
  } catch {
    return []
  }
}

/**
 * Finds which of the Example's listed dependencies declare the library in their installed manifest (one level, no version comparison).
 * Called by {@link readSupportedManifest} when the Example does not list the library and the relation is `direct-or-installed`.
 * @param examplePackageRoot - The Example's package folder (a real path); each name is resolved from there as module resolution does.
 * @param listed - The names the Example's package.json lists.
 * @param libraryName - The library's package name.
 * @returns The qualifying names, sorted in code-unit order.
 * @example await installedDependentsOf('/repo/examples/app', ['@reduxjs/toolkit'], 'redux') // => ['@reduxjs/toolkit']
 */
async function installedDependentsOf(
  examplePackageRoot: string,
  listed: readonly string[],
  libraryName: string,
): Promise<string[]> {
  const found: string[] = []
  // Batches keep the number of open files small for an Example with hundreds of dependencies.
  for (let start = 0; start < listed.length; start += INSTALLED_READ_BATCH) {
    const batch = listed.slice(start, start + INSTALLED_READ_BATCH)
    const results = await Promise.all(
      batch.map(async (name) => {
        const installed = await readInstalledPackageManifest(
          examplePackageRoot,
          name,
        )
        if (installed === undefined) return undefined
        // The real path follows a pnpm link to the package's own folder.
        const manifestPath = await realpath(installed.manifestPath).catch(
          () => installed.manifestPath,
        )
        return (await declaredDependencyNames(manifestPath)).includes(
          libraryName,
        )
          ? name
          : undefined
      }),
    )
    for (const name of results) if (name !== undefined) found.push(name)
  }
  return [...new Set(found)].sort()
}

/** The real path of a folder, or `undefined` when it does not exist or is not a folder. */
async function realFolder(path: string): Promise<string | undefined> {
  try {
    const real = await realpath(path)
    return (await stat(real)).isDirectory() ? real : undefined
  } catch {
    return undefined
  }
}

/** Makes the refusal builder of one check run; every refusal carries the Node version found. */
function refuserFor(nodeVersion: string) {
  return (
    reason: string,
    sentence: string,
    details: Record<string, unknown> = {},
  ): StudyError =>
    createLibraryBuildError('LIBRARY_BUILD_UNSUPPORTED', reason, sentence, {
      nodeVersion,
      ...details,
    })
}

type Refuser = ReturnType<typeof refuserFor>

/** Checks the folder: inside the repository, and not the Example or inside it. */
async function locateLibraryFolder(
  inputs: LibraryRouteInputs,
  refuse: Refuser,
): Promise<string> {
  const fieldDetails = { field: LIBRARY_PACKAGE_ROOT_FIELD }
  const libraryRoot = await realFolder(
    join(inputs.repositoryRoot, inputs.declaredPackageRoot),
  )
  // A missing folder, a file, and a link that leaves the repository all fail the same check.
  if (
    libraryRoot === undefined ||
    !isAtOrInsideFolder(inputs.repositoryRoot, libraryRoot)
  )
    throw refuse(
      'outside-repository',
      '`library.packageRoot` is not a folder inside the opened repository.',
      fieldDetails,
    )
  if (isAtOrInsideFolder(inputs.examplePackageRoot, libraryRoot))
    throw refuse(
      'inside-example',
      "`library.packageRoot` is the Example's packageRoot or lies inside it.",
      fieldDetails,
    )
  return libraryRoot
}

/** Checks the manifests: a named package, a dependency of the Example, with a build script. */
async function readSupportedManifest(
  inputs: LibraryRouteInputs,
  libraryRoot: string,
  refuse: Refuser,
): Promise<
  Manifest & {
    name: string
    reachedThrough?: string[]
    reachedThroughCount?: number
  }
> {
  const library = await readManifest(libraryRoot)
  // A name that is not a plain package name could build a path outside the pack folders.
  if (library?.name === undefined || !isNpmPackageName(library.name))
    throw refuse(
      'not-a-package',
      '`library.packageRoot` holds no package.json with a valid package name.',
      { field: LIBRARY_PACKAGE_ROOT_FIELD },
    )
  const example = await readManifest(inputs.examplePackageRoot)
  const exampleNames = [
    ...(example?.dependencies ?? []),
    ...(example?.devDependencies ?? []),
    ...(example?.peerDependencies ?? []),
  ]
  let relation: { reachedThrough?: string[]; reachedThroughCount?: number } = {}
  if (!exampleNames.includes(library.name)) {
    const isTransitiveAllowed =
      inputs.dependencyRelation === 'direct-or-installed'
    const dependents = isTransitiveAllowed
      ? await installedDependentsOf(
          inputs.examplePackageRoot,
          // Only a plain package name may build a node_modules path; a key such as "../x" would read a manifest outside node_modules.
          [...new Set(exampleNames)].filter(isNpmPackageName),
          library.name,
        )
      : []
    if (dependents.length === 0)
      throw refuse(
        'not-a-dependency',
        isTransitiveAllowed
          ? `Neither the Example's package.json nor any of its installed direct dependencies depends on ${library.name}.`
          : `The Example's package.json does not depend on ${library.name}.`,
        { package: library.name },
      )
    relation = {
      reachedThrough: dependents.slice(0, LIBRARY_REACHED_THROUGH_LIMIT),
      reachedThroughCount: dependents.length,
    }
  }
  if (typeof library.scripts.build !== 'string')
    throw refuse('no-build-script', `${library.name} has no build script.`, {
      package: library.name,
    })
  return { ...library, name: library.name, ...relation }
}

/** Checks that the library's dependencies are installed for it and its peers for the Example. */
async function assertInstalled(
  inputs: LibraryRouteInputs,
  library: Manifest,
  libraryRoot: string,
  installCommand: string,
  refuse: Refuser,
): Promise<string[]> {
  for (const dependency of library.dependencies)
    if (
      (await readInstalledPackageManifest(libraryRoot, dependency)) ===
      undefined
    )
      throw refuse(
        'library-not-installed',
        "The library's dependencies are not installed; install the repository with its package manager.",
        { package: dependency, installCommand, folder: inputs.repositoryRoot },
      )
  const peers = library.peerDependencies.filter(
    (peer) => !library.optionalPeers.includes(peer),
  )
  for (const peer of peers)
    if (
      (await readInstalledPackageManifest(inputs.examplePackageRoot, peer)) ===
      undefined
    )
      throw refuse(
        'peer-not-installed',
        `The Example cannot resolve ${peer}, a peer dependency of ${library.name}; install the Example's dependencies.`,
        { package: peer },
      )
  return peers
}

/**
 * Checks everything that can be known before the library build starts, and refuses with `LIBRARY_BUILD_UNSUPPORTED` and a `details.reason` when one fails.
 * Called first by {@link prepareLibraryPackage}; nothing is spawned or written when it throws.
 * @param inputs - The roots, the declared folder, the external Node, the `PATH` and (optionally) the {@link LibraryDependencyRelation}.
 * @returns The library's real folder, name, version, non-optional peers and the package manager found, and `reachedThrough` with `reachedThroughCount` when the Example reaches the library only through installed dependencies.
 * @throws `StudyError` `LIBRARY_BUILD_UNSUPPORTED` with reason `outside-repository`, `inside-example`, `not-a-package`, `not-a-dependency`, `no-build-script`, `package-manager-unsupported`, `package-manager-unknown`, `package-manager-missing`, `library-not-installed`, `peer-not-installed` or `node-version`, checked in that order.
 * @example
 * await assertLibraryRouteSupported({ repositoryRoot: '/repo', examplePackageRoot: '/repo/examples/node', declaredPackageRoot: 'packages/toolkit', node, pathText: '/node/bin:/usr/bin' })
 * // => { libraryRoot: '/repo/packages/toolkit', relativeRoot: 'packages/toolkit', name: '@reduxjs/toolkit', … }
 */
export async function assertLibraryRouteSupported(
  inputs: LibraryRouteInputs,
): Promise<SupportedLibrary> {
  const nodeVersion = inputs.node?.version ?? 'none'
  const refuse = refuserFor(nodeVersion)
  const libraryRoot = await locateLibraryFolder(inputs, refuse)
  const library = await readSupportedManifest(inputs, libraryRoot, refuse)
  const packageManager = await resolveRepositoryPackageManager(
    inputs.repositoryRoot,
    inputs,
  )
  if (!packageManager.ok)
    throw refuse(
      packageManager.reason,
      packageManagerSentence(packageManager),
      {
        packageManager: packageManager.packageManager,
      },
    )
  const peers = await assertInstalled(
    inputs,
    library,
    libraryRoot,
    `${packageManager.name} install`,
    refuse,
  )
  const nodeMajor = Number(inputs.node?.version.split('.')[0])
  if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR_VERSION)
    throw refuse(
      'node-version',
      `The library build needs an external Node ${MIN_NODE_MAJOR_VERSION} or later; it is ${nodeVersion}.`,
    )
  return {
    libraryRoot,
    relativeRoot:
      relative(inputs.repositoryRoot, libraryRoot).split(sep).join('/') || '.',
    name: library.name,
    version: library.version,
    peers,
    packageManager,
    // Only a transitive Example states the relation, so every other result stays as it was.
    ...(library.reachedThrough === undefined
      ? {}
      : {
          reachedThrough: library.reachedThrough,
          reachedThroughCount: library.reachedThroughCount,
        }),
  }
}

/** The sentence of a package manager refusal. */
function packageManagerSentence(
  refusal: Extract<RepositoryPackageManagerResult, { ok: false }>,
): string {
  if (refusal.reason === 'package-manager-missing')
    return `The repository's package manager ${refusal.packageManager} was not found.`
  if (refusal.reason === 'package-manager-unknown')
    return `The repository declares no packageManager and has ${refusal.packageManager === '' ? 'no lockfile' : `these lockfiles: ${refusal.packageManager}`}; add a packageManager field to the root package.json or keep one lockfile.`
  return `This version builds with pnpm or npm only; the repository uses ${refusal.packageManager}.`
}

/**
 * Builds the `PATH` of a library build: the external Node's folder first, then the host's.
 * @param nodeExecutable - The external Node's path, if resolved.
 * @param hostPath - The host's `PATH`.
 * @returns The `PATH` text.
 * @example
 * libraryBuildPath('/node/bin/node', '/usr/bin') // => '/node/bin:/usr/bin'
 */
export function libraryBuildPath(
  nodeExecutable: string | undefined,
  hostPath: string,
): string {
  if (nodeExecutable === undefined) return hostPath
  const nodeFolder = dirname(nodeExecutable)
  return hostPath === '' ? nodeFolder : `${nodeFolder}${delimiter}${hostPath}`
}
