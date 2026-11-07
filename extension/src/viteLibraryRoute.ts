import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { VITE_LIBRARY_CACHE_FOLDER_NAME } from './constants'
import { LIBRARY_ANCHOR_FILE_NAME } from './libraryPackage'
import {
  LibraryRoute,
  isInPackageCopy,
  type LibraryAttribution,
  type LibraryAttributionScope,
  type LibraryPhase,
  type LibraryRouteDependencies,
  type LibraryRouteInput,
  type LibraryScript,
  type LibraryScriptAttribution,
} from './libraryRoute'
import type { LibraryRunView } from './nodeScriptRuntimeTypes'
import { isInsideFolder } from './utils/isInsideFolder'
import type { ViteLauncherLibraryOptions } from './viteLauncherProtocol'

export { isInPackageCopy }

/** The folder of the optimizer's output below the run's private Vite cache. */
const OPTIMIZER_DEPS_FOLDER_NAME = 'deps'

/** The optimizer's metadata file inside {@link OPTIMIZER_DEPS_FOLDER_NAME}. */
const OPTIMIZER_METADATA_FILE_NAME = '_metadata.json'

/** One entry of the optimizer metadata: the chunk's file and the source it was bundled from. */
type OptimizerEntry = { chunkPath: string; source: string }

/** What {@link ViteLibraryRoute} needs from outside; the bundler-neutral shape of {@link LibraryRoute}. */
export type ViteLibraryRouteDependencies = LibraryRouteDependencies

/** What {@link ViteLibraryRoute} is built from. */
export type ViteLibraryRouteInput = LibraryRouteInput

/** The phases of the route that the run resource states before `running`. */
export type ViteLibraryPhase = LibraryPhase

/**
 * The Vite half of the library route: traces a served script URL to its file and reads the dependency optimizer's metadata.
 *
 * Why it exists: Vite serves library files by URL (`/@fs/<path>`) or pre-bundles them into optimizer chunks, so the verdict needs the URL and the chunk's recorded source; the neutral rules live in {@link LibraryRoute}. Created by {@link ViteLibraryRoute}; {@link LibraryRoute.observeScript} calls it for each parsed script.
 */
class ViteAttribution implements LibraryAttribution {
  /** The parsed optimizer metadata, valid while the file's modification time and size stay. */
  private metadataCache?: {
    mtimeMs: number
    size: number
    entries: OptimizerEntry[]
  }
  /** The real file of each parsed URL already judged, so repeated announcements cost one look. */
  private readonly judgedUrls = new Map<string, string | undefined>()

  constructor(private readonly appRoot: string) {}

