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
  buildPreload: buildReactScriptsLibraryPreloadSource,
  assertRedirect: (reader) => {
    if (reader.errorCause !== undefined || !reader.wrapped)
      throw reactScriptsLibraryRedirectNotAppliedRefusal(reader.errorCause)
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
}
