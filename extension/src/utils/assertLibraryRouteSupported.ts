import { readFile, realpath, stat } from 'node:fs/promises'
import { delimiter, dirname, join, relative, sep } from 'node:path'

import { MIN_NODE_MAJOR_VERSION } from '../constants'
import type { StudyError } from '../errors'

import { createLibraryBuildError } from './createLibraryBuildError'
import { isAtOrInsideFolder } from './isAtOrInsideFolder'
import { readInstalledPackageManifest } from './readInstalledPackageManifest'
import {
  resolveRepositoryPackageManager,
  type RepositoryPackageManagerResult,
} from './resolveRepositoryPackageManager'

/** The field path the library refusals name when the declared folder is at fault. */
const LIBRARY_PACKAGE_ROOT_FIELD = 'configuration.library.packageRoot'

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
): Promise<Manifest & { name: string }> {
  const library = await readManifest(libraryRoot)
  if (library?.name === undefined)
    throw refuse(
      'not-a-package',
      '`library.packageRoot` holds no package.json with a name.',
      { field: LIBRARY_PACKAGE_ROOT_FIELD },
    )
  const example = await readManifest(inputs.examplePackageRoot)
  const exampleNames = [
    ...(example?.dependencies ?? []),
    ...(example?.devDependencies ?? []),
    ...(example?.peerDependencies ?? []),
  ]
  if (!exampleNames.includes(library.name))
    throw refuse(
      'not-a-dependency',
      `The Example's package.json does not depend on ${library.name}.`,
      { package: library.name },
    )
  if (typeof library.scripts.build !== 'string')
    throw refuse('no-build-script', `${library.name} has no build script.`, {
      package: library.name,
    })
  return { ...library, name: library.name }
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
 * @param inputs - The roots, the declared folder, the external Node and the `PATH`.
 * @returns The library's real folder, name, version, non-optional peers and the package manager found.
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
