import { join } from 'node:path'

import { StudyError } from '../errors'

import { assertDevelopmentWorkspace } from './assertDevelopmentWorkspace'
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
  readPackage?: (
    repositoryRoot: string,
    packageRoot: string,
    signal: AbortSignal,
  ) => Promise<NextPackageReadiness>
}

/**
 * Reads what a start with this `packageRoot` checks, as a status entry: the shared resolver ({@link resolveNextPackage}: real path, Next app, Next inside the repository), the Next installation and the package's own `.next/dev` checks ({@link assertDevelopmentWorkspace}).
 *
 * Why it exists: an entry's `ready` and `missing` must equal what a start decides, so the chat never starts a package that is not installed. A refusal of the resolver becomes the entry's `missing` sentence. Called by {@link discoverNextPackages} for each discovered app; entries carry no `preparation` or `notes`.
 *
 * @param repositoryRoot - The opened repository's root.
 * @param packageRoot - The discovered repository-relative folder.
 * @param signal - Ends the checks.
 * @returns The entry.
 * @example await readNextPackageReadiness('/repo', 'apps/web', signal) // => { packageRoot: 'apps/web', routerKind: 'app', installed: true, ready: true, version: '16.0.1', missing: [] }
 */
async function readNextPackageReadiness(
  repositoryRoot: string,
  packageRoot: string,
  signal: AbortSignal,
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
      missing: [error instanceof Error ? error.message : String(error)],
    }
  }
  const [routerKind, installation, gaps] = await Promise.all([
    readNextRouterKind(resolved.packageRoot),
    readNextInstallation(resolved.packageRoot, resolved.nextFolder),
    assertDevelopmentWorkspace(
      resolved.packageRoot,
      signal,
      undefined,
      resolved.nextFolder,
    ).then(
      () => [],
      (error: unknown) => [
        error instanceof StudyError ? error.message : String(error),
      ],
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
  const { readPackage = readNextPackageReadiness, ...scanOptions } = options
  const scan = await scanNextPackages(
    repositoryRoot,
    (app, signal) => readPackage(repositoryRoot, app.packageRoot, signal),
    scanOptions,
  )
  return {
    packages: scan.items,
    packagesTruncated: scan.truncation !== undefined,
    ...(scan.truncation ? { packagesTruncatedReason: scan.truncation } : {}),
  }
}