  /**
   * Judges one script: a file inside the packed folder is packed; an optimizer chunk is judged by its metadata; any other file is another copy when the core says so.
   * @param script - The announced script.
   * @param scope - What the core knows about the run.
   * @returns The verdict and whether the script came from the run's own origin.
   * @example attribution.attribute({ url: 'http://localhost:4321/@fs/tmp/run/node_modules/@acme/widgets/dist/a.js?v=1', isOwnedOrigin }, scope)
   */
  attribute(
    script: LibraryScript,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution {
    const { file, ownedOrigin } = this.fileOfUrl(
      script.url,
      script.isOwnedOrigin,
    )
    const ignore: LibraryScriptAttribution = {
      pageObserved: ownedOrigin,
      verdict: { kind: 'ignore' },
    }
    if (file === undefined) return ignore
    if (isInsideFolder(scope.packedRoot, file))
      return { pageObserved: ownedOrigin, verdict: { kind: 'packed', file } }
    if (this.isOptimizerChunk(scope.privateFolder, file))
      return {
        pageObserved: ownedOrigin,
        verdict: this.judgeOptimizerChunk(file, scope),
      }
    return scope.isOtherCopyFile(file)
      ? { pageObserved: ownedOrigin, verdict: { kind: 'other-copy', file } }
      : ignore
  }

  /** Maps a script URL to the real file it is served from; `file` is `undefined` for a foreign origin or a URL with no file behind it. */
  private fileOfUrl(
    url: string,
    isOwnedOrigin: (origin: string) => boolean,
  ): { file: string | undefined; ownedOrigin: boolean } {
    if (this.judgedUrls.has(url)) {
      const cached = this.judgedUrls.get(url)
      // Only a resolved file of the own origin and a foreign origin are cached.
      return { file: cached, ownedOrigin: cached !== undefined }
    }
    let candidate: string | undefined
    let ownedOrigin = false
    try {
      const parsed = new URL(url)
      if (isOwnedOrigin(parsed.origin)) {
        ownedOrigin = true
        const pathname = decodeURIComponent(parsed.pathname)
        const filePath = pathname.startsWith('/@fs/')
          ? pathname.slice('/@fs'.length)
          : join(this.appRoot, pathname)
        // A Windows drive path arrives as `/C:/…`; the leading slash is dropped.
        candidate = /^\/[A-Za-z]:/.test(filePath) ? filePath.slice(1) : filePath
      }
    } catch {
      // A data URL or an unparsable one has no file by construction.
    }
    let file: string | undefined
    if (candidate !== undefined) {
      try {
        file = realpathSync(candidate)
      } catch {
        // A file not there yet (or a virtual module): not cached, so a URL announced again after the file appeared is still judged.
        return { file: undefined, ownedOrigin }
      }
    }
    // Only definite results are cached: a resolved file, or a foreign origin.
    this.judgedUrls.set(url, file)
    return { file, ownedOrigin }
  }

  /** The private cache's optimizer output folder. */
  private depsFolder(privateFolder: string): string {
    return join(
      privateFolder,
      VITE_LIBRARY_CACHE_FOLDER_NAME,
      OPTIMIZER_DEPS_FOLDER_NAME,
    )
  }

  private isOptimizerChunk(privateFolder: string, file: string): boolean {
    return isInsideFolder(this.depsFolder(privateFolder), file)
  }

  /**
   * Reads the optimizer's metadata to learn whether a chunk is the library's installed copy; metadata that cannot be read or parsed gives an `unreadable` verdict (never a claim).
   * An entry whose source vanished or whose chunk is another file is skipped: a stale entry says nothing about this chunk.
   */
  private judgeOptimizerChunk(
    file: string,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution['verdict'] {
    const deps = this.depsFolder(scope.privateFolder)
    try {
      for (const entry of this.optimizerEntries(deps)) {
        // Plain path comparison first: only the matching entry costs a real-path look.
        if (entry.chunkPath !== file) continue
        let realSource: string
        try {
          realSource = realpathSync(entry.source)
        } catch {
          continue
        }
        if (scope.isOtherCopyFile(realSource))
          return { kind: 'other-copy', file: realSource }
      }
    } catch (error) {
      return {
        kind: 'unreadable',
        cause: error instanceof Error ? error.message : String(error),
      }
    }
    return { kind: 'ignore' }
  }

  /**
   * The optimizer metadata's entries, parsed once per file version (modification time and size).
   * @throws When the metadata file cannot be read or parsed.
   */
  private optimizerEntries(deps: string): OptimizerEntry[] {
    const metadataPath = join(deps, OPTIMIZER_METADATA_FILE_NAME)
    const { mtimeMs, size } = statSync(metadataPath)
    const cached = this.metadataCache
    if (cached && cached.mtimeMs === mtimeMs && cached.size === size)
      return cached.entries
    const metadata: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'))
    const optimized = Object(Reflect.get(Object(metadata), 'optimized'))
    const entries: OptimizerEntry[] = []
    for (const entry of Object.values<unknown>(optimized)) {
      const chunkFile = Reflect.get(Object(entry), 'file')
      const source = Reflect.get(Object(entry), 'src')
      if (typeof chunkFile === 'string' && typeof source === 'string')
        // Vite 8 writes `file` and `src` relative to the deps folder (an absolute path stays as it is).
        entries.push({
          chunkPath: resolve(deps, chunkFile),
          source: resolve(deps, source),
        })
    }
    this.metadataCache = { mtimeMs, size, entries }
    return entries
  }
}

/**
 * The run side of the Vite library route: the bundler-neutral {@link LibraryRoute} core plus the Vite attribution of parsed scripts.
 *
 * Why it exists: the redirect itself lives in the launcher ({@link createLibraryRedirectPlugin}); the run needs one narrow place for everything that decides what the run may claim (decision D12). Created by {@link ConfiguredBrowserRun} for a nested version 3 `vite-dev` run that declares `library`; it calls it at four seams: before the server (`plan`), between the facts and the listen (`prepare`), for each script the page parsed (`observeScript`) and at the end (`finalize`, `dispose`).
 */
export class ViteLibraryRoute {
  private readonly core: LibraryRoute

  constructor(input: ViteLibraryRouteInput) {
    this.core = new LibraryRoute(input, new ViteAttribution(input.appRoot))
  }

  /** The phase the route is in before the server listens, or `undefined` once it is past building. */
  currentPhase(): ViteLibraryPhase | undefined {
    return this.core.currentPhase()
  }

  /**
   * Seam 1, before the server: plans the route through the core and adds the launcher's anchor file.
   * @param signal - The run's stop.
   * @param confirmTimeoutMs - How long the learner may take to answer.
   * @returns The launcher's library options.
   * @throws As {@link LibraryRoute.plan}.
   * @example
   * const options = await route.plan(signal) // => { packageName: '@acme/widgets', packedRoot: '/tmp/…/node_modules/@acme/widgets', … }
   */
  async plan(
    signal: AbortSignal,
    confirmTimeoutMs?: number,
  ): Promise<ViteLauncherLibraryOptions> {
    const planned = await this.core.plan(signal, confirmTimeoutMs)
    return {
      packageName: planned.packageName,
      packedRoot: planned.packedRoot,
      anchorFile: join(planned.privateFolder, LIBRARY_ANCHOR_FILE_NAME),
      libraryRoot: planned.libraryRoot,
      peers: planned.peers,
      ...(planned.imports ? { imports: planned.imports } : {}),
      privateFolder: planned.privateFolder,
    }
  }

  /** Seam 2: builds and packs the library; see {@link LibraryRoute.prepare}. @example await route.prepare(signal) */
  prepare(signal: AbortSignal): Promise<void> {
    return this.core.prepare(signal)
  }

  /**
   * Seam 3, observation: judges one script URL the page's debugger announced as parsed.
   * @param url - The script URL from `Debugger.scriptParsed`.
   * @param isOwnedOrigin - Tells whether an origin is the run's own application origin.
   * @example route.observeScript('http://localhost:4321/@fs/tmp/run/node_modules/@acme/widgets/dist/a.js?v=1', isOwned)
   */
  observeScript(url: string, isOwnedOrigin: (origin: string) => boolean): void {
    this.core.observeScript({ url, isOwnedOrigin })
  }

  /** Seam 4: finalizes the observation; see {@link LibraryRoute.finalize}. @example route.finalize(true) */
  finalize(isPageClosed: boolean): void {
    this.core.finalize(isPageClosed)
  }

  /** Removes the private folder; see {@link LibraryRoute.dispose}. @example await route.dispose() */
  dispose(options?: { serverStopped?: boolean }): Promise<void> {
    return this.core.dispose(options)
  }

  /** The library facts the run resource states. */
  view(): LibraryRunView {
    return this.core.view()
  }
}
