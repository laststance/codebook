import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'

import { z } from 'zod'

import {
  REPOSITORY_DISCOVERY_CANDIDATE_LIMIT,
  REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
  REPOSITORY_SOURCE_LIMIT_BYTES,
} from '../constants'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import { selectEvaluatedModule } from './extractDevelopmentModule'
import { parseNextManifest } from './parseNextManifest'
import type { readDevelopmentBundle } from './readDevelopmentBundle'
import { readNextChunkModules } from './readNextChunkModules'
import { redactNextEntryPath } from './redactNextEntryPath'
import type { NextPagesRoute } from './resolveNextPagesRoute'
import {
  spendNextPagesDiscovery,
  type NextPagesChunkFetcher,
  type NextPagesDiscoveryStep,
} from './spendNextPagesDiscovery'

const BUILD_MANIFEST = '.next/dev/build-manifest.json'
/** Where Next's per-page entry chunks live; `webpack.js` and `main.js` hold no application module. */
const PAGES_CHUNK_PREFIX = 'static/chunks/pages/'

const buildManifestSchema = z.object({
  pages: z.record(z.string(), z.array(z.string())),
})

/** What the discovery of one sealed stop measured, in the shape {@link readDevelopmentBundle} reports it. */
type DevelopmentDiscovery = Awaited<
  ReturnType<typeof readDevelopmentBundle>
>['discovery']

/** What {@link readPagesDevelopmentBundle} needs to seal one declared browser stop of a Pages route. */
export type PagesDevelopmentBundleRequest = {
  /** The opened workspace (the Next project root). */
  workspace: string
  /** The declared stop's source, with the hash the configuration accepted. */
  selected: RepositoryConfiguration['source']
  /** The Pages route the entry path resolved to ({@link resolveNextPagesRoute}), e.g. `/` or `/posts/[id]`. */
  route: NextPagesRoute['route']
  signal?: AbortSignal
  /** The run's discovery cache, shared by every stop of the run. */
  cache: NextPagesDiscoveryCache
  /** Fetches a listed chunk from the owned server when no file of it exists in `.next/dev`. */
  fetchChunk?: NextPagesChunkFetcher
}

/** What {@link readPagesDevelopmentBundle} found for a stop. */
export type PagesDevelopmentBundleResult =
  | { kind: 'sealed'; bundle: BundleSource; discovery: DevelopmentDiscovery }
  | {
      kind: 'not-in-initial-chunks'
      route: NextPagesRoute['route']
      /** The page and `_app` chunks searched, as the build manifest lists them. */
      chunks: string[]
    }

/**
 * Seals one declared browser stop of a Pages route from the chunks the page loads first, before the browser opens, so the debugger can bind it when the page's scripts are parsed.
 * Called by the Next run for each declared stop once {@link readNextRouteManifests} resolved the entry path as a Pages route. It verifies the stop's source against the accepted hash, reads the route's and `_app`'s entry chunks under `static/chunks/pages/` from `.next/dev/build-manifest.json` (never `webpack.js`, `main.js` or a `*.hot-update.js`), and takes the eval module `webpack-internal:///(pages-dir-browser)/./<path>` without executing it. Chunks are read once per run through the cache, within the run's discovery budget.
 * @param request - The workspace, the stop's source, the route, the run's cache and the served-chunk fallback.
 * @returns
 * - `sealed` with the module and what its discovery measured, as {@link readDevelopmentBundle} returns them
 * - `not-in-initial-chunks` when no page or `_app` entry chunk holds the module (a lazily loaded module, or code the browser never runs)
 * @throws When the source differs from the accepted article, the build manifest is unreadable, a listed chunk escapes the build or is absent without a fallback, two chunks hold different modules of the source, or the run's discovery budget is spent.
 * @example
 * await readPagesDevelopmentBundle({ workspace: '/repo', selected, route: '/', cache })
 * // => { kind: 'sealed', bundle: { scriptUrl: 'webpack-internal:///(pages-dir-browser)/./src/pages/index.tsx', … }, discovery: { … } }
 */
