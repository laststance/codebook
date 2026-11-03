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
import { compileOfRoute } from './readPagesServerBundle'
import type { ResolvedNextPackage } from './resolveNextPackage'
import type { NextPagesRoute } from './resolveNextPagesRoute'
import { singleBundleOf } from './singleBundleOf'
import {
  spendNextPagesDiscovery,
  type NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'
import { wordPagesSealFailure } from './wordPagesSealFailure'

/** What {@link sealLibraryServerStop} needs to seal a server stop in a workspace library. */
export type LibraryServerStopSealRequest = {
  /** The Next app the run resolved; the build is read below its package root. */
  nextPackage: ResolvedNextPackage
  /** The frozen build of the stop's library and where its built files live. */
  library: LibraryStopSealInput
  /** The Pages route the entry path resolved to. */
  route: NextPagesRoute['route']
  signal?: AbortSignal
  /** The run's discovery cache, shared by every stop of the run. */
  cache: NextPagesDiscoveryCache
}

/**
 * Seals a server stop in a workspace library from a verified library build artifact, never through the citable-source readers.
 *
 * Why it exists: a library stop pauses in the library's built file, which Next bundles as the webpack module `(pages-dir-node)/<runtime path>`. The source readers refuse files outside the app and apply the `build`/`dist` exclusion, so this reader finds that module in the page's server compile directly (module text plus inline map). Called by the Next adapter's `readBundle` for a server stop that carries a frozen library build.
 * The module's inline map must carry `sourcesContent` for the built file equal to the file frozen before the start ({@link FrozenLibraryBuild.matchesBuiltText}); the bundle is in built terms (its original is the built JavaScript).
 * @param request - The app, the frozen library build, the route and the run's cache.
 * @returns The sealed module in built terms, its repository-relative built path and the discovery measures.
 * @throws `NEXT_STOP_NOT_SEALED` (`library-not-in-build`) when not exactly one candidate is in the page's server build or the module's inline map keeps no entry for the built file;`RUNTIME_FAILED` (`library-build-changed`) when the module's built text differs from the frozen one; `RUNTIME_FAILED` with the Pages details for any other failure; the run's abort unchanged.
 * @example
 * await sealLibraryServerStop({ nextPackage, library, route: '/', cache })
 * // => { bundle: { scriptUrl: 'webpack-internal:///(pages-dir-node)/../../packages/lib/build/modern/core.js', … }, builtPath: 'packages/lib/build/modern/core.js', discovery: { … }, layer: 'pages-dir-node' }
 */
export async function sealLibraryServerStop(
  request: LibraryServerStopSealRequest,
): Promise<DevelopmentBundle> {
  return wordPagesSealFailure(request.signal, () => sealWithin(request))
}

/** Reads the compile and the non-vendor server chunks it requires, in order. */
async function serverFilesOf(
  step: NextPagesDiscoveryStep,
  request: LibraryServerStopSealRequest,
  compilePath: string,
): Promise<NextPagesChunkModules[]> {
  const compile = await readNextChunkModules(step, request.cache, compilePath)
  if (!compile) return []
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
  return files
}

/** Finds the candidates' modules, requires exactly one and checks its built text against the freeze. */
async function sealWithin(
  request: LibraryServerStopSealRequest,
): Promise<DevelopmentBundle> {
  const { frozen, packageRootRelative, realRoot } = request.library
  const started = performance.now(),
    bytesBefore = request.cache.readBytes
  return spendNextPagesDiscovery(
    request.cache,
    request.nextPackage.packageRoot,
    request.signal,
    async (step) => {
      const { manifestHash, compilePath } = await compileOfRoute(
        step,
        request.route,
      )
      const files = compilePath
        ? await serverFilesOf(step, request, compilePath)
        : []
      const present: { builtPath: string; bundle: BundleSource }[] = []
      for (const candidate of frozen.candidates) {
        const scriptUrl = `webpack-internal:///(pages-dir-node)/${frozen.runtimePath(candidate.builtPath, packageRootRelative)}`
        const copies = files.flatMap((file) => {
          const bundle = selectEvaluatedModule(
            file.moduleTexts,
            {
              sourcePath: join(realRoot, candidate.builtPath),
              source: '',
              chunkPath: file.chunkPath,
              chunkHash: file.chunkHash,
            },
            scriptUrl,
            step.deadline,
          )
          return bundle ? [bundle] : []
        })
        const bundle = singleBundleOf(copies)
        if (bundle) present.push({ builtPath: candidate.builtPath, bundle })
      }
      // Exactly one built flavour may be a module of the page's server build.
      if (present.length !== 1)
        throw libraryNotInBuildRefusal(
          packageRootRelative,
          frozen.library.name,
          frozen.stopPath,
          frozen.candidates.map((candidate) => candidate.builtPath),
        )
      const { builtPath, bundle } = present[0]!
      const map = mapSchema.parse(JSON.parse(bundle.sourceMap))
      const content = builtEntryOfMap(map, bundle.sourcePath, realRoot)
      // No retained entry for the built file is a module the seal cannot read, not a changed build.
      if (content === undefined)
        throw libraryNotInBuildRefusal(
          packageRootRelative,
          frozen.library.name,
          frozen.stopPath,
          [builtPath],
        )
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
        layer: 'pages-dir-node' as const,
        libraryBuiltPath: builtPath,
      }
    },
  )
}
