import { mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  REACT_SCRIPTS_LIBRARY_CACHE_FOLDER_NAME,
  REACT_SCRIPTS_LIBRARY_PRELOAD_FILE_NAME,
  REACT_SCRIPTS_LIBRARY_REPORT_FILE_NAME,
  REACT_SCRIPTS_LIBRARY_REPORT_LINE_LIMIT_BYTES,
} from './constants'
import type { PreparedLibraryCore } from './libraryPackage'
import {
  LibraryRoute,
  type LibraryPhase,
  type LibraryRouteInput,
  type LibraryRunRoute,
  type LibraryScript,
  type PlannedLibrary,
} from './libraryRoute'
import type { LibraryRunView } from './nodeScriptRuntimeTypes'
import type { LibraryDependencyRelation } from './utils/assertLibraryRouteSupported'
import type { WebpackLibraryPreloadConfiguration } from './utils/webpackLibraryPreloadBody'
import type {
  WebpackLibraryReportReader,
  WebpackLibraryReportUnreadableCause,
} from './utils/webpackLibraryReport'
import { WebpackReportAttribution } from './webpackLibraryAttribution'

/** The text of the private folder's `package.json`: webpack's `ModuleScopePlugin` needs a description file above the anchor (Cycle 0097 E1). */
const ANCHOR_MANIFEST_TEXT = `${JSON.stringify({ name: 'codebook-library-anchor', private: true })}\n`

/**
 * What differs between the webpack bundlers' library routes: the dependency relation, the generated preload and how a missing redirect is asserted.
 *
 * Why it exists: the react-scripts and Next routes share the whole shell ({@link WebpackLibraryRoute}); a flavor is the small record each passes to it.
 */
export type WebpackLibraryFlavor = {
  /** How the Example must depend on the library. */
  dependencyRelation: LibraryDependencyRelation
  /** Names the bundler in the message of a preload that could not be written (`The <label> could not be written`). */
  preloadLabel: string
  /** Whether the server's scripts are observed too and the report must show every compiler wrapped (Next); see {@link WebpackReportAttribution.reportFaultCause}. */
  observesServer: boolean
  /** Builds the text of the generated preload file. */
  buildPreload: (configuration: WebpackLibraryPreloadConfiguration) => string
  /**
   * Throws the bundler's refusal when the report does not show the redirect applied.
   * @param reader - The report reader, refreshed by the caller just before.
   * @param libraryName - The library's package name, for the sentence.
   * @param hasPackedModule - Whether the report names a compiled module inside the packed copy's folder (`false` before the library was prepared).
   */
  assertRedirect: (
    reader: WebpackLibraryReportReader,
    libraryName: string,
    hasPackedModule: boolean,
  ) => void
}

/**
 * The run side of a webpack library route: the bundler-neutral {@link LibraryRoute} core plus the preload files and the report attribution.
 *
 * Why it exists: the redirect itself lives in the generated preload; the run needs one narrow place for everything that decides what the run may claim (decision D12). The react-scripts and Next routes are its thin flavors; the run calls it at these seams: before the server (`plan`), before the start (`prepare`, which also writes the preload), after the compile (`assertRedirectApplied`), for each script parsed (`observeParsedScript`) and at the end (`finalize`, `dispose`).
 *
 * @example
 * const route = new WebpackLibraryRoute(input, flavor)
 * await route.plan(signal)
 * await route.prepare(signal)
 * route.preloadPath() // => '/tmp/codebook-library-run-x/preload.cjs'
 */
