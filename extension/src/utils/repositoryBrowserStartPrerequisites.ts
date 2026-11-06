import { REPOSITORY_BROWSER_PROFILE } from '../constants'
import type { StudyEnvironment } from '../runtime'

import { assertDevelopmentWorkspace } from './assertDevelopmentWorkspace'
import { describeReadFailure } from './discoverNextPackages'
import { managedRunStateOf } from './managedRunStateMessages'
import { resolveExpoWebPackage } from './resolveExpoWebPackage'
import { resolveNextPackage } from './resolveNextPackage'
import { resolveReactScriptsPackage } from './resolveReactScriptsPackage'
import { resolveVitePackage } from './resolveVitePackage'
import {
  suggestNextPackageRoots,
  suggestVitePackageRoots,
} from './scanNextPackages'

/** The sentence of a vite-dev start whose window reported no Vite readiness. */
const VITE_READINESS_UNAVAILABLE =
  "Codebook could not read the Vite adapter's readiness for this window. Call codebook_status again, or reload the window, and retry."

/** The sentence of a react-scripts-dev start whose window reported no react-scripts readiness. */
const REACT_SCRIPTS_READINESS_UNAVAILABLE =
  "Codebook could not read the react-scripts adapter's readiness for this window. Call codebook_status again, or reload the window, and retry."

/** The sentence of an expo-web-dev start whose window reported no Expo readiness. */
const EXPO_WEB_READINESS_UNAVAILABLE =
  "Codebook could not read the Expo adapter's readiness for this window. Call codebook_status again, or reload the window, and retry."

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
 * - A not-ready result with one `missing` sentence when the run declares `adapter: "vite-dev"` and the environment reported the repository-browser profile's readiness without an entry for the adapter (a `react-scripts-dev` run gets a sentence about the react-scripts adapter), so the Next readiness never judges a Vite or react-scripts app
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
  if (
    adapter !== 'vite-dev' &&
    adapter !== 'react-scripts-dev' &&
    adapter !== 'expo-web-dev'
  )
    return undefined
  const profileReadiness = prerequisites.profiles?.[REPOSITORY_BROWSER_PROFILE]
  // Without any profile readiness the caller keeps the window's overall prerequisites, which judge no adapter.
  if (!profileReadiness) return undefined
  // A profile readiness without the adapter's entry describes Next only, so it never judges a Vite or react-scripts app.
  return (
    profileReadiness.adapters?.[adapter] ?? {
      ready: false,
      missing: [
        {
          'vite-dev': VITE_READINESS_UNAVAILABLE,
          'react-scripts-dev': REACT_SCRIPTS_READINESS_UNAVAILABLE,
          'expo-web-dev': EXPO_WEB_READINESS_UNAVAILABLE,
        }[adapter],
      ],
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
    // Errno only, never the absolute path an unreadable `.next` carries.
    (error: unknown) => [describeReadFailure(error)],
  )
  const missing = [...prerequisites.missing, ...packageGaps]
  return { ready: missing.length === 0, missing }
}

/**
 * Judges a `vite-dev` start whose configuration declares a `packageRoot` below the repository root, by the selected app and not by the root's readiness.
 *
 * The shared prerequisites (Node, Chrome, a managed run) stay the window's own; the app is judged by {@link resolveVitePackage} (real path, then the Vite app rule), so a root without Vite never blocks a nested start. Vite's own installation, version, `engines.node` and `dev` script are judged by the run's workspace check before any process starts (decision D7). Called by {@link StudyService} before it falls back to {@link repositoryBrowserStartPrerequisites}.
 *
 * @param prerequisites - What the environment reported; only its shared `ready`/`missing` are read.
 * @param profile - The profile of the run that is starting.
 * @param configuration - The run's configuration; `adapter` and `packageRoot` are read.
 * @param workspace - The opened repository's root.
 * @returns
 * - `undefined` for any other profile or adapter, or a root app (absent `packageRoot`), so the caller keeps today's readiness
 * - The shared prerequisites and any managed-run state when the folder is a Vite app
 * @throws `INVALID_CONFIGURATION` for an unusable `packageRoot`, before the shared gaps are judged.
 * @example
 * await selectedVitePackageStartPrerequisites(prerequisites, 'repository-browser', { adapter: 'vite-dev', packageRoot: 'examples/react/basic' }, '/repo')
 * // => { ready: true, missing: [] }
 */
export async function selectedVitePackageStartPrerequisites(
  prerequisites: EnvironmentPrerequisites,
  profile: string,
  configuration: unknown,
  workspace: string,
): Promise<{ ready: boolean; missing: string[] } | undefined> {
  if (
    profile !== REPOSITORY_BROWSER_PROFILE ||
    typeof configuration !== 'object' ||
    configuration === null ||
    !('adapter' in configuration) ||
    (configuration.adapter !== 'vite-dev' &&
      configuration.adapter !== 'react-scripts-dev' &&
      configuration.adapter !== 'expo-web-dev') ||
    !('packageRoot' in configuration) ||
    typeof configuration.packageRoot !== 'string' ||
    configuration.packageRoot === '.'
  )
    return undefined
  // A react-scripts or Expo app is judged by the same app rule the run applies; a Vite app by Vite's.
  if (configuration.adapter === 'react-scripts-dev')
    await resolveReactScriptsPackage(workspace, configuration.packageRoot)
  else if (configuration.adapter === 'expo-web-dev')
    await resolveExpoWebPackage(workspace, configuration.packageRoot)
  else
    await resolveVitePackage(workspace, configuration.packageRoot, {
      // A refusal names up to five discovered apps.
      suggest: () => suggestVitePackageRoots(workspace),
    })
  // A managed run that is preparing or releasing blocks a nested start as it blocks the root's.
  const missing = [
    ...prerequisites.missing,
    ...managedRunStateOf(
      prerequisites.profiles?.[REPOSITORY_BROWSER_PROFILE]?.missing ?? [],
    ),
  ]
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
