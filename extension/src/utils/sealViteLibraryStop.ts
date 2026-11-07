import { realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { WaitTimeoutError } from '../runtimeSupport/utils/waitTimeoutError'
import {
  viteLibraryRefusal,
  type ViteLibraryPackedFacts,
} from '../viteLibraryRefusals'
import { viteRefusal } from '../viteRefusals'

import { ViteLibraryFetchBound } from './createViteLibraryModuleSource'
import type { LibraryPackage } from './libraryBuildStop'
import { ownedModuleUrl } from './ownedModuleUrl'
import { readRepositoryBuildText } from './readRepositoryBuildText'
import { normalizeServedMap } from './readViteServedModule'
import {
  selectViteLibraryCandidate,
  type ViteLibraryModuleSource,
  type ViteLibraryRefusalFacts,
} from './selectViteLibraryCandidate'

/** What {@link sealViteLibraryStop} needs. */
export type ViteLibrarySealRequest = Readonly<{
  /** The nested Vite app's package root (absolute); a root-relative map entry resolves below it. */
  appRoot: string
  /** The app's canonical repository-relative package root, named in a refusal. */
  packageRootRelative: string
  /** The library holding the stop file; for a packed stop `realFolder` is the run's packed copy, `folder` the checked-out one. */
  library: LibraryPackage
  /** Set for a stop in the checked-out library of a run that built and packed it: refusals name the packed build and carry `sideEffects: "partial"`. */
  packed?: ViteLibraryPackedFacts
  /** The opened repository's root. */
  repositoryRoot: string
  /** The declared stop's source (repository-relative path, line and the hash the article accepted). */
  source: RepositoryConfiguration['source']
  /** The last line of the stop's citation. */
  citationEndLine: number
  /** The origin the ready server reported. */
  ownedOrigin: string
  /** The library's modules of this page generation. */
  moduleSource: ViteLibraryModuleSource
  signal: AbortSignal
}>

/** Tells whether a selection was refused because no served map names the stop file at all (`library-build-unmapped`, cause `no-map`). */
function isUnmappedForNoMap(
  selection: Awaited<ReturnType<typeof selectViteLibraryCandidate>>,
): boolean {
  return (
    selection.kind === 'refused' &&
    selection.facts.reason === 'library-build-unmapped' &&
    selection.facts.cause === 'no-map'
  )
}

/**
 * Seals a browser stop in a workspace library from the one served module whose inline map names the stop file, before the browser opens.
 *
 * Why it exists: a nested Vite app imports a workspace library whose built modules Vite serves under `/@fs/`, with the build's map folded in; the existing seal checks (the map names the file once, `sourcesContent` equals the file on disk) apply to that module. Called by the Vite adapter's `readBundle` for a stop the run found in a reachable library.
 * @param request - The app, library, stop, owned origin and the generation's module source.
 * @returns The bundle in the shape {@link readViteServedModule} returns: the served bytes unchanged and their map normalized to absolute originals, with the discovery measurements.
 * @throws `VITE_SEAL_FAILED` with the library reason of the first decision-table row that holds ({@link viteLibraryRefusal}); a plain error when the checked-out file differs from the accepted article.
 * @example
 * const { bundle } = await sealViteLibraryStop({ appRoot, packageRootRelative, library, repositoryRoot, source, citationEndLine, ownedOrigin, moduleSource, signal })
 */
export async function sealViteLibraryStop(request: ViteLibrarySealRequest) {
  const started = performance.now()
  const { source, library } = request
  const text = await readRepositoryBuildText(
    request.repositoryRoot,
    join(request.repositoryRoot, source.path),
    REPOSITORY_SOURCE_LIMIT_BYTES,
    request.signal,
  )
  if (sha256(text) !== source.hash)
    throw new Error('Selected source differs from the accepted article')
  const realPath = await realpath(join(request.repositoryRoot, source.path))
  const refuse = (facts: ViteLibraryRefusalFacts) =>
    viteLibraryRefusal({
      ...facts,
      packageRoot: request.packageRootRelative,
      library: library.name,
      file: source.path,
      ...(request.packed ? { packed: request.packed } : {}),
    })
  const stopFile = {
    realPath,
    text,
    line: source.line,
    citationEndLine: request.citationEndLine,
  }
  const select = (stop: typeof stopFile) =>
    selectViteLibraryCandidate({
      source: request.moduleSource,
      stop,
      ownedOrigin: request.ownedOrigin,
      appRoot: request.appRoot,
    })
  const selection = await select(stopFile)
    .then(async (selected) => {
      // The map rewrite leaves a packed `src/` path where the checked-out text differs, so no map names the checked-out file; the packed copy's file with other text is the stale build.
      if (!request.packed || !isUnmappedForNoMap(selected)) return selected
      const packedFile = join(
        library.realFolder,
        relative(join(request.repositoryRoot, library.folder), realPath),
      )
      const again = await select({ ...stopFile, realPath: packedFile })
      return again.kind === 'refused' &&
        again.facts.reason === 'library-build-stale'
        ? again
        : selected
    })
    .catch((error: unknown) => {
      if (error instanceof ViteLibraryFetchBound)
        throw refuse({ reason: 'library-build-unmapped', cause: 'bound' })
      // The launcher's walk answer did not arrive in time: decision-table row 2, cause deadline. A launcher exit or any other failure stays what it is.
      if (error instanceof WaitTimeoutError)
        throw refuse({ reason: 'library-build-unmapped', cause: 'deadline' })
      throw error
    })
  if (selection.kind === 'refused') throw refuse(selection.facts)
  const url = ownedModuleUrl(request.ownedOrigin, selection.modulePath)
  // The selection only names owned-origin paths; this guards the invariant.
  if (url === undefined)
    throw new Error('Selected library module is not on the owned server')
  const sourceMap = await normalizeServedMap(
    selection.javascript,
    { realPath, url },
    text,
    request.appRoot,
    (reason) => {
      throw viteRefusal(
        'VITE_SEAL_FAILED',
        `Declared stop ${source.path}:${source.line} cannot be sealed: ${reason}.`,
      )
    },
  )
  const bundle: BundleSource = {
    sourcePath: realPath,
    mapSource: realPath,
    scriptUrl: url,
    source: text,
    javascript: selection.javascript,
    sourceMap,
    chunkPath: '',
    chunkHash: sha256(selection.javascript),
  }
  return {
    bundle,
    discovery: {
      readBytes: Buffer.byteLength(selection.javascript),
      durationMs: performance.now() - started,
      candidates: [url],
      manifestHash: sha256(selection.javascript),
    },
  }
}