export async function readPagesDevelopmentBundle(
  request: PagesDevelopmentBundleRequest,
): Promise<PagesDevelopmentBundleResult> {
  const { cache, selected, route } = request
  const started = performance.now(),
    bytesBefore = cache.readBytes
  return spendNextPagesDiscovery(
    cache,
    request.workspace,
    request.signal,
    async (step) => {
      const sourcePath = join(step.root, selected.path),
        source = await step.readBuildText(
          sourcePath,
          REPOSITORY_SOURCE_LIMIT_BYTES,
        )
      if (sha256(source) !== selected.hash)
        throw new Error('Selected source differs from the accepted article')
      const manifest = await step.readBuildText(
        BUILD_MANIFEST,
        REPOSITORY_JAVASCRIPT_LIMIT_BYTES,
      )
      const candidates = initialPageChunksOf(
        parseNextManifest(BUILD_MANIFEST, manifest, buildManifestSchema).pages,
        route,
      )
      const bundle = await sealFromChunks(step, request, candidates, {
        sourcePath,
        source,
      })
      if (!bundle)
        return { kind: 'not-in-initial-chunks', route, chunks: candidates }
      return {
        kind: 'sealed',
        bundle,
        discovery: {
          readBytes: cache.readBytes - bytesBefore,
          durationMs: performance.now() - started,
          candidates,
          manifestHash: sha256(manifest),
        },
      }
    },
  )
}

/**
 * Lists the entry chunks the page of a route loads first, from the build manifest: the route's and `_app`'s chunks under `static/chunks/pages/`, without hot updates; called by {@link readPagesDevelopmentBundle}.
 * @param pages - The build manifest's `pages`: route keys to the chunks each loads.
 * @param route - The Pages route.
 * @returns The distinct candidates in manifest order, the route's before `_app`'s.
 * @throws When the candidates exceed {@link REPOSITORY_DISCOVERY_CANDIDATE_LIMIT}.
 * @example
 * initialPageChunksOf({ '/': ['static/chunks/webpack.js', 'static/chunks/pages/index.js'], '/_app': ['static/chunks/pages/_app.js'] }, '/')
 * // => ['static/chunks/pages/index.js', 'static/chunks/pages/_app.js']
 */
function initialPageChunksOf(
  pages: Readonly<Record<string, readonly string[]>>,
  route: string,
): string[] {
  const candidates = new Set<string>()
  for (const chunk of [...(pages[route] ?? []), ...(pages['/_app'] ?? [])])
    // Only per-page entry chunks hold application modules; a hot update is never sealed.
    if (
      chunk.startsWith(PAGES_CHUNK_PREFIX) &&
      chunk.endsWith('.js') &&
      !chunk.endsWith('.hot-update.js')
    )
      candidates.add(chunk)
  if (candidates.size > REPOSITORY_DISCOVERY_CANDIDATE_LIMIT)
    throw new Error('Application chunk count exceeds contract')
  return [...candidates]
}

/**
 * Finds the stop's module in the candidate chunks; called by {@link readPagesDevelopmentBundle}.
 * A module that two chunks both carry with identical bytes is one module (the page and `_app` may share an import); different bytes are ambiguous.
 * @param step - The discovery step.
 * @param request - The stop's request (cache, source path, fallback).
 * @param candidates - The entry chunks to search.
 * @param original - The source's absolute path and its verified text.
 * @returns The sealed module of the first chunk that carries it, or `undefined` when none does.
 * @throws `Declared chunk … is absent from the selected build` without a fallback (the name is cleaned by {@link redactNextEntryPath}: no control character, length capped); `Ambiguous application source chunk` for differing copies.
 * @example
 * await sealFromChunks(step, request, ['static/chunks/pages/index.js'], { sourcePath, source }) // => BundleSource
 */
async function sealFromChunks(
  step: NextPagesDiscoveryStep,
  request: PagesDevelopmentBundleRequest,
  candidates: readonly string[],
  original: Pick<BundleSource, 'sourcePath' | 'source'>,
): Promise<BundleSource | undefined> {
  const scriptUrl = `webpack-internal:///(pages-dir-browser)/./${request.selected.path}`
  const bundles: BundleSource[] = []
  for (const candidate of candidates) {
    const chunk = await readNextChunkModules(
      step,
      request.cache,
      candidate,
      request.fetchChunk,
    )
    if (!chunk)
      throw new Error(
        `Declared chunk ${redactNextEntryPath(candidate)} is absent from the selected build`,
      )
    const bundle = selectEvaluatedModule(
      chunk.moduleTexts,
      { ...original, chunkPath: chunk.chunkPath, chunkHash: chunk.chunkHash },
      scriptUrl,
      step.deadline,
    )
    if (bundle) bundles.push(bundle)
    // Yield between bounded chunks so state/stop remain responsive during preparation.
    await setImmediate(undefined, { signal: request.signal })
  }
  const [first] = bundles
  if (
    first &&
    bundles.some(
      (bundle) =>
        bundle.javascript !== first.javascript ||
        bundle.sourceMap !== first.sourceMap,
    )
  )
    throw new Error('Ambiguous application source chunk')
  return first
}
