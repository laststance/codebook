import { resolve } from 'node:path'

import type { LibraryBuildCandidate } from './libraryBuildStop'

/**
 * Gives the paths a nested App Router app's browser map names for a library's stop file, per frozen build flavour.
 *
 * Why it exists: in the App Router layers Next composes a library build map into each module's own map, and writes the build map's source entry (`../../src/mutation.ts`) resolved against the app's package root instead of against the map's folder (measured on Next 16.2.2, E1 of Cycle 0080). The result names a file that does not exist (`<repo>/examples/src/mutation.ts`). The freeze computes these paths once so that the seal can check the map and the browser launch can map them onto the checked-out file. Called by {@link ConfiguredBrowserRun} when it freezes a browser stop of an App Router app.
 * @param roots - The package root as the run spells it and, when it differs, its real path; both are tried because the build may name either.
 * @param candidates - The frozen build flavours of the stop file ({@link FrozenLibraryBuild}).
 * @returns For each flavour's built path, the distinct absolute paths `resolve(root, mapSource)`, in the order of `roots`.
 * @example
 * appResolvedPathsOf(['/repo/examples/app'], [{ builtPath: 'packages/lib/build/modern/core.js', mapSource: '../../src/core.ts', builtSha256: '…', mapSha256: '…' }])
 * // => { 'packages/lib/build/modern/core.js': ['/repo/src/core.ts'] }
 */
export function appResolvedPathsOf(
  roots: readonly string[],
  candidates: readonly LibraryBuildCandidate[],
): Record<string, string[]> {
  return Object.fromEntries(
    candidates.map((candidate) => [
      candidate.builtPath,
      [...new Set(roots.map((root) => resolve(root, candidate.mapSource)))],
    ]),
  )
}
