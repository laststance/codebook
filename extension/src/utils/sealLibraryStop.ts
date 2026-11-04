import { join } from 'node:path'

import {
  NEXT_SERVER_BUILD_DIRECTORY,
  NEXT_SERVER_VENDOR_CHUNK_PREFIX,
} from '../constants'
import type {
  DevelopmentBundle,
  LibraryStopSealInput,
} from '../developmentServerAdapter'
import {
  libraryBuildChangedFailure,
  libraryNotInBuildRefusal,
} from '../nextRefusals'
import { mapSchema, type BundleSource } from '../repositoryBundle'

import { builtEntryOfMap } from './builtEntryOfMap'
import type {
  NextPagesChunkModules,
  NextPagesDiscoveryCache,
} from './createNextPagesDiscoveryCache'
import { selectEvaluatedModule } from './extractDevelopmentModule'
import { readNextChunkModules } from './readNextChunkModules'
import {
  readEntryChunk,
  readInitialPageChunks,
} from './readPagesDevelopmentBundle'
import { compileOfRoute } from './readPagesServerBundle'
import type { ResolvedNextPackage } from './resolveNextPackage'
import type { NextPagesRoute } from './resolveNextPagesRoute'
import { singleBundleOf } from './singleBundleOf'
import {
  spendNextPagesDiscovery,
  type NextPagesChunkFetcher,
  type NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'
import { wordPagesSealFailure } from './wordPagesSealFailure'

/** The webpack layer a library stop is sealed from: the Pages server compile, or the code the Pages browser loads first. */
export type LibraryStopLayer = 'pages-dir-node' | 'pages-dir-browser'

/** What {@link sealLibraryStop} needs to seal a stop in a workspace library. */
export type LibraryStopSealRequest = {
  /** The Next app the run resolved; the build is read below its package root. */
  nextPackage: ResolvedNextPackage
  /** The frozen build of the stop's library and where its built files live. */
  library: LibraryStopSealInput
  /** The Pages route the entry path resolved to. */
  route: NextPagesRoute['route']
  /** The layer whose module is sealed, which also selects the chunk set searched: `pages-dir-node` reads the route's server compile and the non-vendor chunks it requires; `pages-dir-browser` reads the route's and `_app`'s entry chunks. */
  layer: LibraryStopLayer
  /** Fetches a listed browser chunk from the owned server when no file of it exists (`pages-dir-browser` only). */
  fetchChunk?: NextPagesChunkFetcher
  signal?: AbortSignal
  /** The run's discovery cache, shared by every stop of the run. */
  cache: NextPagesDiscoveryCache
}

/** The chunks one layer's seal searches and the hash of the manifest they were listed by. */
type LibraryChunkSet = {
  files: NextPagesChunkModules[]
  manifestHash: string
}

/**
 * Seals a stop in a workspace library from a verified library build artifact, never through the citable-source readers.
 *
 * Why it exists: a library stop pauses in the library's built file, which Next bundles as the webpack module `(<layer>)/<runtime path>`. The source readers refuse files outside the app and apply the `build`/`dist` exclusion, so this reader finds that module in the layer's chunk set directly (module text plus inline map). Called by the Next adapter's `readBundle` for a stop that carries a frozen library build: a server stop is sealed from the `pages-dir-node` compile, a browser stop from the `pages-dir-browser` entry chunks the page loads first.
 * The module's inline map must carry `sourcesContent` for the built file equal to the file frozen before the start ({@link FrozenLibraryBuild.matchesBuiltText}); the bundle is in built terms (its original is the built JavaScript).
 * @param request - The app, the frozen library build, the route, the layer and the run's cache.
 * @returns The sealed module in built terms, its repository-relative built path and the discovery measures; a `pages-dir-node` seal also names its layer.
 * @throws `NEXT_STOP_NOT_SEALED` (`library-not-in-build`) when not exactly one candidate is in the chunk set, two chunks carry differing copies of it, or the module's inline map keeps no entry for the built file; `RUNTIME_FAILED` (`library-build-changed`) when the module's built text differs from the frozen one; `RUNTIME_FAILED` with the Pages details for any other failure; the run's abort unchanged.
 * @example
 * await sealLibraryStop({ nextPackage, library, route: '/', layer: 'pages-dir-browser', cache })
 * // => { bundle: { scriptUrl: 'webpack-internal:///(pages-dir-browser)/../../packages/lib/build/modern/core.js', … }, libraryBuiltPath: 'packages/lib/build/modern/core.js', discovery: { … } }
 */
export async function sealLibraryStop(
  request: LibraryStopSealRequest,
): Promise<DevelopmentBundle> {
  return wordPagesSealFailure(request.signal, () => sealWithin(request))
}

/**
 * Reads the compile and the non-vendor server chunks it requires, in order; called by {@link chunkSetOf} for the `pages-dir-node` layer.
 * @param step - The discovery step.
 * @param request - The seal request.
 * @returns The compile and its chunks (none for a route the Pages manifest does not list) with the manifest's hash.
 * @example await serverChunkSetOf(step, request) // => { files: [compile], manifestHash: '9f2c…' }
 */
async function serverChunkSetOf(
  step: NextPagesDiscoveryStep,
  request: LibraryStopSealRequest,
): Promise<LibraryChunkSet> {
  const { manifestHash, compilePath } = await compileOfRoute(
    step,
    request.route,
  )
  const compile = compilePath
    ? await readNextChunkModules(step, request.cache, compilePath)
    : undefined
  if (!compile) return { files: [], manifestHash }
  const files = [compile]
  for (const id of compile.requiredChunks) {
    // A vendor chunk holds node_modules code only.
    if (id.startsWith(NEXT_SERVER_VENDOR_CHUNK_PREFIX)) continue
    const chunk = await readNextChunkModules(
      step,
      request.cache,
      `${NEXT_SERVER_BUILD_DIRECTORY}/${id}.js`,
    )
    if (chunk) files.push(chunk)
  }
  return { files, manifestHash }
}

/**
 * Reads the route's and `_app`'s entry chunks, the code the page loads first; called by {@link chunkSetOf} for the `pages-dir-browser` layer.
 * @param step - The discovery step.
 * @param request - The seal request.
 * @returns The entry chunks in manifest order with the build manifest's hash.
 * @throws `Declared chunk … is absent from the selected build` when a listed chunk has no file and the owned server cannot supply it.
 * @example await browserChunkSetOf(step, request) // => { files: [indexChunk, appChunk], manifestHash: '9f2c…' }
 */
async function browserChunkSetOf(
  step: NextPagesDiscoveryStep,
  request: LibraryStopSealRequest,
): Promise<LibraryChunkSet> {
  const { candidates, manifestHash } = await readInitialPageChunks(
    step,
    request.route,
  )
  const files: NextPagesChunkModules[] = []
  for (const candidate of candidates) {
    files.push(
      await readEntryChunk(step, request.cache, candidate, request.fetchChunk),
    )
  }
  return { files, manifestHash }
}

/** Reads the chunk set of the request's layer; called by {@link sealWithin}. @example await chunkSetOf(step, request) */
function chunkSetOf(
  step: NextPagesDiscoveryStep,
  request: LibraryStopSealRequest,
): Promise<LibraryChunkSet> {
  return request.layer === 'pages-dir-browser'
    ? browserChunkSetOf(step, request)
    : serverChunkSetOf(step, request)
}

/**
 * Finds the one module of a built flavour in a chunk set; called by {@link sealWithin} for each frozen flavour.
 * @param files - The chunk set.
 * @param request - The seal request (its layer names the module).
 * @param builtPath - The flavour's repository-relative built path.
 * @param deadline - The discovery step's deadline.
 * @returns The module, or `undefined` when no chunk carries it.
 * @throws `Ambiguous application source chunk` when chunks carry differing copies ({@link singleBundleOf}).
 * @example moduleOfFlavour(files, request, 'packages/lib/build/modern/core.js', step.deadline)
 */
function moduleOfFlavour(
  files: readonly NextPagesChunkModules[],
  request: LibraryStopSealRequest,
  builtPath: string,
  deadline: number,
): BundleSource | undefined {
  const { frozen, packageRootRelative, realRoot } = request.library
  const scriptUrl = `webpack-internal:///(${request.layer})/${frozen.runtimePath(builtPath, packageRootRelative)}`
  const copies = files.flatMap((file) => {
    const bundle = selectEvaluatedModule(
      file.moduleTexts,
      {
        sourcePath: join(realRoot, builtPath),
        source: '',
        chunkPath: file.chunkPath,
        chunkHash: file.chunkHash,
      },
      scriptUrl,
      deadline,
    )
    return bundle ? [bundle] : []
  })
  return singleBundleOf(copies)
}

/**
 * Finds every frozen flavour's module in the chunk set; called by {@link sealWithin}.
 * @param files - The chunk set.
 * @param request - The seal request.
 * @param frozenPaths - The frozen flavours' built paths.
 * @param deadline - The discovery step's deadline.
 * @returns The flavours the chunk set carries, each with its module.
 * @throws `NEXT_STOP_NOT_SEALED` (`library-not-in-build`) naming all frozen flavours when chunks carry differing copies of a module; any other failure unchanged.
 * @example presentFlavours(files, request, ['packages/lib/build/modern/core.js'], step.deadline)
 */
function presentFlavours(
  files: readonly NextPagesChunkModules[],
  request: LibraryStopSealRequest,
  frozenPaths: readonly string[],
  deadline: number,
): { builtPath: string; bundle: BundleSource }[] {
  const present: { builtPath: string; bundle: BundleSource }[] = []
  for (const builtPath of frozenPaths) {
    try {
      const bundle = moduleOfFlavour(files, request, builtPath, deadline)
      if (bundle) present.push({ builtPath, bundle })
    } catch (error) {
      // Differing copies cannot be tied to one module; any other failure keeps its wording.
      if (!isAmbiguousCopies(error)) throw error
      throw notInBuildOf(request, frozenPaths)
    }
  }
  return present
}

/** Builds the `library-not-in-build` refusal of a request's stop. @example throw notInBuildOf(request, ['packages/lib/build/modern/core.js']) */
function notInBuildOf(
  request: LibraryStopSealRequest,
  candidates: readonly string[],
) {
  const { frozen, packageRootRelative } = request.library
  return libraryNotInBuildRefusal(
    packageRootRelative,
    frozen.library.name,
    frozen.stopPath,
    candidates,
  )
}

/** Finds the candidates' modules, requires exactly one and checks its built text against the freeze. */
async function sealWithin(
  request: LibraryStopSealRequest,
): Promise<DevelopmentBundle> {
  const { frozen, packageRootRelative, realRoot } = request.library
  const started = performance.now(),
    bytesBefore = request.cache.readBytes
  const frozenPaths = frozen.candidates.map((candidate) => candidate.builtPath)
  return spendNextPagesDiscovery(
    request.cache,
    request.nextPackage.packageRoot,
    request.signal,
    async (step) => {
      const { files, manifestHash } = await chunkSetOf(step, request)
      const present = presentFlavours(
        files,
        request,
        frozenPaths,
        step.deadline,
      )
      // Exactly one built flavour may be a module of the layer's chunk set.
      if (present.length !== 1) throw notInBuildOf(request, frozenPaths)
      const { builtPath, bundle } = present[0]!
      const map = mapSchema.parse(JSON.parse(bundle.sourceMap))
      const content = builtEntryOfMap(map, bundle.sourcePath, realRoot)
      // No retained entry for the built file is a module the seal cannot read, not a changed build.
      if (content === undefined) throw notInBuildOf(request, [builtPath])
      // A build updated between the freeze and the seal no longer is the frozen file.
      if (!frozen.matchesBuiltText(builtPath, content))
        throw libraryBuildChangedFailure(
          packageRootRelative,
          frozen.library.name,
          frozen.stopPath,
        )
      return {
        bundle: { ...bundle, source: content },
        discovery: {
          readBytes: request.cache.readBytes - bytesBefore,
          durationMs: performance.now() - started,
          candidates: files.map((file) => file.chunkPath),
          manifestHash,
        },
        // Only a server stop names its layer: a browser stop has none.
        ...(request.layer === 'pages-dir-node'
          ? { layer: 'pages-dir-node' as const }
          : {}),
        libraryBuiltPath: builtPath,
      }
    },
  )
}

/** Tells whether {@link singleBundleOf} refused differing copies of one module. @example isAmbiguousCopies(new Error('Ambiguous application source chunk')) // true */
function isAmbiguousCopies(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'Ambiguous application source chunk'
  )
}
