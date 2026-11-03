import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { StudyError } from '../errors'

import {
  assertDevelopmentWorkspace,
  type DevelopmentLockIdentity,
} from './assertDevelopmentWorkspace'
import { readNextRouterKind } from './readNextRouterKind'
import {
  readNextInstallation,
  type NextPackageReadiness,
} from './readRepositoryAdapterReadiness'
import { resolveNextPackage } from './resolveNextPackage'
import {
  scanNextPackages,
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
  return {
    packages: scan.items,
    packagesTruncated: scan.truncation !== undefined,
    ...(scan.truncation ? { packagesTruncatedReason: scan.truncation } : {}),
  }
}