export class WebpackLibraryRoute implements LibraryRunRoute {
  protected readonly core: LibraryRoute
  protected readonly attribution: WebpackReportAttribution
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
   * @param input - The run's facts and seams; the dependency relation is the flavor's and the anchor writer is this route's own.
   * @param flavor - What differs for this bundler.
   */
  constructor(
    protected readonly input: LibraryRouteInput,
    private readonly flavor: WebpackLibraryFlavor,
  ) {
    this.attribution = new WebpackReportAttribution(
      () =>
        this.privateFolder === undefined
          ? undefined
          : join(this.privateFolder, REACT_SCRIPTS_LIBRARY_REPORT_FILE_NAME),
      flavor.observesServer,
    )
    this.core = new LibraryRoute(
      {
        ...input,
        dependencyRelation: flavor.dependencyRelation,
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
        this.flavor.buildPreload({
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
        `The ${this.flavor.preloadLabel} could not be written: ${error instanceof Error ? error.message : String(error)}`,
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
   * Readiness (decision D13): checks that the preload wrapped the bundler's webpack configuration, as the flavor defines it.
   * @throws The flavor's refusal (`library-redirect-not-applied`, `sideEffects: "partial"`) when the report does not show the redirect applied.
   * @example route.assertRedirectApplied() // throws when the redirect was not applied
   */
  assertRedirectApplied(): void {
    const reportPath = this.attribution.reportPath()
    const { reader } = this.attribution
    if (reportPath !== undefined) reader.refresh(reportPath)
    this.flavor.assertRedirect(
      reader,
      this.core.displayName(),
      this.packed !== undefined &&
        reader.hasResourceInside(this.packed.packedRoot),
    )
  }

  /**
   * Polls {@link assertRedirectApplied} until it passes, the report holds a final failure, the process ended or the bound ran out.
   *
   * Called by the flavors' `awaitRedirectApplied`: the preload writes its lines at `emit`, so a read right after the bundler's "compiled" output can come before them. An `error` or `reportError` line is final (waiting changes nothing).
   * @param signal - The run's stop; an abort ends the wait with the stop's error.
   * @param deadlineMs - How long to wait.
   * @param pollMs - The pause between reads.
   * @param assertRunning - Throws the owned process's own failure once it exited, so an early exit is not reported as a missing redirect.
   * @throws The `assertRunning` failure, the flavor's refusal at the end of the bound or at a final line, or the stop's error.
   * @example await this.awaitApplied(signal, 5000, 50, () => app.assertRunning())
   */
  protected async awaitApplied(
    signal: AbortSignal,
    deadlineMs: number,
    pollMs: number,
    assertRunning: () => void,
  ): Promise<void> {
    const endsAt = Date.now() + deadlineMs
    for (;;) {
      signal.throwIfAborted()
      // A process that exited is the real failure; its lines will never come.
      assertRunning()
      try {
        this.assertRedirectApplied()
        return
      } catch (error) {
        const { reader } = this.attribution
        if (
          reader.errorCause !== undefined ||
          reader.reportErrorCause !== undefined ||
          Date.now() >= endsAt
        )
          throw error
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  /**
   * Seam 3, observation: judges one script a debugger announced as parsed.
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
    try {
      await this.attribution.settle()
      for (const script of this.attribution.takeDeferred())
        this.core.observeScript(script)
    } catch (error) {
      // A report that cannot be read at the end (a failed read or close) leaves the observation unclaimed; finalization must still resolve so the server, the browser and the debugger stop.
      this.core.markUnreadable(
        `report-read-failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    let cause = this.attribution.reader.unreadableCause
    // The reader treats an absent file as "no lines yet", so a report that vanished after the server was attached is detected here.
    if (cause === undefined && this.isMissingReportAFault())
      cause = await this.missingReportCause()
    // A report that is only missing says nothing yet (the run may have ended before the first compile), unless the server was observed: its scripts were ignored while the report was absent, so "not loaded" must never be claimed; every other fault cannot be trusted.
    if (
      cause !== undefined &&
      (cause !== 'report-missing' || this.isMissingReportAFault()) &&
      this.core.view().prepared
    )
      this.core.markUnreadable(cause)
    // A page that parsed bundle scripts the report never described is missing evidence: never claim "not loaded" from it.
    const missingEvidenceCause = this.attribution.missingEvidenceCause()
    if (missingEvidenceCause !== undefined && this.core.view().prepared)
      this.core.markUnreadable(missingEvidenceCause)
    // Report-wide faults (a compiler never wrapped, an external of the package, an unobserved edge compile) cannot be read as "not loaded" either.
    const faultCause = this.attribution.reportFaultCause()
    if (faultCause !== undefined && this.core.view().prepared)
      this.core.markUnreadable(faultCause)
    this.core.finalize(this.canComplete(isPageClosed))
  }

  /**
   * Tells whether finalization may close the observation as `complete`.
   * The shell lets the page's close decide; {@link NextLibraryRoute} also demands that the server session was attached.
   * @param isPageClosed - Whether the owned page closed within the close bound.
   * @returns The value handed to {@link LibraryRoute.finalize}.
   */
  protected canComplete(isPageClosed: boolean): boolean {
    return isPageClosed
  }

  /** Returns `report-missing` when the report file no longer exists, else `undefined`. */
  private async missingReportCause(): Promise<
    WebpackLibraryReportUnreadableCause | undefined
  > {
    const reportPath = this.attribution.reportPath()
    if (reportPath === undefined) return undefined
    try {
      await stat(reportPath)
      return undefined
    } catch {
      return 'report-missing'
    }
  }

  /**
   * Tells whether a report that is missing at finalization makes the observation unreadable.
   * The shell never does (react-scripts has no server scripts to judge); {@link NextLibraryRoute} does once its server session was attached.
   * @returns `true` when the missing report must end the observation `unreadable`.
   */
  protected isMissingReportAFault(): boolean {
    return false
  }

  /** Tells whether finalization has started; a route that stops counting scripts then (Next, decision D12) asks it. */
  protected hasStartedFinalizing(): boolean {
    return this.finalizing !== undefined
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
