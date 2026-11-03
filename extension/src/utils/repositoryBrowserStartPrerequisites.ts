import { REPOSITORY_BROWSER_PROFILE } from '../constants'
import { StudyError } from '../errors'
import type { StudyEnvironment } from '../runtime'

import { assertDevelopmentWorkspace } from './assertDevelopmentWorkspace'
import { resolveNextPackage } from './resolveNextPackage'
import { suggestNextPackageRoots } from './scanNextPackages'

/** The sentence of a vite-dev start whose window reported no Vite readiness. */
const VITE_READINESS_UNAVAILABLE =
  "Codebook could not read the Vite adapter's readiness for this window. Call codebook_status again, or reload the window, and retry."

type EnvironmentPrerequisites = Awaited<
  ReturnType<StudyEnvironment['prerequisites']>
>

/**
 * Picks the prerequisites a repository-browser start waits on from its configured adapter, so a Vite app without Next is not refused by Next's workspace checks.
 *
 * The repository-browser profile's own `ready`/`missing` describe the Next adapter (its dependencies and `.next/dev` lock); a `vite-dev` start waits on the `vite-dev` entry of {@link StudyEnvironment.prerequisites}' `adapters` instead, which already holds the shared prerequisites, Vite's gates and any managed run that blocks a start. Called by {@link StudyService} when a configured run begins.
 *
 * @param prerequisites - What the environment reported for this window.
 * @param profile - The profile of the run that is starting.
 * @param configuration - The run's configuration; only its `adapter` is read.
 * @returns
 * - The `vite-dev` readiness when a repository-browser run declares `adapter: "vite-dev"` and the environment reports adapters
 * - A not-ready result with one `missing` sentence when the run declares `adapter: "vite-dev"` and the environment reported the repository-browser profile's readiness without a Vite entry, so the Next readiness never judges a Vite app
 * - `undefined` for any other profile or adapter, or when the environment reported no profile readiness at all, so the caller keeps the profile's own or the window's overall prerequisites
 * @example
 * repositoryBrowserStartPrerequisites(prerequisites, 'repository-browser', { adapter: 'vite-dev' })
 * // => { ready: true, missing: [], installed: true, version: '8.3.5', … }
 */
export function repositoryBrowserStartPrerequisites(
  prerequisites: EnvironmentPrerequisites,
  profile: string,
  configuration: unknown,
): { ready: boolean; missing: string[] } | undefined {
  // Only a repository-browser run declares an adapter; other profiles keep their own prerequisites.
  if (profile !== REPOSITORY_BROWSER_PROFILE) return undefined
  const adapter =
    typeof configuration === 'object' &&
    configuration !== null &&
    'adapter' in configuration
      ? configuration.adapter
      : undefined
  // The Next adapter is what the profile's own readiness already describes.
  if (adapter !== 'vite-dev') return undefined
  const profileReadiness = prerequisites.profiles?.[REPOSITORY_BROWSER_PROFILE]
  // Without any profile readiness the caller keeps the window's overall prerequisites, which judge no adapter.
  if (!profileReadiness) return undefined
  // A profile readiness without the Vite entry describes Next only, so it never judges a Vite app.
  return (
    profileReadiness.adapters?.['vite-dev'] ?? {
      ready: false,
      missing: [VITE_READINESS_UNAVAILABLE],
    }
  )
}

/**
 * Judges a `next-dev-webpack` start whose configuration declares a `packageRoot` below the repository root, by the selected package and not by the root's readiness.
 *
 * The shared prerequisites (Node, Chrome) stay the window's own; the package is judged by {@link resolveNextPackage} (real path, then Next installation) and by its own `.next/dev` checks, so a root without Next, or an unrelated root `.next/dev/lock`, never blocks a nested start. Called by {@link StudyService} before it falls back to {@link repositoryBrowserStartPrerequisites}.
 *
 * @param prerequisites - What the environment reported; only its shared `ready`/`missing` (Node, Chrome) are read.
 * @param profile - The profile of the run that is starting.
 * @param configuration - The run's configuration; `adapter` and `packageRoot` are read.
 * @param workspace - The opened repository's root.
 * @param signal - Ends the check when the run is cancelled.
 * @returns
 * - `undefined` for any other profile or adapter, or a root app (absent `packageRoot`), so the caller keeps today's readiness
 * - The shared prerequisites joined with the selected package's own gaps
 * @throws `INVALID_CONFIGURATION` for an unusable `packageRoot` and `PREREQUISITE_MISSING` for a missing Next, before the shared gaps are judged (refusal order: real path, Next installation).
 * @example
 * await selectedNextPackageStartPrerequisites(prerequisites, 'repository-browser', { adapter: 'next-dev-webpack', packageRoot: 'examples/react/nextjs' }, '/repo', signal)
 * // => { ready: true, missing: [] }
 */
export async function selectedNextPackageStartPrerequisites(
  prerequisites: EnvironmentPrerequisites,
  profile: string,
  configuration: unknown,
  workspace: string,
  signal: AbortSignal,
): Promise<{ ready: boolean; missing: string[] } | undefined> {
  if (
    profile !== REPOSITORY_BROWSER_PROFILE ||
    typeof configuration !== 'object' ||
    configuration === null ||
    !('adapter' in configuration) ||
    configuration.adapter !== 'next-dev-webpack' ||
    !('packageRoot' in configuration) ||
    typeof configuration.packageRoot !== 'string' ||
    configuration.packageRoot === '.'
  )
    return undefined
  const nextPackage = await resolveNextPackage(
    workspace,
    configuration.packageRoot,
    // A refusal names up to five discovered apps (DX-5).
    { suggest: () => suggestNextPackageRoots(workspace) },
  )
  const packageGaps = await assertDevelopmentWorkspace(
    nextPackage.packageRoot,
    signal,
    undefined,
    nextPackage.nextFolder,
  ).then(
    () => [],
    (error: unknown) => [
      error instanceof StudyError ? error.message : String(error),
    ],
  )
  const missing = [...prerequisites.missing, ...packageGaps]
  return { ready: missing.length === 0, missing }
}

/**
 * Says whether a start is a `next-dev-webpack` run of the repository root (no `packageRoot`, or `"."`).
 *
 * Called by {@link StudyService} to decide whether a refused root start may point to the Next apps below the root (DX-19).
 *
 * @param profile - The profile of the run that is starting.
 * @param configuration - The run's configuration.
 * @returns `true` for a repository-browser run of the `next-dev-webpack` adapter without a non-root `packageRoot`.
 * @example isRootNextStart('repository-browser', { adapter: 'next-dev-webpack' }) // => true
 */
export function isRootNextStart(
  profile: string,
  configuration: unknown,
): boolean {
  if (
    profile !== REPOSITORY_BROWSER_PROFILE ||
    typeof configuration !== 'object' ||
    configuration === null ||
    !('adapter' in configuration) ||
    configuration.adapter !== 'next-dev-webpack'
  )
    return false
  return (
    !('packageRoot' in configuration) ||
    configuration.packageRoot === undefined ||
    configuration.packageRoot === '.'
  )
}
