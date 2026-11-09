import {
  REACT_SCRIPTS_LIBRARY_REDIRECT_POLL_MS,
  REACT_SCRIPTS_LIBRARY_REDIRECT_WAIT_MS,
} from './constants'
import type { LibraryRouteInput } from './libraryRoute'
import { reactScriptsLibraryRedirectNotAppliedRefusal } from './reactScriptsRefusals'
import { buildReactScriptsLibraryPreloadSource } from './utils/reactScriptsLibraryPreload'
import {
  WebpackLibraryRoute,
  type WebpackLibraryFlavor,
} from './webpackLibraryRoute'

/** The react-scripts flavor: the installed-dependency relation (decision D4), the react-scripts preload and one global applied marker. */
const REACT_SCRIPTS_FLAVOR: WebpackLibraryFlavor = {
  dependencyRelation: 'direct-or-installed',
  preloadLabel: 'react-scripts preload',
  observesServer: false,
  buildPreload: buildReactScriptsLibraryPreloadSource,
  assertRedirect: (reader, _libraryName, hasPackedModule) => {
    // `wrapped` shows the factory was wrapped, not that the resolver served the packed copy (webpack 4 wrapped fine and redirected nothing): the redirect counts as applied only when a compiled module lies inside the packed folder.
    const cause = reader.errorCause ?? reader.reportErrorCause
    if (cause !== undefined)
      throw reactScriptsLibraryRedirectNotAppliedRefusal(cause)
    if (!reader.wrapped) throw reactScriptsLibraryRedirectNotAppliedRefusal()
    // A compilation line cut at the line bound lost its resource list: the redirect is unconfirmed, not failed.
    if (!hasPackedModule && reader.truncatedCompilations > 0)
      throw reactScriptsLibraryRedirectNotAppliedRefusal(
        'the compilation report was incomplete, so the redirect could not be confirmed',
      )
    if (!hasPackedModule)
      throw reactScriptsLibraryRedirectNotAppliedRefusal(
        'the compilation names no module of the packed library',
      )
  },
}

/**
 * The run side of the react-scripts library route: a {@link WebpackLibraryRoute} with the react-scripts flavor.
 *
 * Why it exists: the redirect itself lives in the generated preload ({@link buildReactScriptsLibraryPreloadSource}); the shell holds everything that decides what the run may claim. Created by {@link ConfiguredBrowserRun} for a nested version 3 `react-scripts-dev` run that declares `library`; at the readiness seam `assertRedirectApplied` throws `REACT_SCRIPTS_UNSUPPORTED` `library-redirect-not-applied` when the report holds no applied marker or holds the preload's error line.
 *
 * @example
 * const route = new ReactScriptsLibraryRoute(input)
 * await route.plan(signal)
 * await route.prepare(signal)
 * route.preloadPath() // => '/tmp/codebook-library-run-x/preload.cjs'
 */
export class ReactScriptsLibraryRoute extends WebpackLibraryRoute {
  /**
   * @param input - The run's facts and seams; the dependency relation is fixed to `direct-or-installed` here (decision D4).
   */
  constructor(input: LibraryRouteInput) {
    super(input, REACT_SCRIPTS_FLAVOR)
  }

  /**
   * Waits, within the bound, until the report shows the redirect applied, then returns; refuses at an `error` or `reportError` line or when the bound ends first.
   *
   * Called by {@link ConfiguredBrowserRun} after the first compile: the preload writes its compilation line at `emit`, so one read right after the bundler's output can come before it.
   * @param signal - The run's stop; an abort ends the wait with the stop's error.
   * @param assertRunning - Throws the owned process's own failure once it exited.
   * @param deadlineMs - How long to wait; defaults to {@link REACT_SCRIPTS_LIBRARY_REDIRECT_WAIT_MS}.
   * @throws `REACT_SCRIPTS_UNSUPPORTED` `library-redirect-not-applied` (`sideEffects: "partial"`).
   * @example await route.awaitRedirectApplied(signal, () => app.assertRunning())
   */
  async awaitRedirectApplied(
    signal: AbortSignal,
    assertRunning: () => void = () => undefined,
    deadlineMs: number = REACT_SCRIPTS_LIBRARY_REDIRECT_WAIT_MS,
  ): Promise<void> {
    await this.awaitApplied(
      signal,
      deadlineMs,
      REACT_SCRIPTS_LIBRARY_REDIRECT_POLL_MS,
      assertRunning,
    )
  }
}
