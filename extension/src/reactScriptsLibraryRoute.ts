import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  REACT_SCRIPTS_LIBRARY_CACHE_FOLDER_NAME,
  REACT_SCRIPTS_LIBRARY_PRELOAD_FILE_NAME,
  REACT_SCRIPTS_LIBRARY_REPORT_FILE_NAME,
  REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
  REACT_SCRIPTS_LIBRARY_REPORT_SETTLE_MS,
} from './constants'
import type { PreparedLibraryCore } from './libraryPackage'
import {
  LibraryRoute,
  type LibraryAttribution,
  type LibraryAttributionScope,
  type LibraryPhase,
  type LibraryRouteInput,
  type LibraryRunRoute,
  type LibraryScript,
  type LibraryScriptAttribution,
  type LibraryScriptVerdict,
  type PlannedLibrary,
} from './libraryRoute'
import type { LibraryRunView } from './nodeScriptRuntimeTypes'
import { reactScriptsLibraryRedirectNotAppliedRefusal } from './reactScriptsRefusals'
import { isInsideFolder } from './utils/isInsideFolder'
import { buildReactScriptsLibraryPreloadSource } from './utils/reactScriptsLibraryPreload'
import { ReactScriptsReportReader } from './utils/reactScriptsLibraryReport'

/** How often the run looks again at a report whose last line is still being written. */
const REPORT_SETTLE_POLL_MS = 50

/** The text of the private folder's `package.json`: webpack's `ModuleScopePlugin` needs a description file above the anchor (Cycle 0097 E1). */
const ANCHOR_MANIFEST_TEXT = `${JSON.stringify({ name: 'codebook-library-anchor', private: true })}\n`

/** Tells whether a script URL belongs to the run's own origin; a URL that does not parse belongs to nobody. */
function isOwnedScriptUrl(script: LibraryScript): boolean {
  try {
    return script.isOwnedOrigin(new URL(script.url).origin)
  } catch {
    return false
  }
}

/**
 * The react-scripts half of the library route: matches a script the page parsed to an asset of the preload's compilation report by URL path and SHA-256, and judges the files of that asset.
 *
 * Why it exists: react-scripts serves one webpack bundle (and its chunks) whose modules cannot be traced by URL; the preload writes, at each compilation's `emit`, which library-looking files each emitted asset holds, and the SHA-256 of its bytes equals the debugger's `hash` of the script (Cycle 0097 E1 (g)). Created by {@link ReactScriptsLibraryRoute}; {@link LibraryRoute.observeScript} calls it for each parsed script.
 * A script whose line may still be unterminated is deferred and judged again by {@link ReactScriptsAttribution.judgeDeferred} once the run has read the rest of the report.
 */
class ReactScriptsAttribution implements LibraryAttribution {
  /** Reads the report incrementally; the run asks it for the applied marker too. */
  readonly reader = new ReactScriptsReportReader()
  /** The ids of the scripts already judged, so a script announced twice counts once. */
  private readonly judgedScriptIds = new Set<string>()
  /** The scripts that matched nothing while the report ended in a line not yet terminated. */
  private deferred: LibraryScript[] = []
  private isFinal = false

  constructor(private readonly reportPathOf: () => string | undefined) {}

  /** The report file once the private folder is fixed. */
  reportPath(): string | undefined {
    return this.reportPathOf()
  }

