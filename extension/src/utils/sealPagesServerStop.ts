import { REPOSITORY_DISCOVERY_TIMEOUT_MS } from '../constants'
import type { DevelopmentBundle } from '../developmentServerAdapter'
import { StudyError } from '../errors'
import { PAGES_STOP_REFUSAL_DETAILS } from '../nextRefusals'
import type { BundleSource } from '../repositoryBundle'
import type { RepositoryConfiguration } from '../repositoryConfigSchemas'

import { createBundleVerifier } from './createBundleVerifier'
import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import { DiscoveryBudgetError } from './discoveryBudgetError'
import { lineMappingOf } from './lineMappingOf'
import { pagesServerStopRefusal } from './pagesServerStopRefusal'
import { readPagesDevelopmentBundle } from './readPagesDevelopmentBundle'
import { readPagesServerBundle } from './readPagesServerBundle'
import { resolveArmedPlace } from './resolveArmedPlace'
import type { ResolvedNextPackage } from './resolveNextPackage'
import type { NextPagesRoute } from './resolveNextPagesRoute'
import type { NextPagesChunkFetcher } from './spendNextPagesDiscovery'
import { thrownMessage } from './thrownMessage'

/** The client mapping of one source line in a sealed module, as {@link lineMappingOf} reads it. */
type ClientLineMapping = ReturnType<typeof lineMappingOf>

