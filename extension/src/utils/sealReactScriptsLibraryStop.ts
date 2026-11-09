import { reactScriptsLibrarySealRefusal } from '../reactScriptsRefusals'
import { REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE } from '../reactScriptsSingleBundleProfile'

import {
  reactScriptsServedBundlesReader,
  type ReactScriptsSealRequest,
} from './sealReactScriptsStop'
import { sealSingleBundleStop } from './sealSingleBundleStop'

/** What the library seal needs besides the request: which library, which Example and where the packed copy lies. */
export type ReactScriptsLibraryStopInput = Readonly<{
  /** The library's package name (`package.json` `name`), named in each refusal as `details.library`. */
  packageName: string
  /** The Example's canonical repository-relative folder, named in each refusal as `details.packageRoot`. */
  examplePackageRoot: string
  /** The real path of the packed copy (`<private>/node_modules/<name>`); the copy the build compiled. */
  packedRoot: string
}>

/**
 * Seals one declared browser stop in the checked-out library from the single bundle react-scripts serves, before the browser opens.
 *
 * Why it exists: a library-route run compiles the packed copy of the library, and the preload names a packed `src/` module in the served map by the checked-out file only when the bytes are equal (otherwise by its packed path). Called by the react-scripts adapter's `readBundle` for a stop whose file lies in the declared library folder and outside the Example's folder.
 * The checks run in order, the first failure is the refusal: `library-build-stale` (the checked-out file differs from its packed copy, the build input), `library-not-in-build` (no `sources` entry names the checked-out file or its packed copy; a module only a lazy chunk holds counts as not in the build), `library-build-unmapped` (the entry has no `sourcesContent`, or text that differs), then the shared refusals (`unmapped-line`, `map-limit`, `map-unreadable`).
 * @param request - The stop as for an app stop, with `appRoot` the real library folder and `packageRelativePath` the file below it.
 * @param library - The library's name, the Example's folder and the packed copy's real path.
 * @returns The sealed bundle with the discovery measurements; its `sourcePath` names the checked-out file when the map did.
 * @throws `REACT_SCRIPTS_SEAL_FAILED` with `details.reason` `library-build-stale`, `library-not-in-build` or `library-build-unmapped` (`details.cause`), each with `details.library`, `details.file` and `sideEffects: "partial"`; the refusals of {@link sealReactScriptsStop}; `SOURCE_CHANGED` when the file differs from the accepted article.
 * @example
 * const { bundle } = await sealReactScriptsLibraryStop({ appRoot: libraryRoot, packageRootRelative: 'packages/redux', packageRelativePath: 'src/createStore.ts', source, citationEndLine: 301, ownedOrigin, signal, cache }, { packageName: 'redux', examplePackageRoot: 'examples/counter', packedRoot })
 */
export function sealReactScriptsLibraryStop(
  request: ReactScriptsSealRequest,
  library: ReactScriptsLibraryStopInput,
) {
  const identity = {
    packageRoot: library.examplePackageRoot,
    library: library.packageName,
    file: request.source.path,
  }
  return sealSingleBundleStop(
    request,
    REACT_SCRIPTS_SINGLE_BUNDLE_PROFILE,
    {
      packedRoot: library.packedRoot,
      buildStale: () =>
        reactScriptsLibrarySealRefusal({
          ...identity,
          reason: 'library-build-stale',
        }),
      notInBuild: () =>
        reactScriptsLibrarySealRefusal({
          ...identity,
          reason: 'library-not-in-build',
        }),
      buildUnmapped: (cause) =>
        reactScriptsLibrarySealRefusal({
          ...identity,
          reason: 'library-build-unmapped',
          cause,
        }),
    },
    reactScriptsServedBundlesReader(request.cache),
  )
}
