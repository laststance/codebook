import { NEXT_PAGES_SOURCE_EXTENSIONS } from '../constants'
import type { BundleSource } from '../repositoryBundle'

import { createBundleVerifier } from './createBundleVerifier'
import type { NextPagesDiscoveryCache } from './createNextPagesDiscoveryCache'
import { selectEvaluatedModule } from './extractDevelopmentModule'
import type { NextRouteFolder } from './findNextRouteFolder'
import { readNextChunkModules } from './readNextChunkModules'
import type { NextPagesRoute } from './resolveNextPagesRoute'
import { spendNextPagesDiscovery } from './spendNextPagesDiscovery'

/** Why a declared Pages line runs only on the server, or `unknown` when that is not established. */
export type NextServerOnlyReason =
  | { kind: 'server-only'; reason: 'document' | 'api-route' | 'server-compile' }
  | { kind: 'unknown' }

/** What {@link readNextServerOnlyReason} needs about one declared stop that the browser run could not seal or map. */
export type NextServerOnlyRequest = {
  /** The opened workspace (the Next project root). */
  workspace: string
  /** The stop's source, workspace-relative, e.g. `src/pages/index.tsx`. */
  path: string
  /** The declared one-based line. */
  line: number
  /** The Pages folder Next reads ({@link findNextPagesSource}). */
  folder: NextRouteFolder<'pages'>
  /** The route's compiled page, e.g. `pages/index.js`; its server compile is `.next/dev/server/<compiledPath>`. */
  compiledPath: NextPagesRoute['compiledPath']
  /** The stop's sealed browser module, when it was sealed; without it no evidence is read. */
  clientBundle?: BundleSource
  signal?: AbortSignal
  /** The run's discovery cache. */
  cache: NextPagesDiscoveryCache
}

/**
 * Decides whether a declared Pages line is server-only, only on established grounds: a `_document` file or an API route by Next's file rule, or a server compile that maps the line while the sealed browser module does not.
 * Called by the Next run for a stop it could not seal or whose line its browser module does not map, so it refuses with the server-only code only when this says so; `unknown` never becomes server-only.
 * @param request - The stop, its Pages folder and route, its sealed browser module, and the run's cache.
 * @returns
 * - `server-only` with `document` for `<folder>/_document.<ext>`, `api-route` for `<folder>/api.<ext>` or a file under `<folder>/api/`
 * - `server-only` with `server-compile` when the `(pages-dir-node)` module of the page's server compile maps the line and the sealed browser module's complete map does not
 * - `unknown` otherwise, also when the server compile is absent, does not carry the module, or carries another original
 * @throws When the server compile cannot be read for another reason than its absence, or the run's discovery budget is spent.
 * @example
 * await readNextServerOnlyReason({ workspace, path: 'src/pages/index.tsx', line: 17, folder: 'src/pages', compiledPath: 'pages/index.js', clientBundle, cache })
 * // => { kind: 'server-only', reason: 'server-compile' } for a getStaticProps body line
 */
export async function readNextServerOnlyReason(
  request: NextServerOnlyRequest,
): Promise<NextServerOnlyReason> {
  const byFile = serverOnlyFileReason(request.path, request.folder)
  if (byFile) return { kind: 'server-only', reason: byFile }
  const { clientBundle } = request
  // Without a sealed browser module, absence from the browser is not established (the module may load lazily).
  if (!clientBundle || lineMappingOf(clientBundle, request.line) !== 'unmapped')
    return { kind: 'unknown' }
  const serverMapsLine = await spendNextPagesDiscovery(
    request.cache,
    request.workspace,
    request.signal,
    async (step) => {
      const chunk = await readNextChunkModules(
        step,
        request.cache,
        `server/${request.compiledPath}`,
      )
      if (!chunk) return false
      try {
        const serverBundle = selectEvaluatedModule(
          chunk.moduleTexts,
          {
            sourcePath: clientBundle.sourcePath,
            source: clientBundle.source,
            chunkPath: chunk.chunkPath,
            chunkHash: chunk.chunkHash,
          },
          `webpack-internal:///(pages-dir-node)/./${request.path}`,
          step.deadline,
        )
        return Boolean(
          serverBundle &&
          lineMappingOf(serverBundle, request.line) === 'mapped',
        )
      } catch {
        // A server module that is ambiguous, stale or names another original establishes nothing; only the run's own limits end the run.
        request.signal?.throwIfAborted()
        if (performance.now() >= step.deadline)
          throw new Error('Build discovery resource limit exceeded')
        return false
      }
    },
  )
  return serverMapsLine
    ? { kind: 'server-only', reason: 'server-compile' }
    : { kind: 'unknown' }
}

/**
 * Applies Next's file rules for Pages files that never run in the browser; called by {@link readNextServerOnlyReason}.
 * @param path - The stop's workspace-relative source.
 * @param folder - The Pages folder.
 * @returns `document` for `<folder>/_document.<ext>`, `api-route` for an API route (`<folder>/api.<ext>` or under `<folder>/api/`), else `undefined`.
 * @example
 * serverOnlyFileReason('src/pages/api/posts.ts', 'src/pages') // => 'api-route'
 * serverOnlyFileReason('src/pages/index.tsx', 'src/pages')    // => undefined
 */
function serverOnlyFileReason(
  path: string,
  folder: NextRouteFolder<'pages'>,
): 'document' | 'api-route' | undefined {
  const pageFiles = (name: string) =>
    NEXT_PAGES_SOURCE_EXTENSIONS.map(
      (extension) => `${folder}/${name}.${extension}`,
    )
  if (pageFiles('_document').includes(path)) return 'document'
  // Next serves `/api` and everything under it as API routes.
  if (pageFiles('api').includes(path) || path.startsWith(`${folder}/api/`))
    return 'api-route'
  return undefined
}

/**
 * Says whether a sealed module's map maps a source line; called by {@link readNextServerOnlyReason} for the browser and the server module.
 * @param bundle - The sealed module.
 * @param line - The one-based source line.
 * @returns `mapped` when the map places code on the line; `unmapped` only when the map was read whole and does not; `unknown` when the scan stopped at a size limit first.
 * @throws When the map's original differs from the module's frozen source ({@link createBundleVerifier}).
 * @example
 * lineMappingOf(bundle, 3) // => 'unmapped'
 */
function lineMappingOf(
  bundle: BundleSource,
  line: number,
): 'mapped' | 'unmapped' | 'unknown' {
  const scan = createBundleVerifier(bundle).mappedPositions(line, line)
  if (scan.positions.length) return 'mapped'
  return scan.complete ? 'unmapped' : 'unknown'
}
