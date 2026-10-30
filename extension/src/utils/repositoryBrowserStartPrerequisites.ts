import { REPOSITORY_BROWSER_PROFILE } from '../constants'
import type { StudyEnvironment } from '../runtime'

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
