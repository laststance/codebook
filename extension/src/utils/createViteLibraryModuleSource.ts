import {
  HTTP_REDIRECT_STATUS_END,
  HTTP_REDIRECT_STATUS_MIN,
  VITE_ENTRY_PAGE_LIMIT_BYTES,
  VITE_LIBRARY_WALK_CODE_LIMIT_BYTES,
  VITE_MODULE_FETCH_TIMEOUT_MS,
} from '../constants'
import { viteRefusal } from '../viteRefusals'

import { extractModuleScriptSources } from './extractModuleScriptSources'
import { ownedModuleUrl } from './ownedModuleUrl'
import { readCappedBody } from './readCappedBody'
import { fetchServedModule } from './readViteServedModule'
import type { ViteLibraryModuleSource } from './selectViteLibraryCandidate'
import type { ViteLibraryModules } from './viteLibraryModules'

/** Thrown by a library module read when the modules fetched for one generation pass the byte bound; the seal words it as `library-build-unmapped` with cause `bound`. */
export class ViteLibraryFetchBound extends Error {}

/** What {@link createViteLibraryModuleSource} needs. */
export type ViteLibraryModuleSourceRequest = Readonly<{
  /** The origin the ready Vite server reported; everything is fetched from it only. */
  ownedOrigin: string
  /** The configuration's entry path (`/` when absent). */
  entryPath: string
  /** The library folder's real path, handed to the launcher's walk. */
  libraryRealFolder: string
  /** Asks the owned launcher to walk Vite's client graph from the entries ({@link requestViteLibraryModules} through the adapter). */
  requestWalk: (
    entries: string[],
    libraryFolder: string,
  ) => Promise<ViteLibraryModules>
  signal: AbortSignal
}>

/**
 * Fetches the served entry page from the owned origin: no redirect, a body capped at {@link VITE_ENTRY_PAGE_LIMIT_BYTES}.
 * @param url - The entry page's absolute address on the owned origin.
 * @param signal - The run's cancellation.
 * @returns The page's HTML.
 * @throws `VITE_SEAL_FAILED` when the page cannot be read.
 * @example
 * await fetchEntryPage('http://127.0.0.1:4321/', signal) // => '<html>…<script type="module" src="/src/main.tsx"></script>…'
 */
async function fetchEntryPage(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const refuse = (problem: string): never => {
    throw viteRefusal(
      'VITE_SEAL_FAILED',
      `The entry page ${url} cannot be read to list the library's modules: ${problem}. Check the entry path, then start again.`,
    )
  }
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { accept: 'text/html' },
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(VITE_MODULE_FETCH_TIMEOUT_MS),
    ]),
  }).catch((error: unknown) => {
    signal.throwIfAborted()
    return refuse(
      `the server did not answer (${error instanceof Error ? error.name : 'error'})`,
    )
  })
  if (
    response.status >= HTTP_REDIRECT_STATUS_MIN &&
    response.status < HTTP_REDIRECT_STATUS_END
  ) {
    await response.body?.cancel()
    return refuse(`it redirects (status ${response.status})`)
  }
  if (!response.ok) {
    await response.body?.cancel()
    return refuse(`it answered status ${response.status}`)
  }
  const html = await readCappedBody(
    response,
    VITE_ENTRY_PAGE_LIMIT_BYTES,
  ).catch(() => refuse('it is not valid UTF-8'))
  return html ?? refuse(`it exceeds ${VITE_ENTRY_PAGE_LIMIT_BYTES} bytes`)
}

/**
 * Builds the source of one library's served modules for one page generation: the launcher's walk from the entry page's module scripts, and the served text of each listed module, each fetched once.
 *
 * Why it exists: all library stops of one page generation share one walk per library folder (decision D13), and a module is fetched once however many stops read it. Called by {@link ConfiguredBrowserRun} when it seals a library stop, with a fresh source for each page generation.
 * @param request - The owned origin, the entry path, the library's real folder, the walk and the run's signal.
 * @returns The source; its `list` fetches the entry page and walks on first use, its `read` fetches a listed module on first use.
 * @example
 * const source = createViteLibraryModuleSource({ ownedOrigin, entryPath: '/', libraryRealFolder, requestWalk, signal })
 * (await source.list()).modules // => ['/@fs/repo/packages/core/build/modern/a.js']
 */
export function createViteLibraryModuleSource(
  request: ViteLibraryModuleSourceRequest,
): ViteLibraryModuleSource {
  let walk: Promise<ViteLibraryModules> | undefined
  const texts = new Map<string, Promise<string>>()
  let fetchedBytes = 0
  const list = async (): Promise<ViteLibraryModules> => {
    const entryUrl = `${request.ownedOrigin}${request.entryPath}`
    const html = await fetchEntryPage(entryUrl, request.signal)
    return request.requestWalk(
      extractModuleScriptSources(html, entryUrl),
      request.libraryRealFolder,
    )
  }
  const fetchText = async (modulePath: string): Promise<string> => {
    const url = ownedModuleUrl(request.ownedOrigin, modulePath)
    // A path that does not stay on the owned origin is never fetched.
    if (url === undefined)
      throw viteRefusal(
        'VITE_SEAL_FAILED',
        `A library module cannot be read: ${modulePath} is not a path on the owned server. Start again once; if it repeats, tell the learner.`,
      )
    const text = await fetchServedModule(
      { realPath: '', url },
      request.signal,
      (problem) => {
        throw viteRefusal(
          'VITE_SEAL_FAILED',
          `A library module cannot be read: ${problem}. Start again once; if it repeats, tell the learner.`,
        )
      },
    )
    fetchedBytes += Buffer.byteLength(text)
    if (fetchedBytes > VITE_LIBRARY_WALK_CODE_LIMIT_BYTES)
      throw new ViteLibraryFetchBound()
    return text
  }
  return {
    list: () => (walk ??= list()),
    read: (modulePath) => {
      let text = texts.get(modulePath)
      if (!text) {
        const pending = fetchText(modulePath)
        text = pending
        texts.set(modulePath, pending)
        // A transient failure must not refuse every later stop: forget it, except the byte bound, which stays true for the generation.
        pending.catch((error: unknown) => {
          if (
            !(error instanceof ViteLibraryFetchBound) &&
            texts.get(modulePath) === pending
          )
            texts.delete(modulePath)
        })
      }
      return text
    },
  }
}