/** What {@link sealPagesServerStop} needs to seal one declared `participant: "server"` stop of a Pages run. */
export type PagesServerStopSealRequest = {
  /** The opened repository's root; the Next package root of a root app. */
  workspace: string
  /** The Next app the run resolved; every build read is below its package root and the stop is matched by its package-relative path. Absent for a root app. */
  nextPackage?: ResolvedNextPackage
  /** The declared stop's source (repository-relative path), with the hash the configuration accepted, and its line. */
  selected: RepositoryConfiguration['source']
  /** The last line of the stop's citation: a stop declared on a line with no mapped server position is requested at the first mapped position after it up to this line ({@link resolveArmedPlace}). */
  citationEndLine: number
  /** The Pages route the entry path resolved to, e.g. `/` or `/posts/[id]`. */
  route: NextPagesRoute['route']
  /** The entry page's own source, repository-relative like `selected.path` (the two are compared as written), e.g. `src/pages/index.tsx` or `examples/app/src/pages/index.tsx`. */
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
 * - A line in the entry page's own module is accepted only when the page's client compile maps neither that line nor the line its breakpoint is requested at (for a line with no server position, such as a comment, a blank or a type-only line, the first mapped server position after it within the citation, {@link resolveArmedPlace}): those are the lines Next strips from the client compile (`getServerSideProps`, `getStaticProps`). The page's browser module is sealed for that evidence within the same discovery budget. A client mapping the scan could not read to its end (`unknown`) is accepted and reported as `client-mapping-unverified`; the run-time verdict of a hit still takes only data-function hits, so such a line ends not reached rather than paused as data.
 * - Every other failure of the seal (a source that changed, an ambiguous or changing build file, a server map whose original differs from the accepted source, a spent discovery budget) comes after Codebook's readiness request ran the page's data function, so it is thrown as a `RUNTIME_FAILED` {@link StudyError} with its message and {@link PAGES_STOP_REFUSAL_DETAILS} (`sideEffects: "unknown"`).
 * @param request - The repository, the Next package, the stop, its citation's last line, the route, the entry page's source, the run's cache and the browser chunk fallback.
 * @returns The module sealed from the server build, the layer `pages-dir-node`, what its discovery measured and, for an entry-page line with an unreadable client mapping, `evidence: "client-mapping-unverified"`.
 * @throws {@link pagesServerStopRefusal} errors: `NEXT_STOP_NOT_SEALED` when no server file holds the module, the stop's file is no workspace source, the entry page's browser module cannot be sealed or verified, or the entry page's client compile maps the line or its requested line (`details.reason` `client-component`); `RUNTIME_FAILED` with the Pages details for any other failure; the run's abort unchanged.
 * @example
 * await sealPagesServerStop({ workspace, selected: { path: 'src/pages/index.tsx', hash, line: 5, column: 1 }, citationEndLine: 5, route: '/', entrySource: 'src/pages/index.tsx', cache })
 * // => { bundle: { scriptUrl: 'webpack-internal:///(pages-dir-node)/./src/pages/index.tsx', … }, discovery: { … }, layer: 'pages-dir-node' }
 */
export async function sealPagesServerStop(
  request: PagesServerStopSealRequest,
): Promise<DevelopmentBundle> {
  try {
    return await sealOnDataPath(request)
  } catch (error) {
    // The run's abort and a coded refusal keep what they say; any other failure came after the readiness request ran the data function.
    if (request.signal?.aborted || error instanceof StudyError) throw error
    const message = thrownMessage(error)
    throw new StudyError('RUNTIME_FAILED', message, message, undefined, error, {
      ...PAGES_STOP_REFUSAL_DETAILS,
    })
  }
}

/**
 * Seals the stop's module from the server build and, for a line of the entry page's own module, checks its client mapping; called by {@link sealPagesServerStop}, which words its raw failures.
 * @param request - The stop's request.
 * @returns What {@link sealPagesServerStop} returns.
 * @throws The {@link pagesServerStopRefusal} errors, and the reader's raw failures, budget and abort unchanged.
 * @example
 * await sealOnDataPath(request) // => { bundle, discovery, layer: 'pages-dir-node' }
 */
async function sealOnDataPath(
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
  // Verified here, a stale server map (its original differs from the accepted source) fails this seal and so carries the Pages details.
  const serverMap = createBundleVerifier(server.bundle)
  if (selected.path !== request.entrySource) return sealed
  // A declared line with no server position has its breakpoint requested at the first mapped position after it, so that line's client mapping decides as well.
  const requestedLine = resolveArmedPlace(
    selected,
    serverMap.mappedPositions(selected.line, request.citationEndLine),
  ).line
  const mapping = await entryClientMapping(request, place, [
    selected.line,
    requestedLine,
  ])
  if (mapping === 'mapped')
    throw pagesServerStopRefusal({ kind: 'client-component', place })
  return mapping === 'unknown'
    ? { ...sealed, evidence: 'client-mapping-unverified' }
    : sealed
}

/**
 * Seals the entry page's browser module and reads the client mapping of a server stop's lines in it; called by {@link sealPagesServerStop}.
 * @param request - The stop's request.
 * @param place - The declared stop, `<path>:<line>`, named by a refusal.
 * @param lines - The one-based lines whose client mapping decides: the declared line and the line its breakpoint is requested at (the same line twice when the declared line has a server position).
 * @returns `mapped` when the client compile maps any of the lines; otherwise `unknown` when the scan of any stopped at a size limit first; `unmapped` when the map was read whole for each.
 * @throws `NEXT_STOP_NOT_SEALED` ("does not establish …") when no entry chunk holds the module, the browser seal fails for any reason of the build, or the sealed map cannot be verified against the accepted source (a stale client compile); an abort and the run's budget unchanged.
 * @example
 * await entryClientMapping(request, 'src/pages/index.tsx:5', [5, 5]) // => 'unmapped'
 */
async function entryClientMapping(
  request: PagesServerStopSealRequest,
  place: string,
  lines: readonly number[],
): Promise<ClientLineMapping> {
  try {
    const sealed = await readPagesDevelopmentBundle({
      workspace: request.workspace,
      nextPackage: request.nextPackage,
      selected: request.selected,
      route: request.route,
      signal: request.signal,
      cache: request.cache,
      fetchChunk: request.fetchChunk,
    })
    if (sealed.kind === 'sealed')
      return combinedLineMapping(sealed.bundle, lines)
  } catch (error) {
    // Only the run's own limits end the run; any other failure of the browser seal or of its map establishes nothing about the line.
    request.signal?.throwIfAborted()
    if (error instanceof DiscoveryBudgetError) throw error
    if (request.cache.spentMs >= REPOSITORY_DISCOVERY_TIMEOUT_MS)
      throw new DiscoveryBudgetError()
  }
  throw pagesServerStopRefusal({ kind: 'browser-module-absent', place })
}

/**
 * Reads the client mapping of several lines of one sealed browser module as one answer; called by {@link entryClientMapping}.
 * @param bundle - The entry page's sealed browser module.
 * @param lines - The one-based lines to read.
 * @returns `mapped` when any line is mapped, else `unknown` when any scan stopped at a size limit, else `unmapped`.
 * @throws When the map's original differs from the module's frozen source ({@link lineMappingOf}).
 * @example
 * combinedLineMapping(bundle, [1, 2]) // => 'mapped' when line 2 is the page component's first line
 */
function combinedLineMapping(
  bundle: BundleSource,
  lines: readonly number[],
): ClientLineMapping {
  const mappings = [...new Set(lines)].map((line) =>
    lineMappingOf(bundle, line),
  )
  if (mappings.includes('mapped')) return 'mapped'
  return mappings.includes('unknown') ? 'unknown' : 'unmapped'
}