  /**
   * Judges one script against the report.
   * @param script - The announced script, with the debugger's `hash`.
   * @param scope - What the core knows about the run.
   * @returns The verdicts of the matched asset's files; `unreadable` for a report that cannot be trusted, a script without `hash` or an owned script that matches no asset; `ignore` for a foreign origin.
   * @example attribution.attribute({ url: 'http://localhost:3000/static/js/bundle.js', hash, isOwnedOrigin }, scope)
   */
  attribute(
    script: LibraryScript,
    scope: LibraryAttributionScope,
  ): LibraryScriptAttribution {
    if (!isOwnedScriptUrl(script))
      return { pageObserved: false, verdict: { kind: 'ignore' } }
    const observed = (
      verdict: LibraryScriptVerdict,
      additionalVerdicts: readonly LibraryScriptVerdict[] = [],
    ): LibraryScriptAttribution => ({
      pageObserved: true,
      verdict,
      additionalVerdicts,
    })
    const { scriptId } = script
    if (scriptId !== undefined && this.judgedScriptIds.has(scriptId))
      return observed({ kind: 'ignore' })
    const reportPath = this.reportPathOf()
    if (reportPath === undefined)
      return observed({ kind: 'unreadable', cause: 'report-missing' })
    this.reader.refresh(reportPath, true)
    const unreadable = this.reader.unreadableCause
    if (unreadable !== undefined)
      return observed({ kind: 'unreadable', cause: unreadable })
    // There is no source-reading fallback: a script the debugger gave no hash for cannot be tied to an asset.
    if (script.hash === undefined)
      return observed({ kind: 'unreadable', cause: 'script-without-hash' })
    const match = this.reader.match(script.url, script.hash)
    if (match.kind === 'matched') {
      if (scriptId !== undefined) this.judgedScriptIds.add(scriptId)
      return this.verdictsOf(match.asset.resources, scope, observed)
    }
    // The line that holds this script (or its public path) may be the one still being written: judge again after the rest was read.
    if (!this.isFinal && this.reader.pendingBytes > 0) {
      this.deferred.push(script)
      return observed({ kind: 'ignore' })
    }
    if (match.kind === 'not-owned') return observed({ kind: 'ignore' })
    return observed({
      kind: 'unreadable',
      cause:
        this.reader.truncatedCompilations > 0
          ? 'truncated-compilation'
          : 'script-matches-no-asset',
    })
  }

  /** Classifies the files of a matched asset: a file of the packed folder is packed, a file of another copy is another copy, anything else says nothing. */
  private verdictsOf(
    resources: readonly string[],
    scope: LibraryAttributionScope,
    observed: (
      verdict: LibraryScriptVerdict,
      additionalVerdicts?: readonly LibraryScriptVerdict[],
    ) => LibraryScriptAttribution,
  ): LibraryScriptAttribution {
    const verdicts: LibraryScriptVerdict[] = []
    for (const file of resources) {
      if (isInsideFolder(scope.packedRoot, file))
        verdicts.push({ kind: 'packed', file })
      else if (scope.isOtherCopyFile(file))
        verdicts.push({ kind: 'other-copy', file })
    }
    return observed(verdicts[0] ?? { kind: 'ignore' }, verdicts.slice(1))
  }

  /**
   * Reads what the preload appended since the last look and waits, within the bound, for an unterminated last line to end.
   * @returns Resolves when the report ends in a complete line or the bound passed.
   * @example await attribution.settle()
   */
  async settle(): Promise<void> {
    const reportPath = this.reportPathOf()
    if (reportPath === undefined) return
    const endsAt = Date.now() + REACT_SCRIPTS_LIBRARY_REPORT_SETTLE_MS
    for (;;) {
      this.reader.refresh(reportPath)
      if (this.reader.pendingBytes === 0 || Date.now() >= endsAt) return
      await new Promise((resolve) => setTimeout(resolve, REPORT_SETTLE_POLL_MS))
    }
  }

  /**
   * Hands out the scripts deferred while the report was incomplete and stops deferring: the caller judges them now against the settled report.
   * @returns The deferred scripts.
   * @example for (const script of attribution.takeDeferred()) core.observeScript(script)
   */
  takeDeferred(): LibraryScript[] {
    this.isFinal = true
    const scripts = this.deferred
    this.deferred = []
    return scripts
  }
}

