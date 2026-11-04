import { isAbsolute, join, resolve } from 'node:path'

import { z } from 'zod'

import {
  LIBRARY_MAP_SOURCE_DETAIL_LIMIT_CHARS,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'
import type {
  AppBrowserLibrarySealInput,
  DevelopmentBundle,
  LibraryStopSealInput,
} from '../developmentServerAdapter'
import {
  libraryBuildChangedFailure,
  libraryNotInBuildRefusal,
  libraryPlaceAmbiguousRefusal,
} from '../nextRefusals'
import { mapSchema, type BundleSource } from '../repositoryBundle'

import { changedFrozenFileOf } from './changedFrozenFileOf'
import type { NextPagesChunkModules } from './createNextPagesDiscoveryCache'
import { cutTextToFit } from './cutTextToFit'
import { inlineSourceMapOf } from './extractDevelopmentModule'
import { readAppClientChunks } from './readAppClientChunks'
import { readNextChunkModules } from './readNextChunkModules'
import { resolveNextClientManifest } from './resolveNextClientManifest'
import type { ResolvedNextPackage } from './resolveNextPackage'
import { sameScriptUrl } from './sameScriptUrl'
import { AmbiguousBundleError, singleBundleOf } from './singleBundleOf'
import { sourceMapTextMayNamePath } from './sourceMapMayNamePath'
import {
  spendNextPagesDiscovery,
  type NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'
import { wordPagesSealFailure } from './wordPagesSealFailure'

/** What {@link sealAppLibraryStop} needs. */
export type AppLibraryStopSealRequest = {
  /** The nested App Router app the run resolved; the build is read below its package root. */
  nextPackage: ResolvedNextPackage
  /** The frozen build of the stop's library. */
  library: Pick<
    LibraryStopSealInput,
    'frozen' | 'packageRootRelative' | 'realRoot'
  >
  /** What the freeze computed for the source-terms seal. */
  appBrowser: AppBrowserLibrarySealInput
  /** The configured entry path; its route's client reference manifest names the chunk set. */
  entryPath: string
  signal?: AbortSignal
}

const appPathsManifestSchema = z.record(z.string(), z.string())

/**
 * Seals a browser stop in a workspace library of a nested App Router app in source terms: the one module of the route's client chunks whose own map names the checked-out library file.
 *
 * Why it exists: in the App Router layers Next composes each library module's map from the library build map, so the module's map has one source, the library's TypeScript, written at the build map's entry resolved against the app's package root (E1 of Cycle 0080). The stop can therefore be placed like an app stop, once that path is mapped onto the checked-out file in the browser launch ({@link libraryMapOverrides}). Called by the Next adapter's `readBundle` for a browser library request without a Pages route.
 * The module is found by its address `(app-pages-browser)/<runtime path>` in exactly one frozen build flavour (copies in several chunks that are byte-identical are one module); its map must have exactly one source, equal to that flavour's app-resolved path (else `library-not-in-build`), with `sourcesContent` equal to the checked-out text (else `library-build-changed`), and no other module of the chunk set may name the same path (else `library-place-ambiguous`).
 * @param request - The app, the frozen build, the freeze's source-terms facts and the entry path.
 * @returns The bundle in source terms: `sourcePath` and `mapSource` are the checked-out file's real path, `source` its text, the map's one source is re-pointed to it, and `javascript` stays the module text exactly (the executed-bytes hash compares it). It has no `libraryBuiltPath`, so the stop is placed like an app stop.
 * @throws `NEXT_STOP_NOT_SEALED` (`library-not-in-build`, `library-place-ambiguous`) and `RUNTIME_FAILED` (`library-build-changed`), all with `details.router` `app` and `sideEffects` `unknown`; any other failure as `RUNTIME_FAILED` with the Pages details; the run's abort unchanged.
 * @example
 * await sealAppLibraryStop({ nextPackage, library, appBrowser, entryPath: '/' })
 * // => { bundle: { sourcePath: '/repo/packages/lib/src/core.ts', scriptUrl: 'webpack-internal:///(app-pages-browser)/../../../packages/lib/build/modern/core.js', … }, discovery: { … } }
 */
export async function sealAppLibraryStop(
  request: AppLibraryStopSealRequest,
): Promise<DevelopmentBundle> {
  // An uncoded failure of this seal is an App Router one.
  return wordPagesSealFailure(request.signal, () => sealWithin(request), 'app')
}

/** Builds the `library-not-in-build` refusal of a request's stop. @example throw notInBuildOf(request, ['packages/lib/build/modern/core.js']) */
function notInBuildOf(
  request: AppLibraryStopSealRequest,
  candidates: readonly string[],
  mapSource?: string,
) {
  const { frozen, packageRootRelative } = request.library
  return libraryNotInBuildRefusal(
    packageRootRelative,
    frozen.library.name,
    frozen.stopPath,
    candidates,
    'app-pages-browser',
    // The map's source is served text, so the detail is bounded.
    mapSource === undefined
      ? undefined
      : cutTextToFit(
          mapSource,
          (candidate) =>
            candidate.length <= LIBRARY_MAP_SOURCE_DETAIL_LIMIT_CHARS,
        ),
  )
}

/**
 * Finds the copies of one module in a chunk's decoded modules by their final `sourceURL`; called by {@link sealWithin} for each frozen flavour.
 * @param indexed - A decoded client chunk with the final `sourceURL` of each module text, read once by {@link indexedChunksOf}.
 * @param scriptUrl - The module's `(app-pages-browser)` address.
 * @param builtFile - The flavour's absolute built file, kept as the bundle's identity.
 * @param deadline - The discovery step's deadline.
 * @returns A bundle (built terms, the module's own map) for each module text of the chunk with that address.
 * @throws `Module discovery deadline exceeded`, an oversized module, or a module without exactly one inline map.
 * @example moduleCopiesIn(chunk, 'webpack-internal:///(app-pages-browser)/../../../packages/lib/build/modern/core.js', '/repo/packages/lib/build/modern/core.js', deadline)
 */
function moduleCopiesIn(
  indexed: IndexedChunk,
  scriptUrl: string,
  builtFile: string,
  deadline: number,
): BundleSource[] {
  const { file, finalUrls } = indexed
  const copies: BundleSource[] = []
  for (const [position, javascript] of file.moduleTexts.entries()) {
    if (performance.now() >= deadline)
      throw new Error('Module discovery deadline exceeded')
    const finalUrl = finalUrls[position]
    if (finalUrl === undefined || !sameScriptUrl(scriptUrl, finalUrl)) continue
    if (Buffer.byteLength(javascript) > REPOSITORY_JAVASCRIPT_LIMIT_BYTES)
      throw new Error('Selected JavaScript module exceeds byte limit')
    copies.push({
      sourcePath: builtFile,
      mapSource: builtFile,
      scriptUrl,
      source: '',
      javascript,
      sourceMap: inlineSourceMapOf(javascript),
      chunkPath: file.chunkPath,
      chunkHash: file.chunkHash,
    })
  }
  return copies
}

/** A decoded client chunk with the final `sourceURL` of each of its module texts, in order. */
type IndexedChunk = {
  file: NextPagesChunkModules
  finalUrls: readonly (string | undefined)[]
}

/**
 * Reads the final `sourceURL` of every module text once, so the flavour search and the ambiguity scan of {@link sealWithin} do not repeat it per flavour.
 * @param files - The decoded client chunks.
 * @param deadline - The discovery step's deadline.
 * @returns The chunks with their modules' final addresses.
 * @throws `Module discovery deadline exceeded`.
 * @example indexedChunksOf(files, step.deadline)[0]!.finalUrls // => ['webpack-internal:///(app-pages-browser)/./a.js']
 */
function indexedChunksOf(
  files: readonly NextPagesChunkModules[],
  deadline: number,
): IndexedChunk[] {
  return files.map((file) => ({
    file,
    finalUrls: file.moduleTexts.map((javascript) => {
      if (performance.now() >= deadline)
        throw new Error('Module discovery deadline exceeded')
      return finalSourceUrlOf(javascript)
    }),
  }))
}

/** Reads the last `//# sourceURL=` of a module text, which is its effective address. @example finalSourceUrlOf('x\n//# sourceURL=webpack-internal:///(app-pages-browser)/./a.js\n') // => 'webpack-internal:///(app-pages-browser)/./a.js' */
function finalSourceUrlOf(javascript: string): string | undefined {
  return [...javascript.matchAll(/^\/\/# sourceURL=(.+)$/gm)].at(-1)?.[1]
}

/**
 * Tells whether a module's own inline map may name one of the given files, for the ambiguity check of {@link sealWithin}; it fails closed.
 * @param javascript - A module text of the chunk set.
 * @param paths - Every path that would bind the stop file: the app-resolved paths of all frozen flavours and the checked-out real path.
 * @returns
 * - `true` when the map's `sources` has one of the paths
 * - `true` when the module has an inline map that cannot be read (over the byte limit, several maps, malformed encoding, not JSON), since it may name the file
 * - `false` for a module without any inline map and for a readable map that names none of the paths
 * @example mapMayNameAny(moduleText, ['/repo/examples/src/core.ts']) // => false for react-query's own module
 */
function mapMayNameAny(javascript: string, paths: readonly string[]): boolean {
  let mapText: string
  try {
    mapText = inlineSourceMapOf(javascript)
  } catch {
    // A module with no inline map names no file; one whose map cannot be read may name it.
    return javascript.includes('sourceMappingURL=data:application/json')
  }
  // The map is always parsed: a text pre-filter would skip a path written with JSON escapes and a map that is not JSON.
  // Absolute, file://, sourceRoot-joined and indexed-map sources are all normalized there; unreadable shapes fail closed.
  return sourceMapTextMayNamePath(mapText, paths)
}

/**
 * Reads the client chunks of the entry route's client reference manifest; called by {@link sealWithin}.
 * @param step - The discovery step.
 * @param request - The seal request.
 * @returns The decoded chunks and the manifest's hash.
 * @throws `Declared chunk … is absent from the selected build` for a listed chunk without a file; the manifest readers' failures.
 * @example await clientChunksOf(step, request) // => { files: [layoutChunk, pageChunk], manifestHash: '9f2c…' }
 */
async function clientChunksOf(
  step: NextPagesDiscoveryStep,
  request: AppLibraryStopSealRequest,
): Promise<{ files: NextPagesChunkModules[]; manifestHash: string }> {
  const read = (path: string, limit: number) => step.readBuildText(path, limit)
  // Every entry path, `/` included, goes through the App paths manifest, so a top page in a route group is found.
  const routes = appPathsManifestSchema.parse(
    JSON.parse(
      await read(
        '.next/dev/server/app-paths-manifest.json',
        REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
      ),
    ),
  )
  const { candidates, manifestHash } = await readAppClientChunks(
    read,
    resolveNextClientManifest(routes, request.entryPath),
  )
  const files: NextPagesChunkModules[] = []
  for (const chunkPath of candidates) {
    const chunk = await readNextChunkModules(
      step,
      request.appBrowser.cache,
      chunkPath,
    )
    if (!chunk)
      throw new Error(
        `Declared chunk ${chunkPath} is absent from the selected build`,
      )
    files.push(chunk)
  }
  return { files, manifestHash }
}

/**
 * Finds the one frozen flavour the chunk set holds as a module; called by {@link sealWithin}.
 * @param files - The decoded client chunks with their modules' final addresses.
 * @param request - The seal request.
 * @param deadline - The discovery step's deadline.
 * @returns The flavour's built path and its module (identical copies are one).
 * @throws `library-not-in-build` when no flavour, several flavours or differing copies are present.
 * @example oneFlavourOf(files, request, step.deadline) // => { builtPath: 'packages/lib/build/modern/core.js', bundle }
 */
function oneFlavourOf(
  files: readonly IndexedChunk[],
  request: AppLibraryStopSealRequest,
  deadline: number,
): { builtPath: string; bundle: BundleSource } {
  const { frozen, packageRootRelative, realRoot } = request.library
  const frozenPaths = frozen.candidates.map((candidate) => candidate.builtPath)
  const present: { builtPath: string; bundle: BundleSource }[] = []
  for (const builtPath of frozenPaths) {
    const scriptUrl = `webpack-internal:///(app-pages-browser)/${frozen.runtimePath(builtPath, packageRootRelative)}`
    const copies = files.flatMap((file) =>
      moduleCopiesIn(file, scriptUrl, join(realRoot, builtPath), deadline),
    )
    try {
      const bundle = singleBundleOf(copies)
      if (bundle) present.push({ builtPath, bundle })
    } catch (error) {
      // Differing copies cannot be tied to one module.
      if (error instanceof AmbiguousBundleError)
        throw notInBuildOf(request, frozenPaths)
      throw error
    }
  }
  // Exactly one built flavour may be a module of the route's client chunks.
  if (present.length !== 1) throw notInBuildOf(request, frozenPaths)
  return present[0]!
}

/**
 * Checks the found module's own map against the freeze; called by {@link sealWithin}.
 * @param request - The seal request.
 * @param found - The flavour and its module.
 * @returns The parsed map.
 * @throws `library-not-in-build` for a map without exactly one source at the flavour's app-resolved path; `library-build-changed` for `sourcesContent` that is not the checked-out text.
 * @example checkedMapOf(request, found) // => { sources: ['/repo/src/core.ts'], … }
 */
function checkedMapOf(
  request: AppLibraryStopSealRequest,
  found: { builtPath: string; bundle: BundleSource },
): z.infer<typeof mapSchema> {
  const { frozen, packageRootRelative } = request.library
  const parsed = mapSchema.safeParse(JSON.parse(found.bundle.sourceMap))
  const expected = request.appBrowser.appResolvedPaths[found.builtPath] ?? []
  const [mapSource] = parsed.success ? parsed.data.sources : []
  // The one source must be the path Next writes for this flavour.
  if (
    !parsed.success ||
    parsed.data.sources.length !== 1 ||
    mapSource === undefined ||
    !isAbsolute(mapSource) ||
    !expected.includes(resolve(mapSource))
  )
    throw notInBuildOf(request, [found.builtPath], mapSource)
  // A build or file updated between the freeze and the seal no longer is the checked-out text.
  if (parsed.data.sourcesContent[0] !== request.appBrowser.sourceText)
    throw libraryBuildChangedFailure(
      packageRootRelative,
      frozen.library.name,
      frozen.stopPath,
      'app',
    )
  return parsed.data
}

/** Finds the candidate's module, seals it in source terms and checks it against the freeze; the work of {@link sealAppLibraryStop}. */
async function sealWithin(
  request: AppLibraryStopSealRequest,
): Promise<DevelopmentBundle> {
  const { frozen, packageRootRelative } = request.library
  const { appBrowser } = request
  const started = performance.now(),
    bytesBefore = appBrowser.cache.readBytes
  return spendNextPagesDiscovery(
    appBrowser.cache,
    request.nextPackage.packageRoot,
    request.signal,
    async (step) => {
      // The disk check stands in for the Pages seal's built-entry comparison: the dev server compiles after the freeze, so an unchanged frozen build on disk means the chunk came from it.
      const changedFile = await changedFrozenFileOf(
        frozen,
        request.library.realRoot,
        step.deadline,
        step.signal,
      )
      // The refusal names the stop's file like every build-changed refusal; the changed file is the cause only.
      if (changedFile !== undefined)
        throw libraryBuildChangedFailure(
          packageRootRelative,
          frozen.library.name,
          frozen.stopPath,
          'app',
        )
      const { files, manifestHash } = await clientChunksOf(step, request)
      const indexed = indexedChunksOf(files, step.deadline)
      const found = oneFlavourOf(indexed, request, step.deadline)
      const map = checkedMapOf(request, found)
      // Another module naming the same file would bind the breakpoint in a second place.
      const { sourceRealPath, sourceText } = appBrowser
      // Any flavour's app-resolved path and the checked-out file would bind the same breakpoint.
      const competing = [
        ...new Set([
          ...Object.values(appBrowser.appResolvedPaths).flat(),
          sourceRealPath,
        ]),
      ]
      const isNamedElsewhere = indexed.some(({ file, finalUrls }) =>
        file.moduleTexts.some((javascript, position) => {
          if (performance.now() >= step.deadline)
            throw new Error('Module discovery deadline exceeded')
          const finalUrl = finalUrls[position]
          return (
            (finalUrl === undefined ||
              !sameScriptUrl(found.bundle.scriptUrl, finalUrl)) &&
            mapMayNameAny(javascript, competing)
          )
        }),
      )
      if (isNamedElsewhere)
        throw libraryPlaceAmbiguousRefusal(
          packageRootRelative,
          frozen.library.name,
          frozen.stopPath,
          frozen.armedSourceLine,
          'another module of the route client chunks names the same file',
          'app',
        )
      return {
        bundle: {
          ...found.bundle,
          sourcePath: sourceRealPath,
          mapSource: sourceRealPath,
          source: sourceText,
          // The map's one source is re-pointed to the checked-out file.
          sourceMap: JSON.stringify({ ...map, sources: [sourceRealPath] }),
        },
        discovery: {
          readBytes: appBrowser.cache.readBytes - bytesBefore,
          durationMs: performance.now() - started,
          candidates: files.map((file) => file.chunkPath),
          manifestHash,
        },
      }
    },
  )
}
