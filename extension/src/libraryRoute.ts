import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import {
  LIBRARY_RUN_FOLDER_PREFIX,
  REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
} from './constants'
import { StudyError } from './errors'
import {
  prepareLibraryCore,
  writeLibraryAnchor,
  type LibraryCleanup,
  type PreparedLibraryCore,
} from './libraryPackage'
import type { LibraryRunView } from './nodeScriptRuntimeTypes'
import {
  assertLibraryRouteSupported,
  libraryBuildPath,
  type LibraryDependencyRelation,
} from './utils/assertLibraryRouteSupported'
import { canonicalJson } from './utils/canonicalJson'
import type { ViteLibraryRunQuestion } from './utils/createViteLibraryRunAsker'
import { isAtOrInsideFolder } from './utils/isAtOrInsideFolder'
import { isInsideFolder } from './utils/isInsideFolder'
import { libraryFactsView } from './utils/libraryFactsView'
import { removeFolderUnlessCleanupPending } from './utils/removeFolderUnlessCleanupPending'
import { removeWithoutFollowing } from './utils/removeWithoutFollowing'

/** The parts of the checked-out library's `package.json` the redirect needs. */
type LibraryManifestParts = {
  peers: string[]
  imports?: Record<string, unknown>
}

/** What {@link LibraryRoute} needs from outside; production passes the editor's confirmation and the Node, tests pass fakes for any of the rest. */
export type LibraryRouteDependencies = {
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

/** What {@link LibraryRoute} is built from. */
export type LibraryRouteInput = {
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
  /** How the Example must depend on the library (API 1.35); `direct` when absent. The react-scripts route passes `direct-or-installed`. */
  dependencyRelation?: LibraryDependencyRelation
  dependencies: LibraryRouteDependencies
}

/** The phases of the route that the run resource states before `running`. */
export type LibraryPhase = 'confirming' | 'building'

/** What {@link LibraryRoute.plan} fixed, before a bundler adds its own launcher fields. */
export type PlannedLibrary = {
  packageName: string
  /** The packed copy's folder below the private folder (`node_modules/<name>`). */
  packedRoot: string
  /** The checked-out library's real folder. */
  libraryRoot: string
  peers: string[]
  imports?: Record<string, unknown>
  privateFolder: string
}

/** Which debugger session announced a script: the owned page (`browser`) or the owned server (`server`). */
export type LibraryParticipant = 'browser' | 'server'

/** One script a debugger announced as parsed. */
export type LibraryScript = {
  url: string
  /** The session that announced the script; absent means `browser`. Script ids repeat across sessions, so an attribution identifies a script by participant and id. */
  participant?: LibraryParticipant
  /** The debugger's id of the script; an attribution that keeps per-script state counts each id once. */
  scriptId?: string
  /** The `Debugger.scriptParsed` content hash; a bundler that matches a compilation report uses it. */
  hash?: string
  /** Tells whether an origin is the run's own application origin. */
  isOwnedOrigin: (origin: string) => boolean
}

/** What a bundler decided about one script. */
export type LibraryScriptVerdict =
  /** The script is a file of the packed copy. */
  | { kind: 'packed'; file: string }
  /** The script is (or was bundled from) a copy of the library other than the packed one. */
  | { kind: 'other-copy'; file: string }
  /** The bundler's evidence cannot be read; the observation becomes `unreadable`, never a claim. */
  | { kind: 'unreadable'; cause: string }
  /** The script says nothing about the library. */
  | { kind: 'ignore' }

/** A bundler's judgement of one script and whether it proves that a page of the run opened. */
export type LibraryScriptAttribution = {
  /** `true` when the script came from the run's own origin, i.e. a page actually opened and was observed. */
  pageObserved: boolean
  verdict: LibraryScriptVerdict
  /** Further verdicts of the same script, for a bundler whose script holds many files (a react-scripts bundle); judged exactly as `verdict` is. */
  additionalVerdicts?: readonly LibraryScriptVerdict[]
}

/** What the core lets an attribution look at. */
export type LibraryAttributionScope = {
  /** The real packed folder once prepared, the planned one before. */
  packedRoot: string
  /** The run's private folder. */
  privateFolder: string
  /** The library's package name. */
  packageName: string
  /** Tells whether a real file belongs to a copy of the library other than the packed one. */
  isOtherCopyFile(realFile: string): boolean
}

/**
 * The per-bundler half of the library route: it maps one parsed script to a verdict.
 *
 * Why it exists: everything else of the route is bundler-neutral ({@link LibraryRoute}); only how a script is traced to a file differs (Vite: served URL and optimizer metadata; react-scripts: the script's hash against a compilation report). Called by {@link LibraryRoute.observeScript} for each script until the observation ends.
 */
export interface LibraryAttribution {
  /**
   * Judges one script.
   * @param script - The announced script.
   * @param scope - What the core knows about the run.
   * @returns The verdict and whether a page was observed.
   */
  attribute(
    script: LibraryScript,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution
}

/**
 * What the run (not the bundler's launcher) needs from a library route, whichever bundler serves the page: {@link ViteLibraryRoute} and the react-scripts route implement it.
 * Why it exists: {@link ConfiguredBrowserRun} calls the same seams for every bundler; only how a parsed script is attributed differs.
 */
export interface LibraryRunRoute {
  /** The phase the route is in before the server listens, or `undefined` once it is past building. */
  currentPhase(): LibraryPhase | undefined
  /** Builds and packs the library (seam 2). */
  prepare(signal: AbortSignal): Promise<void>
  /** Judges one script the page parsed (seam 3). */
  observeParsedScript(script: LibraryScript): void
  /** Finalizes the observation after the page closed (seam 4). */
  finalize(isPageClosed: boolean): void | Promise<void>
  /** Removes the private folder; see {@link LibraryRoute.dispose}. */
  dispose(options?: { serverStopped?: boolean }): Promise<void>
  /** The library facts the run resource states. */
  view(): LibraryRunView
}

/**
 * Reads the `peerDependencies` names and `imports` of a library's `package.json`; the pack copies that file verbatim, so the redirect can know them before the build.
 *
 * Why it exists: the dev server is created once, before the pack, with the final redirect options. Called by {@link LibraryRoute} when it plans the route (unless a test injects `readManifest`).
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
 * Called by {@link LibraryRoute} to recognize another copy of the library (any dependency path, pnpm links followed by the caller's real path).
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
 * The bundler-neutral run side of a library route: it checks and plans the route, asks the learner, builds and packs, records which files the page parsed (packed or another copy) as its {@link LibraryAttribution} judges them, and finalizes the observation and the private folder in order.
 *
 * Why it exists: everything that decides what the run may claim (decision D12) lives in one place, whatever bundler serves the page; only the attribution of a parsed script differs. Created by a bundler's route ({@link ViteLibraryRoute}) for a run that declares `library`; the run calls it at four seams: before the server (`plan`), between the facts and the listen (`prepare`), for each script the page parsed (`observeScript`) and at the end (`finalize`, `dispose`).
 */
export class LibraryRoute {
  private packageName?: string
  private packageManagerName?: string
  private node?: { executable: string; version: string }
  private privateFolder?: string
  private packedRoot?: string
  /** The checked-out library's real folder, where a linked install of the library resolves to. */
  private libraryRoot?: string
  /** The Example's real folder; it may lie inside the library folder (a single-package repository with its examples below the package). */
  private realAppRoot?: string
  /** The peers and `imports` the redirect was set up with before the pack. */
  private plannedManifest?: LibraryManifestParts
  private prepared?: PreparedLibraryCore
  private phase?: LibraryPhase
  private cleanup?: LibraryCleanup['cleanup']
  private observation: LibraryRunView['observation'] = 'pending'
  private finalized = false
  /** Whether the page announced any script of the run's own origin, i.e. a page actually opened and was observed. */
  private pageObserved = false
  private readonly packedFiles = new Set<string>()
  private publishedCopyPath?: string

  constructor(
    private readonly input: LibraryRouteInput,
    private readonly attribution: LibraryAttribution,
  ) {}

  /** The phase the route is in before the server listens, or `undefined` once it is past building. */
  currentPhase(): LibraryPhase | undefined {
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
   * @returns What the bundler's launcher options are made of.
   * @throws `LIBRARY_BUILD_UNSUPPORTED` (nothing started) from the checks; `SCRIPT_NOT_CONFIRMED` when the learner declined, did not answer in time, or the run was stopped (the stop's own error then).
   * @example
   * const planned = await core.plan(signal) // => { packageName: '@acme/widgets', packedRoot: '/tmp/…/node_modules/@acme/widgets', … }
   */
  async plan(
    signal: AbortSignal,
    confirmTimeoutMs: number = REPOSITORY_PAUSE_HOLD_TIMEOUT_MS,
  ): Promise<PlannedLibrary> {
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
      dependencyRelation: input.dependencyRelation,
    })
    this.packageName = supported.name
    this.packageManagerName = supported.packageManager.name
    const manifest = await (
      dependencies.readManifest ?? readLibraryManifestParts
    )(supported.libraryRoot)
    this.libraryRoot = supported.libraryRoot
    // A missing Example folder fails the run elsewhere; the declared path then stands in.
    this.realAppRoot = await realpath(input.appRoot).catch(() => input.appRoot)
    this.plannedManifest = manifest
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
   * @example await core.prepare(signal)
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
        { node, signal, dependencyRelation: this.input.dependencyRelation },
      )
      await this.refuseWhenPackedManifestDiffers(core)
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
   * Refuses when the pack rewrote the peers or `imports` the redirect was set up with.
   *
   * The launcher's redirect was created from the checked-out `package.json` before the pack; a pack that rewrites these fields (for example `publishConfig`) would route peers or `#` imports from stale data while the run reads complete. Peers compare as a set, `imports` canonically (key order does not matter).
   * @param core - The prepared library with the packed manifest's peers and imports.
   * @throws `LIBRARY_BUILD_FAILED` (`pack-error`, step `link`, `sideEffects: "partial"`) through {@link PreparedLibraryCore.failLink}, which removes the private folder.
   */
  private async refuseWhenPackedManifestDiffers(
    core: PreparedLibraryCore,
  ): Promise<void> {
    const planned = this.plannedManifest
    if (!planned) return
    const plannedPeers = new Set(planned.peers)
    const packedPeers = new Set(core.peers)
    const peersDiffer =
      plannedPeers.size !== packedPeers.size ||
      [...packedPeers].some((peer) => !plannedPeers.has(peer))
    // `undefined` and `{}` differ on purpose: either way the redirect was set up from the checked-out value.
    const importsDiffer =
      canonicalJson(planned.imports ?? null) !==
      canonicalJson(core.imports ?? null)
    const changed = peersDiffer
      ? 'peerDependencies'
      : importsDiffer
        ? 'imports'
        : undefined
    if (changed === undefined) return
    await core.failLink(
      `The packed package.json changed ${changed} from the checked-out package.json, but the redirect was set up from the checked-out package.json before the pack, so the run would route ${changed === 'imports' ? 'package imports' : 'peers'} from stale data.`,
      { sideEffects: 'partial' },
    )
  }

  /**
   * Seam 3, observation: asks the attribution to judge one script the page's debugger announced as parsed and records its verdict.
   *
   * A file in the packed folder counts as loaded; a file in any other copy counts as another copy; an unreadable verdict ends the observation as `unreadable`. The core alone holds these facts, so one first-copy rule serves every bundler.
   * @param script - The announced script.
   * @example core.observeScript({ url: 'http://localhost:4321/a.js', isOwnedOrigin })
   */
  observeScript(script: LibraryScript): void {
    const { packedRoot, privateFolder, packageName } = this
    if (
      this.finalized ||
      !packedRoot ||
      !privateFolder ||
      !packageName ||
      this.observation === 'unreadable'
    )
      return
    const { pageObserved, verdict, additionalVerdicts } =
      this.attribution.attribute(script, {
        packedRoot,
        privateFolder,
        packageName,
        isOtherCopyFile: (realFile) => this.isOtherCopyFile(realFile),
      })
    if (pageObserved) this.pageObserved = true
    for (const each of [verdict, ...(additionalVerdicts ?? [])])
      this.applyVerdict(each)
  }

  /** Records one verdict: a packed file counts as loaded, the first other copy is kept, an unreadable verdict ends the observation. */
  private applyVerdict(verdict: LibraryScriptVerdict): void {
    if (verdict.kind === 'packed') this.packedFiles.add(verdict.file)
    // Only the first other copy is kept.
    else if (verdict.kind === 'other-copy')
      this.publishedCopyPath ??= verdict.file
    else if (verdict.kind === 'unreadable') this.markUnreadable(verdict.cause)
  }

  /**
   * Ends the observation as `unreadable` because the bundler's evidence cannot be read; the cause is journaled once and no count is ever claimed; after finalization or a first unreadable verdict the call changes nothing.
   * @param cause - Why the evidence cannot be read.
   * @example core.markUnreadable('compilation report is not valid JSON')
   */
  markUnreadable(cause: string): void {
    // A finalized observation stays as journaled by `library.observed`, and a second unreadable verdict adds no second entry (a retried Stop re-runs finalization).
    if (this.finalized || this.observation === 'unreadable') return
    this.observation = 'unreadable'
    this.input.record('library.observation-unreadable', { cause })
  }

  /**
   * Tells whether a real file belongs to a copy of the library other than the packed one: a `node_modules/<package>` folder, or the checked-out library folder itself (where a workspace or `npm link` install resolves to), outside the Example's own folder.
   * Source-map sources are never parsed scripts, so a library-source stop does not reach here. The library's own `node_modules` (its dependencies) is not a copy of the library.
   */
  private isOtherCopyFile(realFile: string): boolean {
    const name = this.packageName
    if (name && isInPackageCopy(realFile, name)) return true
    const { libraryRoot, realAppRoot } = this
    if (!libraryRoot || !isInsideFolder(libraryRoot, realFile)) return false
    // An Example below the library folder serves its own files from there: they are the app, not a copy of the library.
    if (realAppRoot && isAtOrInsideFolder(realAppRoot, realFile)) return false
    return !relative(libraryRoot, realFile).split(sep).includes('node_modules')
  }

  /**
   * Seam 4, finalization: marks the observation after the page was closed (`complete`) or could not be confirmed closed (`incomplete`), and journals `library.observed`.
   * Called by the run before it stops the server, so a script parsed up to the close is counted and none after.
   * @param isPageClosed - Whether the owned page closed within the close bound.
   * @example core.finalize(true)
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
   * Called by the run after the server stopped, or with `serverStopped: false` when the owned application stop failed: the server may still run on the packed copy and its caches, so the folder stays and the facts read `cleanup: 'pending'` until a retried Stop removes it.
   * @param options.serverStopped - Whether the owned application stop succeeded; defaults to `true`.
   * @returns Resolves when the folder was removed or its removal is pending; never rejects.
   * @example await core.dispose()
   */
  async dispose(options: { serverStopped?: boolean } = {}): Promise<void> {
    if (this.cleanup === 'removed') return
    // A server that may still run keeps its folder; before the folder was allocated there is nothing to keep.
    if (options.serverStopped === false) {
      if (this.privateFolder) this.cleanup = 'pending'
      return
    }
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
      ...(facts ? libraryFactsView(facts) : {}),
      observation: this.observation,
      ...(this.finalized ? this.observedFacts() : {}),
      ...(this.cleanup ? { cleanup: this.cleanup } : {}),
    }
  }
}