/**
 * The run side of the react-scripts library route: the bundler-neutral {@link LibraryRoute} core plus the preload files and the report attribution.
 *
 * Why it exists: the redirect itself lives in the generated preload ({@link buildReactScriptsLibraryPreloadSource}); the run needs one narrow place for everything that decides what the run may claim (decision D12). Created by {@link ConfiguredBrowserRun} for a nested version 3 `react-scripts-dev` run that declares `library`; it calls it at these seams: before the server (`plan`), before the start (`prepare`, which also writes the preload), after the first compile (`assertRedirectApplied`), for each script the page parsed (`observeParsedScript`) and at the end (`finalize`, `dispose`).
 *
 * @example
 * const route = new ReactScriptsLibraryRoute(input)
 * await route.plan(signal)
 * await route.prepare(signal)
 * route.preloadPath() // => '/tmp/codebook-library-run-x/preload.cjs'
 */
export class ReactScriptsLibraryRoute implements LibraryRunRoute {
  private readonly core: LibraryRoute
  private readonly attribution: ReactScriptsAttribution
  private privateFolder?: string
  private finalizing?: Promise<void>
  private preload?: string
  /** The packed library a library stop is sealed through, once the preload is written. */
  private packed?: {
    packageName: string
    libraryRoot: string
    packedRoot: string
  }

  /**
   * @param input - The run's facts and seams; the dependency relation is fixed to `direct-or-installed` here (decision D4) and the anchor writer is this route's own.
   */
  constructor(private readonly input: LibraryRouteInput) {
    this.attribution = new ReactScriptsAttribution(() =>
      this.privateFolder === undefined
        ? undefined
        : join(this.privateFolder, REACT_SCRIPTS_LIBRARY_REPORT_FILE_NAME),
    )
    this.core = new LibraryRoute(
      {
        ...input,
        dependencyRelation: 'direct-or-installed',
        dependencies: {
          ...input.dependencies,
          writeAnchor: (prepared) => this.writePreload(prepared),
        },
      },
      this.attribution,
    )
  }

  /** The phase the route is in before the server listens, or `undefined` once it is past building. */
  currentPhase(): LibraryPhase | undefined {
    return this.core.currentPhase()
  }

  /**
   * Seam 1, before any process: plans the route through the core (checks, learner confirmation, private folder).
   * @param signal - The run's stop.
   * @param confirmTimeoutMs - How long the learner may take to answer.
   * @returns What {@link LibraryRoute.plan} fixed.
   * @throws As {@link LibraryRoute.plan}.
   * @example const planned = await route.plan(signal)
   */
  async plan(
    signal: AbortSignal,
    confirmTimeoutMs?: number,
  ): Promise<PlannedLibrary> {
    const planned = await this.core.plan(signal, confirmTimeoutMs)
    this.privateFolder = planned.privateFolder
    return planned
  }

  /**
   * Seam 2, before the server starts: builds and packs the library and writes the preload; see {@link LibraryRoute.prepare}.
   * @param signal - The run's stop.
   * @example await route.prepare(signal)
   */
  prepare(signal: AbortSignal): Promise<void> {
    return this.core.prepare(signal)
  }

  /**
   * The preload file `start.js` runs with `node --require`.
   * @returns Its absolute path.
   * @throws When the library was not prepared yet.
   * @example route.preloadPath() // => '/tmp/codebook-library-run-x/preload.cjs'
   */
  preloadPath(): string {
    if (this.preload === undefined)
      throw new Error('prepare must run before the preload exists.')
    return this.preload
  }

