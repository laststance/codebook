import type { LibraryPackageFacts } from '../libraryPackage'
import type { LibraryRunView } from '../nodeScriptRuntimeTypes'

/**
 * Picks the build facts the run resource shows from a built library's facts.
 *
 * Why it exists: the node-script run and the bundler library routes state the same facts. Called by {@link OwnedNodeScriptRun} and {@link LibraryRoute.view}.
 * @param facts - The facts the shared build core returned.
 * @returns The view fields for a prepared library; `reachedThrough` and `reachedThroughCount` only for a transitive Example.
 * @example libraryFactsView(facts).version // => '2.14.0'
 */
export function libraryFactsView(
  facts: LibraryPackageFacts,
): Partial<LibraryRunView> {
  return {
    version: facts.version,
    revision: facts.revision,
    dirty: facts.dirty,
    packageManager: facts.packageManager,
    buildMs: facts.buildMs,
    packMs: facts.packMs,
    tarballSha256: facts.tarballSha256,
    installedVersion: facts.installedVersion,
    ...(facts.reachedThrough === undefined
      ? {}
      : {
          reachedThrough: facts.reachedThrough,
          reachedThroughCount: facts.reachedThroughCount,
        }),
  }
}
