import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { StudyError } from '../errors'

import {
  assertDevelopmentWorkspace,
  type DevelopmentLockIdentity,
} from './assertDevelopmentWorkspace'
import { readNextRouterKind } from './readNextRouterKind'
import { readNodeVersion } from './readNodeVersion'
import {
  readNextInstallation,
  type NextPackageReadiness,
  type VitePackageReadiness,
} from './readRepositoryAdapterReadiness'
import { readViteWorkspaceGaps } from './readViteWorkspaceGaps'
import { resolveNextPackage } from './resolveNextPackage'
import { resolveVitePackage } from './resolveVitePackage'
import {
  scanNextPackages,
  scanPackages,
  type NextPackageScan,
  type NextPackageTruncationReason,
  type ScanNextPackagesOptions,
} from './scanNextPackages'

/** The discovery's answer for `next-dev-webpack` readiness. */
export type NextPackageDiscovery = {
  packages: NextPackageReadiness[]
  /** Whether the list is incomplete (a cap, the deadline, a skipped path or a Git failure). */
  packagesTruncated: boolean
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** The discovery's answer for `vite-dev` readiness. */
export type VitePackageDiscovery = {
  packages: VitePackageReadiness[]
  /** Whether the list is incomplete (a cap, the deadline, a skipped path or a Git failure). */
  packagesTruncated: boolean
  packagesTruncatedReason?: NextPackageTruncationReason
}

/** Options of {@link discoverNextPackages}; `readPackage` is injectable so a test can make one package slow. */
export type DiscoverNextPackagesOptions = ScanNextPackagesOptions & {
  /** The lock identity Codebook's own running app holds; a package whose `.next/dev/lock` is exactly that file is not judged foreign. */
  ownedLock?: DevelopmentLockIdentity
  readPackage?: (
    repositoryRoot: string,
    packageRoot: string,
    signal: AbortSignal,
    ownedLock?: DevelopmentLockIdentity,
  ) => Promise<NextPackageReadiness>
}

/**
 * Words a failure of a package read as a sentence for `codebook_status`, without any path.
 *
 * Why it exists: an `lstat` of an unreadable `.next` throws an Error whose text holds the absolute path, and an entry's `missing` reaches the chat. A {@link StudyError} already words its own message; anything else becomes a fixed sentence naming only the errno code. Called by {@link readNextPackageReadiness} and by the nested start's prerequisites ({@link selectedNextPackageStartPrerequisites}).
 *
 * @param error - What the read threw.
 * @returns The sentence.
 * @example describeReadFailure(Object.assign(new Error("EACCES: lstat '/x/.next'"), { code: 'EACCES' })) // => 'The package could not be checked (EACCES).'
 */
export function describeReadFailure(error: unknown): string {
  if (error instanceof StudyError) return error.message
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined
  // Only an errno-shaped code is repeated; any other value could carry text.
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code)
    ? `The package could not be checked (${code}).`
    : 'The package could not be checked.'
}

/**
 * Keeps the owned lock identity only when it is this package's own lock file.
 *
 * Why it exists: the run owns one `.next/dev/lock`; handing it to another package's check would call that package's missing lock foreign. Called by {@link readNextPackageReadiness}.
 *
 * @param packageRoot - The package's real root.
 * @param ownedLock - The identity the running app holds, if any.
 * @returns `ownedLock` when `<packageRoot>/.next/dev/lock` is that file; `undefined` otherwise.
 * @example await ownedLockOfPackage('/repo/apps/web', { dev: 1n, ino: 2n }) // => { dev: 1n, ino: 2n } when that is its lock
 */
async function ownedLockOfPackage(
  packageRoot: string,
  ownedLock: DevelopmentLockIdentity | undefined,
): Promise<DevelopmentLockIdentity | undefined> {
  if (!ownedLock) return undefined
  const identity = await lstat(join(packageRoot, '.next/dev/lock'), {
    bigint: true,
  }).catch(() => undefined)
  return identity?.dev === ownedLock.dev && identity.ino === ownedLock.ino
    ? ownedLock
    : undefined
}

