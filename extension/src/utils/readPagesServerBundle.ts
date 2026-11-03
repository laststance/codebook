import { setImmediate } from 'node:timers/promises'

import { z } from 'zod'

import {
  NEXT_SERVER_BUILD_DIRECTORY,
  NEXT_SERVER_VENDOR_CHUNK_PREFIX,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
} from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type {
  NextPagesChunkModules,
  NextPagesDiscoveryCache,
} from './createNextPagesDiscoveryCache'
import { selectEvaluatedModule } from './extractDevelopmentModule'
import { parseNextManifest } from './parseNextManifest'
import { readAcceptedPagesSource } from './readAcceptedPagesSource'
import type { readDevelopmentBundle } from './readDevelopmentBundle'
import { readNextChunkModules } from './readNextChunkModules'
import {
  isSafeCompiledPagePath,
  type NextPagesRoute,
} from './resolveNextPagesRoute'
import { singleBundleOf } from './singleBundleOf'
import { sourceExclusion } from './sourceExclusion'
import {
  spendNextPagesDiscovery,
  type NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'

const PAGES_MANIFEST = '.next/dev/server/pages-manifest.json'

const pagesManifestSchema = z.record(z.string(), z.string())

/** What the discovery of one sealed stop measured, in the shape {@link readDevelopmentBundle} reports it. */
type DevelopmentDiscovery = Awaited<
  ReturnType<typeof readDevelopmentBundle>
>['discovery']

/** What {@link readPagesServerBundle} needs to seal one declared server stop of a Pages route. */
export type PagesServerBundleRequest = {
  /** The opened workspace (the Next project root). */
  workspace: string
  /** The declared stop's source, with the hash the configuration accepted. */
  selected: RepositoryConfiguration['source']
  /** The Pages route the entry path resolved to ({@link resolveNextPagesRoute}), e.g. `/` or `/posts/[id]`. */
  route: NextPagesRoute['route']
  signal?: AbortSignal
  /** The run's discovery cache, shared by every stop of the run and by the browser seals. */
  cache: NextPagesDiscoveryCache
}

/** What {@link readPagesServerBundle} found for a stop. */
export type PagesServerBundleResult =
  | {
      kind: 'sealed'
      bundle: BundleSource
      /** The webpack layer the module was sealed from: always `pages-dir-node`, the layer Next compiles a Pages page's server code in. */
      layer: 'pages-dir-node'
      discovery: DevelopmentDiscovery
    }
  | {
      kind: 'not-in-server-compile'
      route: NextPagesRoute['route']
      /** The compile and the server chunks searched, as paths in `.next/dev`. */
      chunks: string[]
    }
  | {
      /** The stop's file is not a source a run can cite: a module under `node_modules`, a hidden path, a lockfile, a name Codebook never reads. */
      kind: 'not-a-workspace-source'
    }

/**
 * Seals one declared server stop of a Pages route from the page's server compile and the server chunks it requires, before the browser opens, so the Next server's debugger can bind it when the server parses the module.
 *
 * Why it exists: the App Router reader ({@link readDevelopmentBundle}) reads only `app-paths-manifest.json` and the `rsc` and `action-browser` layers, and a Pages page's server code lives elsewhere: `pages-manifest.json` names the page's compile (`.next/dev/server/pages/index.js`), whose `(pages-dir-node)` modules are the page and the workspace code it imports. Called by {@link sealPagesServerStop} for each server stop of a Pages run.
 * It verifies the stop's source against the accepted hash, resolves the route in `.next/dev/server/pages-manifest.json` to the compile, and takes the eval module `webpack-internal:///(pages-dir-node)/./<path>` from the compile, else from the server chunks the compile's startup call requires (never a `vendor-chunks/` chunk: it holds `node_modules` code, never a tracked workspace source), without executing any of it. Every file is read once per run through the cache, within the run's discovery budget ({@link spendNextPagesDiscovery}). A module the sealed map does not attribute to the exact workspace original is no match, so Next's own code and a `node_modules` module are never sealed.
 * @param request - The workspace, the stop's source, the route and the run's cache.
 * @returns
 * - `sealed` with the module, the layer `pages-dir-node` and what its discovery measured
 * - `not-in-server-compile` when neither the compile nor a chunk it requires holds the module (code loaded later, or code the page's server never runs), or the route has no compile
 * - `not-a-workspace-source` when the stop's file can never be a tracked workspace source (checked before any file is read)
 * @throws When the source differs from the accepted article, the Pages manifest is unreadable, a file escapes the build or changed while it was read, two files carry different modules of the source, or the run's discovery budget is spent.
 * @example
 * await readPagesServerBundle({ workspace: '/repo', selected, route: '/', cache })
 * // => { kind: 'sealed', layer: 'pages-dir-node', bundle: { scriptUrl: 'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx', … }, discovery: { … } }
 */
export async function readPagesServerBundle(
  request: PagesServerBundleRequest,
): Promise<PagesServerBundleResult> {
  const { cache, selected, route } = request
  // A file under node_modules, a hidden path or a name Codebook never reads is no tracked workspace source: nothing is read for it.
  if (sourceExclusion(selected.path) !== undefined)
    return { kind: 'not-a-workspace-source' }
  const started = performance.now(),
    bytesBefore = cache.readBytes
  return spendNextPagesDiscovery(
    cache,
    request.workspace,
    request.signal,
    async (step) => {
      const original = await readAcceptedPagesSource(step, selected)
      const { manifestHash, compilePath } = await compileOfRoute(step, route)
      // A route the Pages manifest does not list has no compile to search.
      const found = compilePath
        ? await searchServerBuild(step, request, compilePath, original)
        : { searched: [] }
      if (!found.bundle)
        return { kind: 'not-in-server-compile', route, chunks: found.searched }
      return {
        kind: 'sealed',
        bundle: found.bundle,
        layer: 'pages-dir-node',
        discovery: {
          readBytes: cache.readBytes - bytesBefore,
          durationMs: performance.now() - started,
          candidates: found.searched,
          manifestHash,
        },
      }
    },
  )
}

/**
 * Resolves a route in the Pages manifest to the path of its server compile; called by {@link readPagesServerBundle}.
 * @param step - The discovery step, which charges the manifest read to the run's budget.
 * @param route - The Pages manifest key, e.g. `/posts/[id]`.
 * @returns The manifest's hash and the compile's path in `.next/dev` (`server/pages/index.js`), absent when the manifest does not list the route or lists an unsafe path.
 * @throws When the manifest is unreadable, not JSON or not a record of strings.
 * @example
 * await compileOfRoute(step, '/') // => { manifestHash: '9f2c…', compilePath: 'server/pages/index.js' }
 */
async function compileOfRoute(
  step: NextPagesDiscoveryStep,
  route: NextPagesRoute['route'],
): Promise<{ manifestHash: string; compilePath?: string }> {
  const manifest = await step.readBuildText(
    PAGES_MANIFEST,
    REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  )
  const compiledPath = parseNextManifest(
    PAGES_MANIFEST,
    manifest,
    pagesManifestSchema,
  )[route]
  return {
    manifestHash: sha256(manifest),
    ...(compiledPath !== undefined && isSafeCompiledPagePath(compiledPath)
      ? { compilePath: `${NEXT_SERVER_BUILD_DIRECTORY}/${compiledPath}` }
      : {}),
  }
}

/**
 * Finds the stop's module in the page's server compile, then in the server chunks the compile requires; called by {@link readPagesServerBundle}.
 * The compile is searched first and the chunks are read only when it does not hold the module, so a stop in the page itself costs no chunk read.
 * @param step - The discovery step.
 * @param request - The stop's request (cache, selected source).
 * @param compilePath - The compile's path in `.next/dev`, e.g. `server/pages/index.js`.
 * @param original - The source's absolute path and its verified text.
 * @returns The sealed module (`undefined` when none of the files carries it) and the path of every file searched, in order.
 * @throws `Ambiguous application source chunk` for differing copies; a read, budget or decoding failure.
 * @example
 * await searchServerBuild(step, request, 'server/pages/index.js', { sourcePath, source })
 * // => { bundle: BundleSource, searched: ['server/pages/index.js'] }
 */
async function searchServerBuild(
  step: NextPagesDiscoveryStep,
  request: PagesServerBundleRequest,
  compilePath: string,
  original: Pick<BundleSource, 'sourcePath' | 'source'>,
): Promise<{ bundle?: BundleSource; searched: string[] }> {
  const scriptUrl = `webpack-internal:///(pages-dir-node)/./${request.selected.path}`
  const searched = [compilePath]
  const compile = await readNextChunkModules(step, request.cache, compilePath)
  if (!compile) return { searched }
  const inCompile = moduleOf(step, compile, original, scriptUrl)
  if (inCompile) return { bundle: inCompile, searched }
  const bundles: BundleSource[] = []
  for (const id of compile.requiredChunks) {
    // A vendor chunk holds node_modules code only; reading the framework-sized chunks would spend the run's budget for nothing.
    if (id.startsWith(NEXT_SERVER_VENDOR_CHUNK_PREFIX)) continue
    const chunkPath = `${NEXT_SERVER_BUILD_DIRECTORY}/${id}.js`
    searched.push(chunkPath)
    // A listed chunk with no file establishes nothing about the module.
    const chunk = await readNextChunkModules(step, request.cache, chunkPath)
    const bundle = chunk && moduleOf(step, chunk, original, scriptUrl)
    if (bundle) bundles.push(bundle)
    // Yield between bounded chunks so state/stop remain responsive during preparation.
    await setImmediate(undefined, { signal: request.signal })
  }
  return { bundle: singleBundleOf(bundles), searched }
}

/**
 * Takes the stop's `(pages-dir-node)` module out of one decoded file; called by {@link searchServerBuild}.
 * @param step - The discovery step, whose deadline bounds the search.
 * @param chunk - The decoded compile or server chunk.
 * @param original - The source's absolute path and its verified text.
 * @param scriptUrl - The address the module must carry.
 * @returns The sealed module, or `undefined` when the file does not carry it.
 * @throws When two modules carry the address, a module's identity or map is malformed, or the deadline passes.
 * @example
 * moduleOf(step, compile, { sourcePath, source }, 'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx') // => BundleSource
 */
function moduleOf(
  step: NextPagesDiscoveryStep,
  chunk: NextPagesChunkModules,
  original: Pick<BundleSource, 'sourcePath' | 'source'>,
  scriptUrl: string,
): BundleSource | undefined {
  return selectEvaluatedModule(
    chunk.moduleTexts,
    { ...original, chunkPath: chunk.chunkPath, chunkHash: chunk.chunkHash },
    scriptUrl,
    step.deadline,
  )
}
