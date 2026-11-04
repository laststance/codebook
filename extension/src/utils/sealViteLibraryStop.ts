import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { REPOSITORY_SOURCE_LIMIT_BYTES } from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { viteLibraryRefusal } from '../viteLibraryRefusals'
import { viteRefusal } from '../viteRefusals'

import { ViteLibraryFetchBound } from './createViteLibraryModuleSource'
import type { LibraryPackage } from './libraryBuildStop'
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
  /** The workspace library holding the stop file. */
  library: LibraryPackage
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
    })
  const selection = await selectViteLibraryCandidate({
    source: request.moduleSource,
    stop: {
      realPath,
      text,
      line: source.line,
      citationEndLine: request.citationEndLine,
    },
    ownedOrigin: request.ownedOrigin,
    appRoot: request.appRoot,
  }).catch((error: unknown) => {
    if (error instanceof ViteLibraryFetchBound)
      throw refuse({ reason: 'library-build-unmapped', cause: 'bound' })
    throw error
  })
  if (selection.kind === 'refused') throw refuse(selection.facts)
  const url = `${request.ownedOrigin}${selection.modulePath}`
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