/**
 * Reads what a start with this `packageRoot` checks, as a status entry: the shared resolver ({@link resolveNextPackage}: real path, Next app, Next inside the repository), the Next installation and the package's own `.next/dev` checks ({@link assertDevelopmentWorkspace}).
 *
 * Why it exists: an entry's `ready` and `missing` must equal what a start decides, so the chat never starts a package that is not installed. A refusal of the resolver becomes the entry's `missing` sentence. Called by {@link discoverNextPackages} for each discovered app; entries carry no `preparation` or `notes`.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The discovered repository-relative folder.
 * @param signal - Ends the checks.
 * @param ownedLock - The lock identity Codebook's own running app holds, permitted at its own package.
 * @returns The entry.
 * @example await readNextPackageReadiness('/repo', 'apps/web', signal) // => { packageRoot: 'apps/web', routerKind: 'app', installed: true, ready: true, version: '16.0.1', missing: [] }
 */
async function readNextPackageReadiness(
  repositoryRoot: string,
  packageRoot: string,
  signal: AbortSignal,
  ownedLock?: DevelopmentLockIdentity,
): Promise<NextPackageReadiness> {
  let resolved: Awaited<ReturnType<typeof resolveNextPackage>>
  try {
    resolved = await resolveNextPackage(repositoryRoot, packageRoot)
  } catch (error) {
    return {
      packageRoot,
      // The folder is tracked, so its route folders can be named even when Next is not usable.
      routerKind: await readNextRouterKind(join(repositoryRoot, packageRoot)),
      installed: false,
      ready: false,
      missing: [describeReadFailure(error)],
    }
  }
  const [routerKind, installation, gaps] = await Promise.all([
    readNextRouterKind(resolved.packageRoot),
    readNextInstallation(resolved.packageRoot, resolved.nextFolder),
    assertDevelopmentWorkspace(
      resolved.packageRoot,
      signal,
      await ownedLockOfPackage(resolved.packageRoot, ownedLock),
      resolved.nextFolder,
    ).then(
      () => [],
      (error: unknown) => [describeReadFailure(error)],
    ),
  ])
  const missing = [...installation.missing, ...gaps]
  return {
    packageRoot,
    routerKind,
    installed: installation.installed,
    ready: installation.ready && gaps.length === 0,
    ...(installation.version === undefined
      ? {}
      : { version: installation.version }),
    missing,
  }
}

/**
 * Discovers the Next apps below the repository root for `codebook_status`: tracked `package.json` files only, within one deadline, each with the readiness a start would decide.
 *
 * Why it exists: AC 4 and AC 13, so the chat chooses the package from status and never guesses from files. Called by {@link readRepositoryAdapterReadiness} beside the other adapters' readiness. See {@link scanNextPackages} for the bounds (50 apps, 500 manifests, 256 KiB, depth 4, 5 s).
 *
 * @param repositoryRoot - The opened repository's root (the Git top level).
 * @param options - Clock, deadline, cancellation, limits and the entry reader.
 * @returns The entries, `packagesTruncated`, and `packagesTruncatedReason` when truncated.
 * @example await discoverNextPackages('/repo') // => { packages: [{ packageRoot: 'examples/react/nextjs', … }], packagesTruncated: false }
 */
export async function discoverNextPackages(
  repositoryRoot: string,
  options: DiscoverNextPackagesOptions = {},
): Promise<NextPackageDiscovery> {
  const {
    readPackage = readNextPackageReadiness,
    ownedLock,
    ...scanOptions
  } = options
  const scan = await scanNextPackages(
    repositoryRoot,
    (app, signal) =>
      readPackage(repositoryRoot, app.packageRoot, signal, ownedLock),
    scanOptions,
  )
  return discoveryOf(scan)
}

/**
 * Turns a scan into the discovery's answer: the entries and whether, and why, the list is incomplete.
 * Called by {@link discoverNextPackages} and {@link discoverPackages} for each kind.
 * @param scan - What the scan produced for one kind.
 * @returns The entries, `packagesTruncated`, and `packagesTruncatedReason` when truncated.
 * @example discoveryOf({ items: [], truncation: 'limit' }) // => { packages: [], packagesTruncated: true, packagesTruncatedReason: 'limit' }
 */
function discoveryOf<Item>(scan: NextPackageScan<Item>): {
  packages: Item[]
  packagesTruncated: boolean
  packagesTruncatedReason?: NextPackageTruncationReason
} {
  return {
    packages: scan.items,
    packagesTruncated: scan.truncation !== undefined,
    ...(scan.truncation ? { packagesTruncatedReason: scan.truncation } : {}),
  }
}

