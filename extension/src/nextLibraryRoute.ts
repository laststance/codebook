import {
  NEXT_LIBRARY_COMPILERS,
  NEXT_LIBRARY_WRAPPED_POLL_MS,
  NEXT_LIBRARY_WRAPPED_WAIT_MS,
} from './constants'
import type { LibraryRouteInput, LibraryScript } from './libraryRoute'
import { nextLibraryRedirectNotAppliedRefusal } from './nextRefusals'
import { buildNextLibraryPreloadSource } from './utils/nextLibraryPreload'
import {
  WebpackLibraryRoute,
  type WebpackLibraryFlavor,
} from './webpackLibraryRoute'

/** The Next flavor: the direct relation (decision D4), the Next preload, server scripts observed, and one `wrapped` line per compiler (decision D20). */
const NEXT_FLAVOR: WebpackLibraryFlavor = {
  dependencyRelation: 'direct',
  preloadLabel: 'Next preload',
  observesServer: true,
  buildPreload: buildNextLibraryPreloadSource,
  assertRedirect: (reader, libraryName) => {
    const wrapped = reader.wrappedCompilers()
    const errored = reader.erroredCompilers()
    // A compiler counts as wrapped only with its `wrapped` line and no `error` line of its own.
    const missing = NEXT_LIBRARY_COMPILERS.filter(
      (compiler) => !wrapped.has(compiler) || errored.has(compiler),
    )
    if (missing.length > 0 || reader.errorCause !== undefined)
      throw nextLibraryRedirectNotAppliedRefusal(
        libraryName,
        missing,
        reader.errorCause,
      )
  },
}

/**
 * The run side of the Next library route: a {@link WebpackLibraryRoute} with the Next flavor, attributing the scripts of the page and of the server.
 *
 * Why it exists: Next compiles the client, the server and the edge separately, so a library Example is proven to run the packed copy only when every compiler was patched and every script of both participants matches the compilations' report. Created by {@link ConfiguredBrowserRun} for a nested version 3 `next-dev-webpack` run that declares `library`; the run calls `plan`, `prepare`, passes `preloadPath()` to the Next launch, calls `awaitRedirectApplied` once the server started and before its readiness request, calls `serverAttached` once the server debugger session is attached and subscribed, feeds both participants' scripts to `observeParsedScript`, and ends with `finalize` and `dispose`.
 *
 * Observation rules (all end the observation `unreadable` rather than claiming): an external module of the package (Node loads it outside the report's sight, D23), a library resource in an edge asset (edge is unproven, D24), a compilation of a compiler no `wrapped` line announced or a later `error` line (cause `redirect-not-applied`), a report error line. It ends `complete` only when the page was observed, closed and the server session was attached (D21); a run whose server was never attached ends `incomplete`, journaled as `library.server-not-attached`. Scripts parsed after finalization started are not counted (D12).
 *
 * @example
 * const route = new NextLibraryRoute(input)
 * await route.plan(signal)
 * await route.prepare(signal)
 * route.preloadPath() // => '/tmp/codebook-library-run-x/preload.cjs'
 * await route.awaitRedirectApplied(signal) // after Next is ready, before the first request
 */
export class NextLibraryRoute extends WebpackLibraryRoute {
  private isServerAttached = false

  /**
   * @param input - The run's facts and seams; the dependency relation is fixed to `direct` here (decision D4).
   */
  constructor(input: LibraryRouteInput) {
    super(input, NEXT_FLAVOR)
  }

  /**
   * Tells the route that the server's debugger session is attached and subscribed to `Debugger.scriptParsed`; without it the observation cannot end `complete`.
   * Called by {@link ConfiguredBrowserRun} before the readiness request (a late subscription gets no replay, D22).
   * @example route.serverAttached()
   */
  serverAttached(): void {
    this.isServerAttached = true
  }

  /**
   * Waits, within the bound, until the preload wrote a `wrapped` line for the client, server and edge-server compilers, and refuses when one is missing at the end or an `error` line appears.
   *
   * Called by the run after the server started and before the readiness request, so that no request runs unpatched code (decision D20; the lines appear about 0.76 s after Next is ready).
   * @param signal - The run's stop; an abort ends the wait with the stop's error.
   * @param deadlineMs - How long to wait; defaults to {@link NEXT_LIBRARY_WRAPPED_WAIT_MS}.
   * @throws `NEXT_UNSUPPORTED_SETTING` `library-redirect-not-applied` (`sideEffects: "partial"`) naming the compilers still unwrapped; the stop's error when `signal` aborted.
   * @example await route.awaitRedirectApplied(signal, 5000)
   */
  async awaitRedirectApplied(
    signal: AbortSignal,
    deadlineMs: number = NEXT_LIBRARY_WRAPPED_WAIT_MS,
  ): Promise<void> {
    const endsAt = Date.now() + deadlineMs
    for (;;) {
      signal.throwIfAborted()
      try {
        this.assertRedirectApplied()
        return
      } catch (error) {
        // An `error` line is final: the patch failed, waiting changes nothing.
        if (
          this.attribution.reader.errorCause !== undefined ||
          Date.now() >= endsAt
        )
          throw error
      }
      await new Promise((resolve) =>
        setTimeout(resolve, NEXT_LIBRARY_WRAPPED_POLL_MS),
      )
    }
  }

  /** Ignores scripts announced after finalization started (decision D12); the observation covers the scripts parsed until then. */
  override observeParsedScript(script: LibraryScript): void {
    if (this.hasStartedFinalizing()) return
    super.observeParsedScript(script)
  }

  /** Demands the server session was attached beside the closed page (decision D21); otherwise the observation reads `incomplete`. */
  protected override canComplete(isPageClosed: boolean): boolean {
    if (isPageClosed && !this.isServerAttached) {
      this.input.record('library.server-not-attached')
      return false
    }
    return isPageClosed
  }
}
