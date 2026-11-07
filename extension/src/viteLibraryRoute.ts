import { readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import {
  LIBRARY_RUN_FOLDER_PREFIX,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  VITE_LIBRARY_CACHE_FOLDER_NAME,
} from './constants'
import { StudyError } from './errors'
import {
  LIBRARY_ANCHOR_FILE_NAME,
  prepareLibraryCore,
  writeLibraryAnchor,
  type LibraryCleanup,
  type PreparedLibraryCore,
} from './libraryPackage'
import type { LibraryRunView } from './nodeScriptRuntimeTypes'
import {
  assertLibraryRouteSupported,
  libraryBuildPath,
} from './utils/assertLibraryRouteSupported'
import type { ViteLibraryRunQuestion } from './utils/createViteLibraryRunAsker'
import { isInsideFolder } from './utils/isInsideFolder'
import { removeFolderUnlessCleanupPending } from './utils/removeFolderUnlessCleanupPending'
import { removeWithoutFollowing } from './utils/removeWithoutFollowing'
import type { ViteLauncherLibraryOptions } from './viteLauncherProtocol'

/** The folder of the optimizer's output below the run's private Vite cache. */
const OPTIMIZER_DEPS_FOLDER_NAME = 'deps'

/** The optimizer's metadata file inside {@link OPTIMIZER_DEPS_FOLDER_NAME}. */
const OPTIMIZER_METADATA_FILE_NAME = '_metadata.json'

/** One entry of the optimizer metadata: the chunk's file and the source it was bundled from. */
type OptimizerEntry = { chunkPath: string; source: string }

/** The parts of the checked-out library's `package.json` the redirect needs. */
type LibraryManifestParts = {
  peers: string[]
  imports?: Record<string, unknown>
}

/** What {@link ViteLibraryRoute} needs from outside; production passes the editor's confirmation and the Node, tests pass fakes for any of the rest. */
export type ViteLibraryRouteDependencies = {
  /** Asks the learner in the editor to build, pack and run once; `true` only for the learner's yes. */
  confirm(
    question: ViteLibraryRunQuestion,
    signal: AbortSignal,
  ): Promise<boolean>
  /** The external Node the build runs with. */
  resolveNode(): Promise<{ executable: string; version: string }>
  assertSupported?: typeof assertLibraryRouteSupported
  prepareCore?: typeof prepareLibraryCore
  writeAnchor?: typeof writeLibraryAnchor
  /** Makes the run's private folder (a real path outside the repository); the default uses the system's temporary folder. */
  allocatePrivateFolder?(): Promise<string>
  /** Reads the checked-out library's `package.json` parts; the default reads the file. */
  readManifest?(libraryRoot: string): Promise<LibraryManifestParts>
}

/** What {@link ViteLibraryRoute} is built from. */
export type ViteLibraryRouteInput = {
  /** The service's run id, named in the dialog. */
  runId: string
  /** The declared `library.packageRoot`. */
  declared: string
  /** The opened repository's root. */
  workspace: string
  /** The Example's real package folder. */
  appRoot: string
  /** The Example's folder, repository-relative, as the dialog says it. */
  appRootRelative: string
  /** Appends to the run's evidence journal. */
  record: (type: string, detail?: unknown) => unknown
  dependencies: ViteLibraryRouteDependencies
}

/** The phases of the route that the run resource states before `running`. */
export type ViteLibraryPhase = 'confirming' | 'building'

/**
 * Reads the `peerDependencies` names and `imports` of a library's `package.json`; the pack copies that file verbatim, so the redirect can know them before the build.
 *
 * Why it exists: the dev server is created once, before the pack, with the final redirect options. Called by {@link ViteLibraryRoute} when it plans the route (unless a test injects `readManifest`).
 *
 * @param libraryRoot - The library's real checked-out folder.
 * @returns The peer names and, when present, the `imports` map.
 * @example
 * await readLibraryManifestParts('/repo/packages/widgets') // => { peers: ['react'], imports: { '#internal': './src/internal.ts' } }
 */
async function readLibraryManifestParts(
  libraryRoot: string,
): Promise<LibraryManifestParts> {
  const manifest: unknown = JSON.parse(
    await readFile(join(libraryRoot, 'package.json'), 'utf8'),
  )
  const peers = objectFieldOf(manifest, 'peerDependencies')
  const imports = objectFieldOf(manifest, 'imports')
  return { peers: Object.keys(peers ?? {}), ...(imports ? { imports } : {}) }
}

/**
 * Reads one field of a parsed JSON value when it is an object.
 *
 * Why it exists: a manifest field may be absent or of another type, and only an object counts. Called by {@link readLibraryManifestParts}.
 *
 * @param value - A parsed JSON value.
 * @param field - The field name.
 * @returns The field's object; `undefined` when absent or not an object.
 * @example
 * objectFieldOf({ imports: { '#a': './a.js' } }, 'imports') // => { '#a': './a.js' }
 * objectFieldOf({ imports: 'x' }, 'imports') // => undefined
 */
function objectFieldOf(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  const fieldValue: unknown = Reflect.get(Object(value), field)
  return typeof fieldValue === 'object' && fieldValue !== null
    ? Object(fieldValue)
    : undefined
}

/** Makes the run's private folder in the system's temporary folder, outside the repository so no snapshot sees the pack output. */
async function allocateTemporaryFolder(): Promise<string> {
  await mkdir(tmpdir(), { recursive: true })
  return realpath(await mkdtemp(join(tmpdir(), LIBRARY_RUN_FOLDER_PREFIX)))
}

/**
 * Tells whether a real file path lies in a `node_modules/<package>` folder.
 * Called by {@link ViteLibraryRoute} to recognize another copy of the library (any dependency path, pnpm links followed by the caller's real path).
 * @param realFile - A real file path.
 * @param packageName - The library's package name.
 * @returns `true` when the path has `node_modules`, then the package's name segments, before the file.
 * @example isInPackageCopy('/ex/node_modules/@acme/widgets/dist/a.js', '@acme/widgets') // => true
 */
export function isInPackageCopy(
  realFile: string,
  packageName: string,
): boolean {
  const segments = realFile.split(sep)
  const nameSegments = packageName.split('/')
  for (let index = 0; index < segments.length - nameSegments.length; index++)
    if (
      segments[index] === 'node_modules' &&
      nameSegments.every(
        (segment, offset) => segments[index + 1 + offset] === segment,
      )
    )
      return true
  return false
}

/**
 * The run side of the Vite library route: it checks and plans the route, asks the learner, builds and packs, attributes the files the page parsed to the packed or another copy, and finalizes the observation and the private folder in order.
 *
 * Why it exists: the redirect itself lives in the launcher ({@link createLibraryRedirectPlugin}); the run needs one narrow place for everything that decides what the run may claim (decision D12). Created by {@link ConfiguredBrowserRun} for a nested version 3 `vite-dev` run that declares `library`; it calls it at four seams: before the server (`plan`), between the facts and the listen (`prepare`), for each script the page parsed (`observeScript`) and at the end (`finalize`, `dispose`).
 */
export class ViteLibraryRoute {
  private packageName?: string
  private packageManagerName?: string
  private node?: { executable: string; version: string }
  private privateFolder?: string
  private packedRoot?: string
  private prepared?: PreparedLibraryCore
  private phase?: ViteLibraryPhase
  private cleanup?: LibraryCleanup['cleanup']
  private observation: LibraryRunView['observation'] = 'pending'
  private unreadableCause?: string
  private finalized = false
  /** Whether the page announced any script of the run's own origin, i.e. a page actually opened and was observed. */
  private pageObserved = false
  private readonly packedFiles = new Set<string>()
  /** The parsed optimizer metadata, valid while the file's modification time and size stay. */
  private metadataCache?: {
    mtimeMs: number
    size: number
    entries: OptimizerEntry[]
  }
  private publishedCopyPath?: string
  /** The real file of each parsed URL already judged, so repeated announcements cost one look. */
  private readonly judgedUrls = new Map<string, string | undefined>()

  constructor(private readonly input: ViteLibraryRouteInput) {}

  /** The phase the route is in before the server listens, or `undefined` once it is past building. */
  currentPhase(): ViteLibraryPhase | undefined {
    return this.phase
  }

  /** The library's package name once checked, the declared folder before. */
  displayName(): string {
    return this.packageName ?? this.input.declared
  }

  /**
   * Seam 1, before the server: checks the route, asks the learner and fixes the private folder.
   *
   * Peers and `imports` are read from the checked-out library's `package.json`, which the pack copies verbatim; reading them here, before the pack, lets the launcher create its server once with the final redirect options while the packed folder is still empty.
   * @param signal - The run's stop.
   * @param confirmTimeoutMs - How long the learner may take to answer.
   * @returns The launcher's library options.
   * @throws `LIBRARY_BUILD_UNSUPPORTED` (nothing started) from the checks; `SCRIPT_NOT_CONFIRMED` when the learner declined, did not answer in time, or the run was stopped (the stop's own error then).
   * @example
   * const options = await route.plan(signal) // => { packageName: '@acme/widgets', packedRoot: '/tmp/…/node_modules/@acme/widgets', … }
   */
  async plan(
    signal: AbortSignal,
    confirmTimeoutMs: number = REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  ): Promise<ViteLauncherLibraryOptions> {
    const { input } = this
    const { dependencies } = input
    const node = await dependencies.resolveNode()
    this.node = node
    const repositoryRoot = await realpath(input.workspace)
    const supported = await (
      dependencies.assertSupported ?? assertLibraryRouteSupported
    )({
      repositoryRoot,
      examplePackageRoot: input.appRoot,
      declaredPackageRoot: input.declared,
      node,
      pathText: libraryBuildPath(node.executable, process.env.PATH ?? ''),
    })
    this.packageName = supported.name
    this.packageManagerName = supported.packageManager.name
    const manifest = await (
      dependencies.readManifest ?? readLibraryManifestParts
    )(supported.libraryRoot)
    this.phase = 'confirming'
    try {
      await this.askLearner(signal, confirmTimeoutMs)
    } finally {
      // A refusal, a stop or a failing dialog must not leave the run resource reading "confirming".
      this.phase = undefined
    }
    const privateFolder = await (
      dependencies.allocatePrivateFolder ?? allocateTemporaryFolder
    )()
    this.privateFolder = privateFolder
    const packedRoot = join(
      privateFolder,
      'node_modules',
      ...supported.name.split('/'),
    )
    this.packedRoot = packedRoot
    return {
      packageName: supported.name,
      packedRoot,
      anchorFile: join(privateFolder, LIBRARY_ANCHOR_FILE_NAME),
      libraryRoot: supported.libraryRoot,
      peers: manifest.peers,
      ...(manifest.imports ? { imports: manifest.imports } : {}),
      privateFolder,
    }
  }

  /** Asks the learner, waiting at most `timeoutMs`; a decline, a timeout or a stop ends the run before anything is built. */
  private async askLearner(
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    // A run that was stopped already gets no dialog.
    signal.throwIfAborted()
    const waiting = new AbortController()
    const stopWaiting = (): void => waiting.abort()
    signal.addEventListener('abort', stopWaiting, { once: true })
    const timer = setTimeout(stopWaiting, timeoutMs)
    let confirmed = false
    let dialogFailure: unknown
    try {
      confirmed = await this.input.dependencies
        .confirm(
          {
            runId: this.input.runId,
            package: this.displayName(),
            packageRoot: this.input.declared,
            packageManager: this.packageManagerName ?? 'the package manager',
            examplePackageRoot: this.input.appRootRelative,
          },
          waiting.signal,
        )
        .catch((error: unknown) => {
          // A dialog that failed is no decision of the learner: the cause is kept apart from a decline.
          dialogFailure = error
          return false
        })
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', stopWaiting)
      // The dialog cannot be closed; its asker ignores a late answer once this signal aborted.
      waiting.abort()
    }
    // A stop that cut the wait short is the stop's own error, not the learner's refusal.
    signal.throwIfAborted()
    if (!confirmed && dialogFailure !== undefined) {
      const cause =
        dialogFailure instanceof Error
          ? dialogFailure.message
          : String(dialogFailure)
      this.input.record('library.confirmation-failed', { cause })
      throw new StudyError(
        'SCRIPT_NOT_CONFIRMED',
        `The confirmation dialog failed (${cause}), so the learner was not asked and nothing was built or started.`,
        undefined,
        undefined,
        undefined,
        { sideEffects: 'none', confirmation: 'dialog-failed' },
      )
    }
    if (!confirmed)
      throw new StudyError(
        'SCRIPT_NOT_CONFIRMED',
        'The learner did not confirm building and packing the library and running the Example, so nothing was built or started.',
        undefined,
        undefined,
        undefined,
        { sideEffects: 'none', confirmation: 'declined' },
      )
  }

  /**
   * Seam 2, between the facts and the listen: builds and packs the library, unpacks it and writes the anchor file.
   * @param signal - The run's stop; aborting it ends the build.
   * @throws `LIBRARY_BUILD_UNSUPPORTED` or `LIBRARY_BUILD_FAILED` as the shared core raised them; the private folder is removed (or reads pending) first.
   * @example await route.prepare(signal)
   */
  async prepare(signal: AbortSignal): Promise<void> {
    const { privateFolder, node } = this
    if (!privateFolder || !node)
      throw new Error('plan must run before prepare.')
    this.phase = 'building'
    try {
      const core = await (
        this.input.dependencies.prepareCore ?? prepareLibraryCore
      )(
        this.input.declared,
        {
          repositoryRoot: await realpath(this.input.workspace),
          examplePackageRoot: this.input.appRoot,
          privateFolder,
        },
        { node, signal },
      )
      await (this.input.dependencies.writeAnchor ?? writeLibraryAnchor)(core)
      // Set only once the anchor is written: a failed preparation never serves nor observes.
      this.prepared = core
      // The real packed folder, the one real-path script files are compared with.
      this.packedRoot = core.packedRoot
    } catch (error) {
      const reported =
        error instanceof StudyError ? error.details?.cleanup : undefined
      if (reported === 'removed' || reported === 'pending')
        this.cleanup = reported
      await removeFolderUnlessCleanupPending(privateFolder, error)
      throw error
    } finally {
      this.phase = undefined
    }
    const { facts } = this.prepared
    this.input.record('library.prepared', {
      package: facts.package,
      version: facts.version,
      packageRoot: facts.packageRoot,
      revision: facts.revision,
      dirty: facts.dirty,
      packageManager: facts.packageManager.name,
      buildMs: facts.buildMs,
      packMs: facts.packMs,
      tarballSha256: facts.tarballSha256,
      installedVersion: facts.installedVersion,
    })
  }

  /**
   * Seam 3, observation: judges one script URL the page's debugger announced as parsed.
   *
   * A same-origin URL is attributed to a file (`/@fs/<absolute>` to that path, otherwise the app root plus the pathname, query dropped; real path). A file inside the packed folder counts as loaded; a file in any other `node_modules/<package>` folder, or an optimizer chunk whose metadata names such a source, counts as another copy. A module that was only transformed never reaches here.
   * @param url - The script URL from `Debugger.scriptParsed`.
   * @param isOwnedOrigin - Tells whether an origin is the run's own application origin.
   * @example route.observeScript('http://localhost:4321/@fs/tmp/run/node_modules/@acme/widgets/dist/a.js?v=1', isOwned)
   */
  observeScript(url: string, isOwnedOrigin: (origin: string) => boolean): void {
    if (this.finalized || !this.packedRoot || this.observation === 'unreadable')
      return
    const file = this.fileOfUrl(url, isOwnedOrigin)
    if (file === undefined) return
    if (isInsideFolder(this.packedRoot, file)) {
      this.packedFiles.add(file)
      return
    }
    if (this.isOptimizerChunk(file)) {
      this.judgeOptimizerChunk(file)
      return
    }
    this.noteOtherCopy(file)
  }

  /** Records the first other copy's path. */
  private noteOtherCopy(file: string): void {
    const name = this.packageName
    if (name && isInPackageCopy(file, name)) this.publishedCopyPath ??= file
  }

  /** Maps a script URL to the real file it is served from, or `undefined` for a foreign origin or a URL with no file behind it. */
  private fileOfUrl(
    url: string,
    isOwnedOrigin: (origin: string) => boolean,
  ): string | undefined {
    if (this.judgedUrls.has(url)) return this.judgedUrls.get(url)
    let file: string | undefined
    try {
      const parsed = new URL(url)
      if (isOwnedOrigin(parsed.origin)) {
        this.pageObserved = true
        const pathname = decodeURIComponent(parsed.pathname)
        const candidate = pathname.startsWith('/@fs/')
          ? pathname.slice('/@fs'.length)
          : join(this.input.appRoot, pathname)
        // A Windows drive path arrives as `/C:/…`; the leading slash is dropped.
        file = realpathSync(
          /^\/[A-Za-z]:/.test(candidate) ? candidate.slice(1) : candidate,
        )
      }
    } catch {
      // A virtual module (`/@vite/client`), a data URL or a vanished file has no file behind it.
      file = undefined
    }
    this.judgedUrls.set(url, file)
    return file
  }

  /** The private cache's optimizer output folder, once the private folder is known. */
  private depsFolder(): string | undefined {
    return this.privateFolder
      ? join(
          this.privateFolder,
          VITE_LIBRARY_CACHE_FOLDER_NAME,
          OPTIMIZER_DEPS_FOLDER_NAME,
        )
      : undefined
  }

  private isOptimizerChunk(file: string): boolean {
    const deps = this.depsFolder()
    return deps !== undefined && isInsideFolder(deps, file)
  }

  /**
   * Reads the optimizer's metadata to learn whether a chunk is the library's installed copy; metadata that cannot be read or parsed makes the observation `unreadable` (the cause is journaled), never a claim.
   * An entry whose source vanished or whose chunk is another file is skipped: a stale entry says nothing about this chunk.
   */
  private judgeOptimizerChunk(file: string): void {
    const deps = this.depsFolder()
    const name = this.packageName
    if (!deps || !name) return
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
        if (isInPackageCopy(realSource, name))
          this.publishedCopyPath ??= realSource
      }
    } catch (error) {
      this.observation = 'unreadable'
      this.unreadableCause =
        error instanceof Error ? error.message : String(error)
      this.input.record('library.observation-unreadable', {
        cause: this.unreadableCause,
      })
    }
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

  /**
   * Seam 4, finalization: marks the observation after the page was closed (`complete`) or could not be confirmed closed (`incomplete`), and journals `library.observed`.
   * Called by the run before it stops the server, so a script parsed up to the close is counted and none after.
   * @param isPageClosed - Whether the owned page closed within the close bound.
   * @example route.finalize(true)
   */
  finalize(isPageClosed: boolean): void {
    if (this.finalized) return
    this.finalized = true
    // A library that was never built was never served: nothing to observe.
    if (!this.prepared) return
    // A page that never opened (listen failure, a stop before the page) leaves the observation pending: "not loaded" is never claimed from nothing.
    if (this.observation !== 'unreadable' && this.pageObserved)
      this.observation = isPageClosed ? 'complete' : 'incomplete'
    this.input.record('library.observed', {
      observation: this.observation,
      ...this.observedFacts(),
    })
  }

  /** The counted facts, absent while pending or unreadable (they never read as "not loaded"). */
  private observedFacts(): Partial<LibraryRunView> {
    if (this.observation === 'pending' || this.observation === 'unreadable')
      return {}
    return {
      loaded: this.packedFiles.size > 0,
      loadCount: this.packedFiles.size,
      publishedCopyLoaded: this.publishedCopyPath !== undefined,
      ...(this.publishedCopyPath
        ? { publishedCopyPath: this.publishedCopyPath }
        : {}),
    }
  }

  /**
   * Removes the private folder; safe to call again.
   * Called by the run after the server stopped.
   * @returns Resolves when the folder was removed or its removal is pending; never rejects.
   * @example await route.dispose()
   */
  async dispose(): Promise<void> {
    if (this.cleanup === 'removed') return
    try {
      if (this.prepared) this.cleanup = (await this.prepared.dispose()).cleanup
      else if (this.privateFolder) {
        await removeWithoutFollowing(this.privateFolder)
        this.cleanup = 'removed'
      }
    } catch {
      this.cleanup = 'pending'
    }
  }

  /** The library facts the run resource states (the node-script vocabulary, D18 state rules). */
  view(): LibraryRunView {
    const facts = this.prepared?.facts
    return {
      package: facts?.package ?? this.displayName(),
      packageRoot: this.input.declared,
      prepared: facts !== undefined,
      ...(facts
        ? {
            version: facts.version,
            revision: facts.revision,
            dirty: facts.dirty,
            packageManager: facts.packageManager,
            buildMs: facts.buildMs,
            packMs: facts.packMs,
            tarballSha256: facts.tarballSha256,
            installedVersion: facts.installedVersion,
          }
        : {}),
      observation: this.observation,
      ...(this.finalized ? this.observedFacts() : {}),
      ...(this.cleanup ? { cleanup: this.cleanup } : {}),
    }
  }
}