/**
 * Reads what a start with this `packageRoot` checks, as a Vite status entry: the shared resolver ({@link resolveVitePackage}: real path, Vite app by decision D5) and the gaps of {@link readViteWorkspaceGaps} with Vite resolved inside the repository (decision D7).
 *
 * Why it exists: an entry's `ready` and `missing` must equal what a start decides, so the chat never starts an app that is not installed or has no accepted `dev` script (an `index.html` app without a `dev` script, or with a `predev`, is listed `ready: false` with the gap). A refusal of the resolver becomes the entry's `missing` sentence. Called by {@link discoverPackages} for each discovered Vite app.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The discovered repository-relative folder.
 * @param readNode - Reads the run's Node version once for the whole discovery.
 * @returns The entry.
 * @example await readVitePackageReadiness('/repo', 'examples/react/basic', async () => 'v24.22.1') // => { packageRoot: 'examples/react/basic', installed: true, ready: true, version: '8.3.5', missing: [] }
 */
async function readVitePackageReadiness(
  repositoryRoot: string,
  packageRoot: string,
  readNode: () => Promise<string | undefined>,
): Promise<VitePackageReadiness> {
  let resolved: Awaited<ReturnType<typeof resolveVitePackage>>
  try {
    resolved = await resolveVitePackage(repositoryRoot, packageRoot)
  } catch (error) {
    return {
      packageRoot,
      installed: false,
      ready: false,
      missing: [describeReadFailure(error)],
    }
  }
  const reading = await readViteWorkspaceGaps(
    resolved.packageRoot,
    readNode,
    false,
    resolved.repositoryRoot,
  )
  return {
    packageRoot,
    installed: reading.installation !== undefined,
    ready: reading.ready,
    ...(reading.installation ? { version: reading.installation.version } : {}),
    missing: reading.gaps.map((gap) => gap.statusMessage ?? gap.message),
  }
}

/** Options of {@link discoverPackages}: those of {@link discoverNextPackages} plus the Node the Vite apps' `engines.node` is judged against. */
export type DiscoverPackagesOptions = DiscoverNextPackagesOptions & {
  /** The configured Node executable, when one resolved; without it an app whose Vite declares `engines.node` is not ready, as at a start. */
  node?: string
  /** Replaces the Vite entry reader so a test can make one app slow. */
  readVitePackage?: (
    repositoryRoot: string,
    packageRoot: string,
    readNode: () => Promise<string | undefined>,
    signal: AbortSignal,
  ) => Promise<VitePackageReadiness>
}

/**
 * Discovers the Next apps and the Vite apps below the repository root for `codebook_status` in one pass over the tracked `package.json` files ({@link scanPackages}), each with the readiness a start would decide.
 *
 * Why it exists: Cycle 0077 lists Vite apps beside Next apps without a second `git ls-files`, manifest read or deadline. Called by {@link readStatusAdapterReadiness}.
 *
 * @param repositoryRoot - The opened repository's root (the Git top level).
 * @param options - Clock, deadline, cancellation, limits, the Node executable and the entry readers.
 * @returns One discovery per kind, each with its entries, `packagesTruncated` and `packagesTruncatedReason`.
 * @example await discoverPackages('/repo', { node: '/usr/bin/node' }) // => { next: { packages: […], packagesTruncated: false }, vite: { packages: [{ packageRoot: 'examples/react/basic', … }], packagesTruncated: false } }
 */
export async function discoverPackages(
  repositoryRoot: string,
  options: DiscoverPackagesOptions = {},
): Promise<{ next: NextPackageDiscovery; vite: VitePackageDiscovery }> {
  const {
    readPackage = readNextPackageReadiness,
    readVitePackage = (root, folder, readNode) =>
      readVitePackageReadiness(root, folder, readNode),
    ownedLock,
    node,
    ...scanOptions
  } = options
  // One Node version read serves every app of the pass; it is read only when an app's Vite declares `engines.node`.
  let nodeVersion: Promise<string | undefined> | undefined
  const scan = await scanPackages(
    repositoryRoot,
    {
      next: (app, signal) =>
        readPackage(repositoryRoot, app.packageRoot, signal, ownedLock),
      vite: (app, signal) =>
        readVitePackage(
          repositoryRoot,
          app.packageRoot,
          () =>
            (nodeVersion ??= node
              ? readNodeVersion(node, signal)
              : Promise.resolve(undefined)),
          signal,
        ),
    },
    scanOptions,
  )
  return { next: discoveryOf(scan.next), vite: discoveryOf(scan.vite) }
}