  /**
   * Writes the anchor manifest, the anchor folder and the generated preload into the private folder.
   * Called by the core's `prepare` in place of the Vite anchor file.
   * @param prepared - The built and packed library.
   * @returns The preload's path.
   * @throws `LIBRARY_BUILD_FAILED` (`pack-error`, step `link`, `sideEffects: "partial"`) through {@link PreparedLibraryCore.failLink} when a file cannot be written.
   */
  private async writePreload(prepared: PreparedLibraryCore): Promise<string> {
    const { privateFolder } = prepared
    const preloadPath = join(
      privateFolder,
      REACT_SCRIPTS_LIBRARY_PRELOAD_FILE_NAME,
    )
    try {
      const exampleRoot = await realpath(this.input.appRoot)
      await writeFile(join(privateFolder, 'package.json'), ANCHOR_MANIFEST_TEXT)
      await mkdir(join(privateFolder, 'anchor'), { recursive: true })
      await writeFile(
        preloadPath,
        buildReactScriptsLibraryPreloadSource({
          packageName: prepared.facts.package,
          packedRoot: prepared.packedRoot,
          privateFolder,
          exampleRoot,
          libraryRoot: prepared.libraryRoot,
          peers: prepared.peers,
          reportPath: join(
            privateFolder,
            REACT_SCRIPTS_LIBRARY_REPORT_FILE_NAME,
          ),
          cacheFolder: join(
            privateFolder,
            REACT_SCRIPTS_LIBRARY_CACHE_FOLDER_NAME,
          ),
          lineLimitBytes: REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
        }),
      )
    } catch (error) {
      return prepared.failLink(
        `The react-scripts preload could not be written: ${error instanceof Error ? error.message : String(error)}`,
        { sideEffects: 'partial' },
      )
    }
    this.preload = preloadPath
    this.packed = {
      packageName: prepared.facts.package,
      libraryRoot: prepared.libraryRoot,
      packedRoot: prepared.packedRoot,
    }
    return preloadPath
  }

  /**
   * The packed library a stop in the checked-out library is sealed through (decision D3).
   * Called by {@link ConfiguredBrowserRun} when it seals a library stop and when it words a library build change at a pause.
   * @returns The package name, the real checked-out folder and the real packed folder; `undefined` before the library was prepared.
   * @example route.packedLibrary() // => { packageName: 'redux', libraryRoot: '/repo', packedRoot: '/tmp/run/node_modules/redux' }
   */
  packedLibrary():
    | { packageName: string; libraryRoot: string; packedRoot: string }
    | undefined {
    return this.packed
  }

  /**
   * Readiness (decision D13): after the first compile, checks that the preload wrapped react-scripts' webpack configuration.
   * @throws `REACT_SCRIPTS_UNSUPPORTED` `library-redirect-not-applied` (`sideEffects: "partial"`) when the report holds no applied marker, or holds the preload's error line (its message is `details.cause`).
   * @example route.assertRedirectApplied() // throws when the redirect was not applied
   */
  assertRedirectApplied(): void {
    const reportPath = this.attribution.reportPath()
    const { reader } = this.attribution
    if (reportPath !== undefined) reader.refresh(reportPath)
    if (reader.errorCause !== undefined || !reader.wrapped)
      throw reactScriptsLibraryRedirectNotAppliedRefusal(reader.errorCause)
  }

  /**
   * Seam 3, observation: judges one script the page's debugger announced as parsed.
   * @param script - The announced script with the debugger's `hash`.
   * @example route.observeParsedScript({ url, scriptId, hash, isOwnedOrigin })
   */
  observeParsedScript(script: LibraryScript): void {
    this.core.observeScript(script)
  }

  /**
   * Seam 4, finalization: reads the rest of the report (waiting for an unterminated last line within the bound), judges the scripts that waited for it, then finalizes the observation.
   * @param isPageClosed - Whether the owned page closed within the close bound.
   * @example await route.finalize(true)
   */
  finalize(isPageClosed: boolean): Promise<void> {
    // A retried Stop re-runs finalization: the first call's result stands, nothing is settled, judged or journaled again.
    this.finalizing ??= this.finalizeOnce(isPageClosed)
    return this.finalizing
  }

  private async finalizeOnce(isPageClosed: boolean): Promise<void> {
    await this.attribution.settle()
    for (const script of this.attribution.takeDeferred())
      this.core.observeScript(script)
    const cause = this.attribution.reader.unreadableCause
    // A report that is only missing says nothing yet (the run may have ended before the first compile); every other fault cannot be trusted.
    if (
      cause !== undefined &&
      cause !== 'report-missing' &&
      this.core.view().prepared
    )
      this.core.markUnreadable(cause)
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
