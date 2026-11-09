import { sha256 } from '../runtimeSupport/utils/sha256'
import { staticPageLibrarySealRefusal } from '../staticPageRefusals'
import { STATIC_PAGE_SINGLE_BUNDLE_PROFILE } from '../staticPageSingleBundleProfile'

import type { CdnPackageImport } from './findCdnPackageImports'
import { followPackedRelativeImports } from './followPackedRelativeImports'
import type { SingleServedBundle } from './readSingleServedBundle'
import {
  sealSingleBundleStop,
  type ServedBundlesReader,
  type SingleBundleSealRequest,
} from './sealSingleBundleStop'
import type { PackedLibraryFiles } from './servePackedLibraryFile'

/** What the library seal needs besides the request: which library, which page, where the packed copy lies and what the page imports from the CDN. */
export type StaticPageLibraryStopInput = Readonly<{
  /** The library's package name, named in each refusal as `details.library`. */
  packageName: string
  /** The page's canonical repository-relative folder, named in each refusal as `details.packageRoot`. */
  examplePackageRoot: string
  /** The real path of the packed copy (`<private>/node_modules/<name>`). */
  packedRoot: string
  /** The packed files the redirect serves; the seal reads the very bytes the browser receives. */
  files: PackedLibraryFiles
  /** The CDN files of the library that the entry page names. */
  imports: readonly CdnPackageImport[]
}>

/**
 * Gives the seal a reader of the packed files the page loads in place of its CDN imports.
 * @param library - The library, its packed files and the page's imports.
 * @returns A reader whose served scripts are the packed files with their inline maps, addressed by the CDN URL the page wrote.
 * @example sealSingleBundleStop(request, profile, route, packedBundlesReader(library))
 */
function packedBundlesReader(
  library: StaticPageLibraryStopInput,
): ServedBundlesReader {
  return async () => {
    const bundles: SingleServedBundle[] = []
    // The entry files and the chunks they import by relative specifier inside the packed folder.
    const files = await followPackedRelativeImports(
      library.files,
      library.packageName,
      library.imports,
    )
    for (const entry of files) {
      const served = await library.files.read(entry.path)
      if (served?.text === undefined || served.map === undefined) continue
      bundles.push({
        javascript: served.text,
        bundleHash: sha256(served.text),
        bundleUrl: entry.url,
        map: served.map,
      })
    }
    return bundles
  }
}

/**
 * Seals one declared browser stop in the checked-out library against the packed build the redirect serves, before the browser opens.
 *
 * Why it exists: a static-page run serves the packed build, with its map inlined and its sources named by the checked-out files, in place of the page's CDN import; the stop is sealed from that very text, so the executed bytes can be compared with the sealed ones. The checks run in order, the first failure is the refusal: `library-build-stale` (the checked-out file differs from its packed copy), `library-not-in-build` (no served map names the file), `library-build-unmapped` (the map has no `sourcesContent` for it, or text that differs from the file), then the mapped-line checks. Called by the `static-page` adapter's `readBundle` for a stop in the declared library.
 * @param request - The stop as for a page stop, with `appRoot` the real library folder and `packageRelativePath` the file below it.
 * @param library - The library, its packed files and the CDN files the page names.
 * @returns The sealed bundle with the discovery measurements; its `sourcePath` names the checked-out file.
 * @throws `STATIC_PAGE_SEAL_FAILED` with `details.reason` `library-build-stale`, `library-not-in-build` or `library-build-unmapped`, or the profile's other seal refusals.
 * @example
 * const { bundle } = await sealStaticPageLibraryStop({ appRoot: libraryRoot, packageRootRelative: '.', packageRelativePath: 'src/createStore.ts', source, citationEndLine: 301, ownedOrigin, signal, cache: new SingleBundleCache() }, library)
 */
export function sealStaticPageLibraryStop(
  request: SingleBundleSealRequest,
  library: StaticPageLibraryStopInput,
) {
  const identity = {
    packageRoot: library.examplePackageRoot,
    library: library.packageName,
    file: request.source.path,
  }
  return sealSingleBundleStop(
    request,
    STATIC_PAGE_SINGLE_BUNDLE_PROFILE,
    {
      packedRoot: library.packedRoot,
      buildStale: () =>
        staticPageLibrarySealRefusal({
          ...identity,
          reason: 'library-build-stale',
        }),
      notInBuild: () =>
        staticPageLibrarySealRefusal({
          ...identity,
          reason: 'library-not-in-build',
        }),
      buildUnmapped: (cause) =>
        staticPageLibrarySealRefusal({
          ...identity,
          reason: 'library-build-unmapped',
          cause,
        }),
    },
    packedBundlesReader(library),
  )
}
