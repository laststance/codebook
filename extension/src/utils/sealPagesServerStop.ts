import { REPOSITORY_DISCOVERY_TIMEOUT_MS } from '../constants'
import type { DevelopmentBundle } from '../developmentServerAdapter'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'

import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import { DiscoveryBudgetError } from './discoveryBudgetError'
import { lineMappingOf } from './lineMappingOf'
import { pagesServerStopRefusal } from './pagesServerStopRefusal'
import { readPagesDevelopmentBundle } from './readPagesDevelopmentBundle'
import { readPagesServerBundle } from './readPagesServerBundle'
import type { NextPagesRoute } from './resolveNextPagesRoute'
import type { NextPagesChunkFetcher } from './spendNextPagesDiscovery'

/** What {@link sealPagesServerStop} needs to seal one declared `participant: "server"` stop of a Pages run. */
export type PagesServerStopSealRequest = {
  /** The opened workspace (the Next project root). */
  workspace: string
  /** The declared stop's source, with the hash the configuration accepted, and its line. */
  selected: RepositoryConfiguration['source']
  /** The Pages route the entry path resolved to, e.g. `/` or `/posts/[id]`. */
  route: NextPagesRoute['route']
  /** The entry page's own source, workspace-relative ({@link resolveNextPagesEntry}), e.g. `src/pages/index.tsx`. */
  entrySource: string
  signal?: AbortSignal
  /** The run's discovery cache, shared by every stop of the run: the server seal and the page's browser seal spend one budget. */
  cache: NextPagesDiscoveryCache
  /** Fetches a listed browser chunk from the owned server when no file of it exists in `.next/dev`. */
  fetchChunk?: NextPagesChunkFetcher
}

/**
 * Seals one declared server stop of a Pages run and decides, before the browser opens, whether its line is on the entry page's data path.
 *
 * Why it exists: a server stop of a Pages run is armed only in the Next server's debugger, so its module must come from the server build ({@link readPagesServerBundle}), and a line is accepted only where it can belong to a data function or the code that function calls. Called by the Next adapter's `readBundle` for a server stop of a Pages run, after the lexical and version checks of the configured browser run.
 * - A line in a module other than the entry page's own is accepted when the page's server compile, or a server chunk it loads, holds that module; client presence does not matter, because a module shared with client code also runs in the server for the data function.
 * - A line in the entry page's own module is accepted only when the page's client compile does not map it: those are the lines Next strips from the client compile (`getServerSideProps`, `getStaticProps`). The page's browser module is sealed for that evidence within the same discovery budget. A client mapping the scan could not read to its end (`unknown`) is accepted and reported as `client-mapping-unverified`; the run-time verdict of a hit still takes only data-function hits, so such a line ends not reached rather than paused as data.
 * @param request - The workspace, the stop, the route, the entry page's source, the run's cache and the browser chunk fallback.
 * @returns The module sealed from the server build, the layer `pages-dir-node`, what its discovery measured and, for an entry-page line with an unreadable client mapping, `evidence: "client-mapping-unverified"`.
 * @throws {@link pagesServerStopRefusal} errors: `NEXT_STOP_NOT_SEALED` when no server file holds the module, the stop's file is no workspace source, the entry page's browser module cannot be sealed, or the entry page's client compile maps the line (`details.reason` `client-component`); the reader's own failures and the run's budget and abort unchanged.
 * @example
 * await sealPagesServerStop({ workspace, selected: { path: 'src/pages/index.tsx', hash, line: 5, column: 1 }, route: '/', entrySource: 'src/pages/index.tsx', cache })
 * // => { bundle: { scriptUrl: 'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx', … }, discovery: { … }, layer: 'pages-dir-node' }
 */
export async function sealPagesServerStop(
  request: PagesServerStopSealRequest,
): Promise<DevelopmentBundle> {
  const { selected } = request
  const place = `${selected.path}:${selected.line}`
  const server = await readPagesServerBundle(request)
  if (server.kind === 'not-a-workspace-source')
    throw pagesServerStopRefusal({ kind: 'not-workspace-source', place })
  if (server.kind === 'not-in-server-compile')
    throw pagesServerStopRefusal({
      kind: 'server-module-absent',
      place,
      route: server.route,
    })
  const sealed = {
    bundle: server.bundle,
    discovery: server.discovery,
    layer: server.layer,
  }
  if (selected.path !== request.entrySource) return sealed
  const client = await sealEntryBrowserModule(request, place)
  const mapping = lineMappingOf(client, selected.line)
  if (mapping === 'mapped')
    throw pagesServerStopRefusal({ kind: 'client-component', place })
  return mapping === 'unknown'
    ? { ...sealed, evidence: 'client-mapping-unverified' }
    : sealed
}

/**
 * Seals the entry page's browser module for the client mapping of a server stop's line; called by {@link sealPagesServerStop}.
 * @param request - The stop's request.
 * @param place - The declared stop, `<path>:<line>`, named by a refusal.
 * @returns The browser module sealed from the page's entry chunks.
 * @throws `NEXT_STOP_NOT_SEALED` ("does not establish …") when no entry chunk holds the module or the browser seal fails for any reason of the build; an abort and the run's budget unchanged.
 * @example
 * await sealEntryBrowserModule(request, 'src/pages/index.tsx:5') // => BundleSource
 */
async function sealEntryBrowserModule(
  request: PagesServerStopSealRequest,
  place: string,
): Promise<BundleSource> {
  try {
    const sealed = await readPagesDevelopmentBundle({
      workspace: request.workspace,
      selected: request.selected,
      route: request.route,
      signal: request.signal,
      cache: request.cache,
      fetchChunk: request.fetchChunk,
    })
    if (sealed.kind === 'sealed') return sealed.bundle
  } catch (error) {
    // Only the run's own limits end the run; any other failure of the browser seal establishes nothing about the line.
    request.signal?.throwIfAborted()
    if (error instanceof DiscoveryBudgetError) throw error
    if (request.cache.spentMs >= REPOSITORY_DISCOVERY_TIMEOUT_MS)
      throw new DiscoveryBudgetError()
  }
  throw pagesServerStopRefusal({ kind: 'browser-module-absent', place })
}
