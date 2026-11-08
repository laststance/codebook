import {
  MILLISECONDS_PER_SECOND,
  NEXT_SETUP_STEPS,
  type NextSetupStep,
} from './constants'
import { StudyError, type ErrorCode } from './errors'
import {
  ROUTE_HANDLER_REFUSAL_RECOVERY,
  type RouteHandlerRefusalReason,
} from './utils/routeHandlerWording'

/**
 * The stable codes a Next Pages run refuses with, in the run's precedence order for the checks after the entry page answered (setting, redirect, not compiled, conflict, not found), then the seal refusals and the setup deadline.
 * The help writer lists one anchor per entry, and a test holds this list equal to the `NEXT_*` keys of {@link ERROR_RECOVERY}.
 */
export const NEXT_REFUSAL_CODES = [
  'NEXT_UNSUPPORTED_SETTING',
  'NEXT_ENTRY_REDIRECTED',
  'NEXT_ROUTE_NOT_COMPILED',
  'NEXT_ROUTE_CONFLICT',
  'NEXT_ROUTE_NOT_FOUND',
  'NEXT_SERVER_ONLY_STOP',
  'NEXT_STOP_NOT_SEALED',
  'NEXT_SETUP_DEADLINE',
] as const satisfies readonly ErrorCode[]

/** One code of {@link NEXT_REFUSAL_CODES}. */
export type NextRefusalCode = (typeof NEXT_REFUSAL_CODES)[number]

/** What the router-ready wait of a Pages run saw at the deadline: no `window.next.router` at all, or a router that never turned ready. */
export type NextRouterState = 'absent' | 'late'

/**
 * The help anchor of a Next refusal code: `codebook://help/repository-browser#<CODE>`.
 *
 * Why it exists: the recovery texts and the help writer name the same anchor, so an agent that follows a code lands on its section. Called by the help writer and the tests.
 * @param code - A Next refusal code.
 * @returns The resource address with the code as its anchor.
 * @example
 * nextHelpAnchor('NEXT_ROUTE_NOT_FOUND') // => 'codebook://help/repository-browser#NEXT_ROUTE_NOT_FOUND'
 */
export function nextHelpAnchor(code: NextRefusalCode): string {
  return `codebook://help/repository-browser#${code}`
}

/**
 * Builds the refusal an agent reads for a Next Pages run: a {@link StudyError} with the code's static recovery from {@link ERROR_RECOVERY}.
 *
 * Why it exists: the recovery never carries a value, because a recovery override reaches MCP unsanitized; every dynamic value (the entry path, a setting, the step, a file, quoted development-server output) goes into the message and the cause, which the service sanitizes and bounds. Called by the configured browser run before input, where a thrown refusal reaches the service's preparation error with its code.
 * @param code - The refusal code.
 * @param message - What was refused, naming the path, file, setting or value, ending with the fix or the limit; it is the cause as well.
 * @param extras - Structured `details` an agent decides by (a Pages stop refusal carries {@link PAGES_STOP_REFUSAL_DETAILS}) and a recovery that replaces the code's static one when it would mislead (a refusal before the server started). Both are static or value-free: a recovery override reaches MCP unsanitized.
 * @returns The error to throw.
 * @example
 * throw nextRefusal('NEXT_UNSUPPORTED_SETTING', 'This Next 16.4.3 project sets basePath (/docs); Codebook\'s browser run does not support basePath or i18n routing.')
 * throw nextRefusal('NEXT_STOP_NOT_SEALED', message, { details: PAGES_STOP_REFUSAL_DETAILS })
 */
export function nextRefusal(
  code: NextRefusalCode,
  message: string,
  extras?: { details?: StudyError['details']; recovery?: string },
): StudyError {
  return new StudyError(
    code,
    message,
    message,
    extras?.recovery,
    undefined,
    extras?.details,
  )
}

/** The static recovery of a `NEXT_STOP_NOT_SEALED` whose `details.reason` is `outside-package`: it names fields, never values, because a recovery override reaches MCP unsanitized. */
const OUTSIDE_PACKAGE_RECOVERY =
  'Declare stops only in files inside details.packageRoot (every file in details.files lies outside it), or tell the learner a file outside the Next app folder cannot be observed in this version; library or shared packages the app imports are not supported. Recovery: fix the configuration, then one new start. Nothing was started: no server, no browser and no input (details.sideEffects is none). See codebook://help/repository-browser#NEXT_STOP_NOT_SEALED.'

/**
 * Builds the refusal of stop files that lie outside the Next app's `packageRoot`, raised at configuration resolution before any process starts.
 * Called by {@link ConfiguredBrowserRun} after the package resolved.
 * @param packageRoot - The package root's canonical repository-relative path.
 * @param files - Every offending repository-relative stop file, in declared order, without repeats.
 * @returns The `NEXT_STOP_NOT_SEALED` error: `details.reason: "outside-package"`, `files`, `packageRoot`, `sideEffects: "none"` and no `router`.
 * @example
 * throw outsidePackageRefusal('examples/react/nextjs', ['packages/ui/src/button.tsx'])
 */
export function outsidePackageRefusal(
  packageRoot: string,
  files: readonly string[],
): StudyError {
  const message = `Stop file${files.length === 1 ? '' : 's'} ${files.join(', ')} lie${files.length === 1 ? 's' : ''} outside packageRoot ${packageRoot}; Codebook seals stops inside the Next app's own folder only, so the run was refused before the server started.`
  return nextRefusal('NEXT_STOP_NOT_SEALED', message, {
    details: {
      reason: 'outside-package',
      files: [...files],
      packageRoot,
      sideEffects: 'none',
    },
    recovery: OUTSIDE_PACKAGE_RECOVERY,
  })
}

/** The static recovery of a `NEXT_STOP_NOT_SEALED` whose `details.reason` is `library-stop-unsupported`: it names fields, never values, because a recovery override reaches MCP unsanitized. */
const LIBRARY_STOP_UNSUPPORTED_RECOVERY =
  "Declare the stop in a file of the Example's own source (details.file lies in the library, which this version cannot pause on the Next library route), or start the run without library when the question is about the library's own source; never edit the project. Recovery: fix the configuration, then one new start. Nothing was started: no build, no server, no browser and no input (details.sideEffects is none). See codebook://help/repository-browser#NEXT_STOP_NOT_SEALED."

/**
 * Builds the refusal of a stop in the checked-out library's own source on a Next run that declares `library`, raised before anything is built or started.
 *
 * Why it exists: Next's server chunks do not chain the library's own source map, so a stop in the library's source cannot be sealed on the Next library route in this version (decision D13). Called by {@link ConfiguredBrowserRun} while it resolves the Next package of the run, for a run that declares `library`.
 * @param libraryName - The library's package name.
 * @param file - The repository-relative stop file inside the library folder.
 * @returns The `NEXT_STOP_NOT_SEALED` error: `details.reason: "library-stop-unsupported"`, `library`, `file` and `sideEffects: "none"`.
 * @example
 * throw nextLibraryStopUnsupportedRefusal('react-redux', 'src/hooks/useSelector.ts')
 */
export function nextLibraryStopUnsupportedRefusal(
  libraryName: string,
  file: string,
): StudyError {
  const message = `The stop file ${file} lies in the source of library ${libraryName}; stops in the library's own source are not supported on the Next library route in this version, so the run was refused before anything was built or started. Stop in the Example's source instead, or run without library.`
  return nextRefusal('NEXT_STOP_NOT_SEALED', message, {
    details: {
      reason: 'library-stop-unsupported',
      library: libraryName,
      file,
      sideEffects: 'none',
    },
    recovery: LIBRARY_STOP_UNSUPPORTED_RECOVERY,
  })
}

/** The static recovery of a `NEXT_UNSUPPORTED_SETTING` whose `details.reason` is `library-redirect-not-applied`; the code's own recovery speaks of basePath and i18n routing, which would mislead here. */
const LIBRARY_REDIRECT_NOT_APPLIED_RECOVERY =
  "Tell the learner this Next installation cannot take the library route in this version (details.compilers names the compilers whose redirect was not confirmed, details.cause the preload's error when it wrote one), then start again once without library, saying the Example then runs its installed copy of the library; never retry with library and never edit the project. Recovery: learner decision, then one new start. The library was built and packed and the owned server was started and stopped; no request was sent and no browser was opened (details.sideEffects is partial). See codebook://help/repository-browser#NEXT_UNSUPPORTED_SETTING."

/** The most characters of the preload's error message a refusal quotes. */
const LIBRARY_REDIRECT_CAUSE_MAX_CHARS = 300

/**
 * Builds the refusal of a Next library run whose preload did not confirm the redirect for every compiler, raised after the owned server started and before any request.
 *
 * Why it exists: a Next installation that builds its webpack configuration another way would serve the Example's installed copy while the run reads complete, so the run is refused instead (decision D20). Called by {@link ConfiguredBrowserRun} after the server start returns.
 * @param libraryName - The library's package name.
 * @param compilers - The compilers that wrote no `wrapped` line within the bound (`client`, `server`, `edge-server`); empty when the preload wrote its error line instead.
 * @param cause - The preload's error message, when it wrote one; cut to {@link LIBRARY_REDIRECT_CAUSE_MAX_CHARS}.
 * @returns The `NEXT_UNSUPPORTED_SETTING` error: `details.reason: "library-redirect-not-applied"`, `library`, `compilers`, `cause` (when known) and `sideEffects: "partial"`.
 * @example
 * nextLibraryRedirectNotAppliedRefusal('react-redux', ['server']).details?.compilers // => ['server']
 */
export function nextLibraryRedirectNotAppliedRefusal(
  libraryName: string,
  compilers: readonly string[],
  cause?: string,
): StudyError {
  const quoted = cause?.slice(0, LIBRARY_REDIRECT_CAUSE_MAX_CHARS)
  const missing =
    compilers.length === 0
      ? ''
      : ` for the ${compilers.join(', ')} compiler${compilers.length === 1 ? '' : 's'}`
  const message = `The library redirect of ${libraryName} was not applied${missing}${quoted === undefined ? '' : ` (${quoted})`}, so the Example would run its installed copy of the library, not the checked-out one. The library was built and packed, the owned server was stopped, no request was sent and no browser was opened.`
  return nextRefusal('NEXT_UNSUPPORTED_SETTING', message, {
    details: {
      reason: 'library-redirect-not-applied',
      library: libraryName,
      compilers: [...compilers],
      ...(quoted === undefined ? {} : { cause: quoted }),
      sideEffects: 'partial',
    },
    recovery: LIBRARY_REDIRECT_NOT_APPLIED_RECOVERY,
  })
}

/** What each route-handler refusal says was refused; the recovery comes from {@link ROUTE_HANDLER_REFUSAL_RECOVERY}, which the help shares. */
const ROUTE_HANDLER_REFUSAL_TEXT: Record<RouteHandlerRefusalReason, string> = {
  'route-handler-before-operation':
    'is a route handler declared afterOperation 0; a route handler runs for a request the page sends after an operation',
  'route-handler-edge-runtime':
    'is a route handler that declares export const runtime = "edge", which Codebook cannot pause',
  'api-route-before-operation':
    'is a Pages API route declared with afterOperation 0 or in a version 2 configuration; an API-route stop pauses only for a request the page sends after an operation',
  'api-route-edge-runtime':
    'is a Pages API route whose exported config declares the edge runtime, which Codebook cannot pause',
  'route-handler-not-app-source':
    "is a route handler in node_modules or a workspace library, not in the app's own source",
}

/**
 * Builds the refusal of a route-handler stop that Codebook can judge unsupported from the configuration and the source text alone, raised before any process starts.
 * Called by {@link ConfiguredBrowserRun} from its lexical route-handler pass.
 * @param reason - Which condition refused the stop.
 * @param place - The stop's `<path>:<line>`.
 * @param index - The stop's zero-based declared index.
 * @returns The `NEXT_STOP_NOT_SEALED` error with `details.reason`, `stopIndex`, `file` and `sideEffects: "none"`.
 * @example
 * throw routeHandlerStopRefusal('route-handler-before-operation', 'app/api/todos/route.ts:25', 0)
 */
export function routeHandlerStopRefusal(
  reason: RouteHandlerRefusalReason,
  place: string,
  index: number,
): StudyError {
  const what = ROUTE_HANDLER_REFUSAL_TEXT[reason]
  const file = place.slice(0, place.lastIndexOf(':'))
  return nextRefusal(
    'NEXT_STOP_NOT_SEALED',
    `Declared stop ${place} ${what}, so the run was refused before the server started.`,
    {
      details: { reason, stopIndex: index, file, sideEffects: 'none' },
      recovery: ROUTE_HANDLER_REFUSAL_RECOVERY[reason],
    },
  )
}

/** The help anchor of one library refusal reason: the per-reason section, not the code's general one. */
const libraryHelpAnchor = (reason: string): string =>
  `codebook://help/repository-browser#${reason}`

/** The sentence a library recovery ends with for a refusal raised before anything started. */
const LIBRARY_NOTHING_STARTED =
  'Nothing was started: no server, no browser and no input (details.sideEffects is none).'

/** The sentence a library recovery ends with for a refusal raised after the readiness request. */
const LIBRARY_ENTRY_REQUESTED =
  "The entry had already been requested, so the page's data function may have run (details.sideEffects is unknown)."

/** The sentence a Vite library recovery ends with for a refusal raised before the browser opened: no browser opened and no page or app code ran, Codebook wrote no learner file or build output, and the owned Vite server that had started may have written its own dependency cache. */
const LIBRARY_VITE_BEFORE_BROWSER =
  'No browser was opened and no input was sent; no page or application code ran and Codebook wrote no learner file or build output; the owned Vite server had started (it was stopped) and may have written its own dependency cache (details.sideEffects is none).'

/** The sentence a Vite library recovery ends with for a refusal raised after the browser opened. */
const LIBRARY_VITE_BROWSER_OPENED =
  "The browser had already loaded the entry page, so the page's own code ran (details.sideEffects is unknown)."

/** The body of the `library-build-stale` recovery, shared by both adapters; each adds its own ending. */
const LIBRARY_STALE_BODY =
  "A workspace library's build does not match its checked-out source (details.library names the package, details.file the stop file). Tell the learner to run the build script of that library themselves and ask for a new start; never run the build yourself, and never declare another stop to make the run succeed."

/** The body of the `library-build-unmapped` recovery, shared by both adapters; each adds its own ending. */
const LIBRARY_UNMAPPED_BODY =
  "A workspace library's build cannot be tied to the stop file (details.library names the package, details.file the stop file, details.cause says why). Read details.cause and follow the section for it in the help; the cause decides whether a rebuild can help. Never run the build yourself, and do not retry with the same stop."

/**
 * The static recovery of each library refusal, keyed by `details.reason`: fields only, because a recovery override reaches MCP unsanitized.
 * Each text matches the fix of the same reason in the repository-browser help and ends at that reason's own anchor.
 */
const LIBRARY_RECOVERIES = {
  'library-build-stale': `${LIBRARY_STALE_BODY} ${LIBRARY_NOTHING_STARTED} See ${libraryHelpAnchor('library-build-stale')}.`,
  'library-build-unmapped': `${LIBRARY_UNMAPPED_BODY} ${LIBRARY_NOTHING_STARTED} See ${libraryHelpAnchor('library-build-unmapped')}.`,
  'library-not-in-build': `The page's server code does not hold exactly one built file of the library that maps the stop (details.candidates lists them). Tell the learner, or choose a stop on a line the page's server code runs; do not start another run with the same stop. ${LIBRARY_ENTRY_REQUESTED} See ${libraryHelpAnchor('library-not-in-build')}.`,
  'library-place-ambiguous': `The library stop could not be tied to one source position. Declare the stop on a line that holds a single statement, after the line that declares the value it reads; do not start another run with the same stop. ${LIBRARY_ENTRY_REQUESTED} See ${libraryHelpAnchor('library-place-ambiguous')}.`,
  'library-build-changed': `The library was rebuilt, or the module the run executes changed, during the run. Tell the learner to finish the rebuild and ask for a new start; never run the build yourself. ${LIBRARY_ENTRY_REQUESTED} See ${libraryHelpAnchor('library-build-changed')}.`,
} as const

/** The Pages browser layer's wording of the refusal that names the searched code (`library-not-in-build`); the server layer keeps {@link LIBRARY_RECOVERIES}. `library-build-changed` has one recovery for both layers, because a restored failure text carries no layer ({@link refusalFailureOf}). */
const BROWSER_LIBRARY_RECOVERIES = {
  'library-not-in-build': `The entry chunks of the route and \`_app\` that the page loads at start do not hold exactly one built file of the library that maps the stop (details.candidates lists them). A library module the page loads later (\`next/dynamic\`, a lazy import) cannot be sealed. Tell the learner, or choose a stop on a line the page runs at load; do not start another run with the same stop. ${LIBRARY_ENTRY_REQUESTED} See ${libraryHelpAnchor('library-not-in-build')}.`,
} as const

/** The App Router browser layer's wording of the refusal that names the searched code (`library-not-in-build`): the client chunks of the entry route's client reference manifest. */
const APP_BROWSER_LIBRARY_RECOVERIES = {
  'library-not-in-build': `The client chunks of the entry route's client reference manifest do not hold exactly one built file of the library whose map names the stop's checked-out file (details.candidates lists them; details.mapSource is the path the module's map named). A library module the page loads later (\`next/dynamic\`, a lazy import) cannot be sealed. Tell the learner, or choose a stop on a line the page runs at load; do not start another run with the same stop. ${LIBRARY_ENTRY_REQUESTED} See ${libraryHelpAnchor('library-not-in-build')}.`,
} as const

/** The App Router server layer's wording of the refusal that names the searched code (`library-not-in-build`): the entry route's server compile, where only the `(rsc)` modules count. */
const APP_SERVER_LIBRARY_RECOVERIES = {
  'library-not-in-build': `The entry route's server compile does not hold exactly one \`(rsc)\` module of a built file of the library whose map names the stop's checked-out file (details.candidates lists them; details.mapSource is the path the module's map named). The \`(ssr)\` copy of a module is another layer's and never counts. A library module the server loads later or never loads cannot be sealed. Tell the learner, or choose a stop on a line the page's server render runs; do not start another run with the same stop. ${LIBRARY_ENTRY_REQUESTED} See ${libraryHelpAnchor('library-not-in-build')}.`,
} as const

/** The webpack layer a library refusal is worded for: a Pages server or browser layer, the App Router browser layer, or the App Router server layer `rsc` (the same values as `LibraryStopLayer` in `sealLibraryStop.ts` plus `rsc`, repeated so this module imports nothing from it). */
type LibraryRefusalLayer =
  'pages-dir-node' | 'pages-dir-browser' | 'app-pages-browser' | 'rsc'

/**
 * Picks the recovery of a layer-worded library refusal; called by {@link libraryNotInBuildRefusal} and {@link libraryBuildChangedFailure}.
 * @param reason - The refusal reason with a browser-layer variant.
 * @param layer - The layer the refusal is raised for.
 * @returns The browser variant for `pages-dir-browser`, else the server text of {@link LIBRARY_RECOVERIES}.
 * @example pagesLibraryRecoveryOf('library-not-in-build', 'pages-dir-node') // => LIBRARY_RECOVERIES['library-not-in-build']
 */
function pagesLibraryRecoveryOf(
  reason: keyof typeof BROWSER_LIBRARY_RECOVERIES,
  layer: LibraryRefusalLayer,
): string {
  if (layer === 'app-pages-browser')
    return APP_BROWSER_LIBRARY_RECOVERIES[reason]
  if (layer === 'rsc') return APP_SERVER_LIBRARY_RECOVERIES[reason]
  return layer === 'pages-dir-browser'
    ? BROWSER_LIBRARY_RECOVERIES[reason]
    : LIBRARY_RECOVERIES[reason]
}

/**
 * The static recovery of each library refusal under `vite-dev` (a nested Vite app's browser stop in a workspace library), keyed by `details.reason`. The stale and unmapped bodies are the Next ones; the endings say what a Vite run had started.
 * `library-place-ambiguous` is never raised under `vite-dev`, so it keeps the Next text.
 */
const VITE_LIBRARY_RECOVERIES = {
  ...LIBRARY_RECOVERIES,
  'library-build-stale': `${LIBRARY_STALE_BODY} ${LIBRARY_VITE_BEFORE_BROWSER} See ${libraryHelpAnchor('library-build-stale')}.`,
  'library-build-unmapped': `${LIBRARY_UNMAPPED_BODY} When details.cause is lazy-import the library module is loaded only by the operation itself: declare the stop in code the entry page runs at load, or tell the learner; the browser had then loaded the entry page and details.sideEffects is unknown. For every other cause: ${LIBRARY_VITE_BEFORE_BROWSER} See ${libraryHelpAnchor('library-build-unmapped')}.`,
  'library-not-in-build': `The modules the entry page loads do not hold exactly one served module of the library that maps the stop (details.candidates lists the module URLs when more than one matches). Tell the learner, or choose a stop in code the entry page runs from its own modules; do not start another run with the same stop. ${LIBRARY_VITE_BEFORE_BROWSER} See ${libraryHelpAnchor('library-not-in-build')}.`,
  'library-build-changed': `The library's served module changed during the run (a rebuild, or a hot update of the module). Tell the learner to finish the rebuild and ask for a new start; never run the build yourself. ${LIBRARY_VITE_BROWSER_OPENED} See ${libraryHelpAnchor('library-build-changed')}.`,
} as const

/** The `details.reason` values {@link LIBRARY_RECOVERIES} answers. */
export type LibraryRecoveryReason = keyof typeof LIBRARY_RECOVERIES

/**
 * Gives the static recovery of a library refusal reason.
 *
 * Why it exists: the refusal builders and {@link refusalFailureOf} must give the agent the same recovery whether the refusal was thrown or restored from a run's failure text.
 * @param reason - A library refusal `details.reason`.
 * @param adapter - The adapter whose run raised it: the endings differ in what had started (`next` by default, `vite` for a nested Vite app's browser stop).
 * @param router - The router of a Next app (`details.router`): an App Router `library-not-in-build` names the client chunks of the entry route's client reference manifest, as the thrown refusal does; `app-server` (from {@link libraryRecoveryRouterOfFailure}) names the entry route's server compile and its `(rsc)` modules; `pages` by default.
 * @returns The static recovery text, ending at the reason's own help anchor.
 * @example
 * libraryRecoveryOf('library-build-stale') // => "A workspace library's build does not match … See codebook://help/repository-browser#library-build-stale."
 * libraryRecoveryOf('library-not-in-build', 'next', 'app') // => "The client chunks of the entry route's client reference manifest do not hold … See codebook://help/repository-browser#library-not-in-build."
 */
export function libraryRecoveryOf(
  reason: LibraryRecoveryReason,
  adapter: 'next' | 'vite' = 'next',
  router: 'pages' | 'app' | 'app-server' = 'pages',
): string {
  if (adapter === 'vite') return VITE_LIBRARY_RECOVERIES[reason]
  // Only the refusal that names the searched code has an App Router wording; every other reason reads the same for both routers.
  if (router === 'app-server' && reason === 'library-not-in-build')
    return APP_SERVER_LIBRARY_RECOVERIES[reason]
  if (router !== 'pages' && reason === 'library-not-in-build')
    return APP_BROWSER_LIBRARY_RECOVERIES[reason]
  return LIBRARY_RECOVERIES[reason]
}

/** Why a library's build could not be matched to a stop file; the `details.cause` of a `library-build-unmapped` refusal. `prebundled` and `lazy-import` are raised only under `vite-dev`. */
export type LibraryBuildUnmappedCause =
  | 'no-map'
  | 'no-content'
  | 'no-line'
  | 'malformed'
  | 'bound'
  | 'deadline'
  | 'prebundled'
  | 'lazy-import'

/**
 * Builds the refusal of a library stop whose build is older than (or otherwise differs from) the checked-out source, raised by {@link freezeLibraryBuild} before any process starts.
 * @param packageRoot - The Next app's canonical repository-relative package root.
 * @param libraryName - The library's package name (`package.json` `name`).
 * @param file - The repository-relative stop file.
 * @returns The `NEXT_STOP_NOT_SEALED` error: `details.reason: "library-build-stale"`, `sideEffects: "none"`, a message that names the build to run.
 * @example
 * throw libraryBuildStaleRefusal('examples/react/nextjs', '@scope/core', 'packages/core/src/a.ts')
 */
export function libraryBuildStaleRefusal(
  packageRoot: string,
  libraryName: string,
  file: string,
): StudyError {
  const message = `The build of library ${libraryName} does not match the checked-out ${file} (its source map's sourcesContent differs), so a stop there was refused before the server started for packageRoot ${packageRoot}. Run the build script of library ${libraryName} yourself, then start again; Codebook never builds.`
  return nextRefusal('NEXT_STOP_NOT_SEALED', message, {
    details: {
      reason: 'library-build-stale',
      packageRoot,
      library: libraryName,
      file,
      sideEffects: 'none',
    },
    recovery: LIBRARY_RECOVERIES['library-build-stale'],
  })
}

/**
 * Builds the refusal of a library stop whose build has no source map that can carry the stop, raised by {@link freezeLibraryBuild} before any process starts.
 * @param packageRoot - The Next app's canonical repository-relative package root.
 * @param libraryName - The library's package name (`package.json` `name`).
 * @param file - The repository-relative stop file.
 * @param cause - Why the build cannot carry the stop.
 * @returns The `NEXT_STOP_NOT_SEALED` error: `details.reason: "library-build-unmapped"`, `details.cause`, `sideEffects: "none"`.
 * @example
 * throw libraryBuildUnmappedRefusal('examples/react/nextjs', '@scope/core', 'packages/core/src/a.ts', 'no-map')
 */
export function libraryBuildUnmappedRefusal(
  packageRoot: string,
  libraryName: string,
  file: string,
  cause: LibraryBuildUnmappedCause,
): StudyError {
  const message = `The build of library ${libraryName} has no usable source map for ${file} (${cause}), so a stop there was refused before the server started for packageRoot ${packageRoot}. Codebook never builds; the library must be built with source maps that include sourcesContent.`
  return nextRefusal('NEXT_STOP_NOT_SEALED', message, {
    details: {
      reason: 'library-build-unmapped',
      cause,
      packageRoot,
      library: libraryName,
      file,
      sideEffects: 'none',
    },
    recovery: LIBRARY_RECOVERIES['library-build-unmapped'],
  })
}

/** The `details.reason` values of the library refusals that come after Codebook's readiness request (`sideEffects: "unknown"`). */
const LIBRARY_RUNTIME_REASONS = [
  'library-not-in-build',
  'library-place-ambiguous',
  'library-build-changed',
] as const

/** One of {@link LIBRARY_RUNTIME_REASONS}. */
type LibraryRuntimeReason = (typeof LIBRARY_RUNTIME_REASONS)[number]

/**
 * Builds the refusal of a library stop whose page server compile holds none, or more than one, of the built files that map the stop, raised by the library seal after the readiness request.
 * @param packageRoot - The Next app's canonical repository-relative package root.
 * @param libraryName - The library's package name.
 * @param file - The repository-relative stop file.
 * @param candidates - The built files that map the stop, repository-relative; named in the message.
 * @param layer - The webpack layer the seal searched; `pages-dir-browser` words the message and recovery by the entry chunks the page loads at start, `app-pages-browser` by the client chunks of the entry route's client reference manifest and `rsc` by the entry route's server compile, counting `(rsc)` modules only (both carry `router: "app"` and, when given, `mapSource`), the default `pages-dir-node` by the server compile.
 * @param mapSource - The path the one module's map named, when the module was found but its map does not name the stop's checked-out file (`app-pages-browser` and `rsc` only).
 * @returns The `NEXT_STOP_NOT_SEALED` error: `details.reason: "library-not-in-build"`, `details.candidates`, the stop details (`sideEffects: "unknown"`; `router: "app"` and `mapSource` when the layer is `app-pages-browser` or `rsc`).
 * @example
 * throw libraryNotInBuildRefusal('examples/app', 'lib', 'packages/lib/src/core.ts', ['packages/lib/build/modern/core.js', 'packages/lib/build/legacy/core.js'])
 */
export function libraryNotInBuildRefusal(
  packageRoot: string,
  libraryName: string,
  file: string,
  candidates: readonly string[],
  layer: LibraryRefusalLayer = 'pages-dir-node',
  mapSource?: string,
): StudyError {
  const list = candidates.join(', ') || 'none'
  const message =
    layer === 'rsc'
      ? `The build of library ${libraryName} matches ${file}, but the server compile of the entry route does not hold exactly one \`(rsc)\` module of its candidates (${list}) whose map names the checked-out file, so a stop there cannot be sealed for packageRoot ${packageRoot}. The \`(ssr)\` copy of a module is another layer's and never counts. A library module the server loads later or never loads cannot be sealed.`
      : layer === 'app-pages-browser'
        ? `The build of library ${libraryName} matches ${file}, but the client chunks of the entry route's client reference manifest do not hold exactly one of its candidates (${list}) whose map names the checked-out file, so a stop there cannot be sealed for packageRoot ${packageRoot}. A library module the page loads later (\`next/dynamic\`, a lazy import) cannot be sealed.`
        : layer === 'pages-dir-browser'
          ? `The build of library ${libraryName} matches ${file}, but the entry chunks of the route and \`_app\` that the page loads at start do not hold exactly one of its candidates (${list}), so a stop there cannot be sealed for packageRoot ${packageRoot}. A library module the page loads later (\`next/dynamic\`, a lazy import) cannot be sealed.`
          : `The build of library ${libraryName} matches ${file}, but the server compile of the page does not hold exactly one of its candidates (${list}), so a stop there cannot be sealed for packageRoot ${packageRoot}. The page's server code may load another build, or may not run that file.`
  return nextRefusal('NEXT_STOP_NOT_SEALED', message, {
    details: {
      reason: 'library-not-in-build',
      packageRoot,
      library: libraryName,
      file,
      candidates: [...candidates],
      ...PAGES_STOP_REFUSAL_DETAILS,
      ...(layer === 'app-pages-browser' || layer === 'rsc'
        ? { router: 'app', ...(mapSource === undefined ? {} : { mapSource }) }
        : {}),
    },
    recovery: pagesLibraryRecoveryOf('library-not-in-build', layer),
  })
}

/**
 * Builds the refusal of a library stop whose bound place cannot be tied to the declared source line, raised when the debugger binds the stop.
 * @param packageRoot - The Next app's canonical repository-relative package root.
 * @param libraryName - The library's package name.
 * @param file - The repository-relative stop file.
 * @param line - The declared (armed) source line.
 * @param why - A short value-free reason for the message.
 * @param router - The router of the app (`app` for a browser stop sealed in source terms in an App Router app); `pages` by default.
 * @param sideEffects - `none` for a refusal raised at the freeze, before any process starts; `unknown` (default) once the owned server answered the entry request.
 * @returns The `NEXT_STOP_NOT_SEALED` error: `details.reason: "library-place-ambiguous"`, the stop details (`router: "app"` when raised for an App Router app, else `pages`; `sideEffects` as given).
 * @example
 * throw libraryPlaceAmbiguousRefusal('examples/app', 'lib', 'packages/lib/src/core.ts', 3, 'the bound line maps to several source lines')
 */
export function libraryPlaceAmbiguousRefusal(
  packageRoot: string,
  libraryName: string,
  file: string,
  line: number,
  why: string,
  router: 'pages' | 'app' = 'pages',
  sideEffects: 'none' | 'unknown' = 'unknown',
): StudyError {
  const message = `The stop at ${file}:${line} in library ${libraryName} could not be tied to one source position (${why}) for packageRoot ${packageRoot}. Declare the stop on a line that holds a single statement.`
  return nextRefusal('NEXT_STOP_NOT_SEALED', message, {
    details: {
      reason: 'library-place-ambiguous',
      packageRoot,
      library: libraryName,
      file,
      sideEffects,
      router,
    },
    recovery: LIBRARY_RECOVERIES['library-place-ambiguous'],
  })
}

/**
 * Builds the failure of a library whose build changed after the freeze: a module instance carries built text other than the frozen one.
 * @param packageRoot - The Next app's canonical repository-relative package root.
 * @param libraryName - The library's package name.
 * @param file - The repository-relative stop file.
 * @param router - The router of the app (`app` for a browser stop sealed in source terms in an App Router app); `pages` by default.
 * @returns The `RUNTIME_FAILED` error: `details.reason: "library-build-changed"`, the stop details (`sideEffects: "unknown"`; `router: "app"` when raised for an App Router app).
 * @example
 * throw libraryBuildChangedFailure('examples/app', 'lib', 'packages/lib/src/core.ts')
 */
export function libraryBuildChangedFailure(
  packageRoot: string,
  libraryName: string,
  file: string,
  router: 'pages' | 'app' = 'pages',
): StudyError {
  const message = `The build of library ${libraryName} changed while the run was open (a module instance for ${file} carries other built text than the one checked before the start), so Codebook stopped it for packageRoot ${packageRoot}. Finish the rebuild yourself and start again; Codebook never builds.`
  return new StudyError(
    'RUNTIME_FAILED',
    message,
    message,
    LIBRARY_RECOVERIES['library-build-changed'],
    undefined,
    {
      reason: 'library-build-changed',
      packageRoot,
      library: libraryName,
      file,
      ...PAGES_STOP_REFUSAL_DETAILS,
      router,
    },
  )
}

/**
 * Writes the failure text a run records for a library refusal raised at a pause or an event, the form {@link refusalFailureOf} restores with its `details.reason`.
 * @param error - The error a library check threw.
 * @returns `<CODE>(<reason>): <message>` for a Next Pages library refusal of {@link LIBRARY_RUNTIME_REASONS} (one carrying `details.router`), `<CODE>(<reason> app): <message>` for an App Router one so {@link libraryDetailsOfFailure} restores `router: "app"` (`<reason> app rsc` for a `library-not-in-build` of the server layer, which {@link libraryRecoveryRouterOfFailure} reads); `undefined` for any other error, a Vite library error included.
 * @example
 * libraryFailureText(libraryBuildChangedFailure('examples/app', 'lib', 'a.ts')) // => 'RUNTIME_FAILED(library-build-changed): The build of library lib changed …'
 * libraryFailureText(libraryBuildChangedFailure('examples/app', 'lib', 'a.ts', 'app')) // => 'RUNTIME_FAILED(library-build-changed app): The build of library lib changed …'
 */
export function libraryFailureText(error: unknown): string | undefined {
  if (!(error instanceof StudyError)) return undefined
  // Only a Next Pages library error carries `router`; a Vite library error with the same reason belongs to {@link viteLibraryFailureText}.
  if (error.details?.router === undefined) return undefined
  const reason = LIBRARY_RUNTIME_REASONS.find(
    (known) => known === error.details?.reason,
  )
  if (reason === undefined) return undefined
  // An App Router failure names its router in the variant, and a `library-not-in-build` of the server layer `rsc` its layer too (it words another recovery); the Pages text stays unchanged.
  const isServerLayer =
    reason === 'library-not-in-build' &&
    error.recoveryOverride === APP_SERVER_LIBRARY_RECOVERIES[reason]
  const variant = isServerLayer
    ? `${reason}${APP_SERVER_LIBRARY_VARIANT_SUFFIX}`
    : error.details.router === 'app'
      ? `${reason}${APP_LIBRARY_VARIANT_SUFFIX}`
      : reason
  return `${error.code}(${variant}): ${error.message}`
}

/** The suffix a library reason variant carries for an App Router app (`library-build-changed app`); no parenthesis and no line break, so the lead of a coded failure text still matches. */
const APP_LIBRARY_VARIANT_SUFFIX = ' app'

/** The suffix a `library-not-in-build` variant carries for the App Router server layer `rsc` (`library-not-in-build app rsc`); a text with only {@link APP_LIBRARY_VARIANT_SUFFIX} stays the browser layer. */
const APP_SERVER_LIBRARY_VARIANT_SUFFIX = ' app rsc'

/** The `details` a restored library failure text carries: the reason, the router the variant named and `sideEffects: "unknown"`. */
type LibraryFailureDetails = {
  reason: LibraryRuntimeReason
  router: 'pages' | 'app'
  sideEffects: 'unknown'
}

/**
 * Restores the details of a coded failure text led by a library reason variant.
 * @param code - The text's code.
 * @param variant - The text's variant: a library reason, followed by ` app` for an App Router app ({@link libraryFailureText} writes both).
 * @returns The library reason with the router (`pages` unless the variant ends in ` app`) and `sideEffects: "unknown"` when the code and variant are a library refusal; `undefined` otherwise.
 * @example
 * libraryDetailsOfFailure('RUNTIME_FAILED', 'library-build-changed') // => { reason: 'library-build-changed', router: 'pages', sideEffects: 'unknown' }
 * libraryDetailsOfFailure('RUNTIME_FAILED', 'library-build-changed app') // => { reason: 'library-build-changed', router: 'app', sideEffects: 'unknown' }
 */
export function libraryDetailsOfFailure(
  code: string,
  variant: string | undefined,
): LibraryFailureDetails | undefined {
  const isServerLayer =
    variant?.endsWith(APP_SERVER_LIBRARY_VARIANT_SUFFIX) === true
  const isApp =
    isServerLayer || variant?.endsWith(APP_LIBRARY_VARIANT_SUFFIX) === true
  const name = isServerLayer
    ? variant.slice(0, -APP_SERVER_LIBRARY_VARIANT_SUFFIX.length)
    : isApp
      ? variant.slice(0, -APP_LIBRARY_VARIANT_SUFFIX.length)
      : variant
  const reason = LIBRARY_RUNTIME_REASONS.find((known) => known === name)
  const expected =
    reason === 'library-build-changed'
      ? 'RUNTIME_FAILED'
      : 'NEXT_STOP_NOT_SEALED'
  return reason !== undefined && code === expected
    ? { reason, ...PAGES_STOP_REFUSAL_DETAILS, router: isApp ? 'app' : 'pages' }
    : undefined
}

/**
 * Reads which recovery wording a library failure text's variant selects, for {@link libraryRecoveryOf}.
 *
 * Why it exists: the `details` a text restores hold only the router, but a `library-not-in-build` of the App Router server layer words another recovery than the browser layer. Called by {@link refusalFailureOf}.
 * @param variant - The text's variant ({@link libraryFailureText} writes it).
 * @returns `app-server` for a variant ending in ` app rsc`, `app` for one ending in ` app`, else `pages`.
 * @example
 * libraryRecoveryRouterOfFailure('library-not-in-build app rsc') // => 'app-server'
 * libraryRecoveryRouterOfFailure('library-not-in-build app') // => 'app'
 */
export function libraryRecoveryRouterOfFailure(
  variant: string | undefined,
): 'pages' | 'app' | 'app-server' {
  if (variant?.endsWith(APP_SERVER_LIBRARY_VARIANT_SUFFIX)) return 'app-server'
  return variant?.endsWith(APP_LIBRARY_VARIANT_SUFFIX) ? 'app' : 'pages'
}

/**
 * The structured fields every Pages stop refusal after the owned server started carries: `router: "pages"` tells an agent a Pages `client-component` refusal from the App Router one without parsing prose, and `sideEffects: "unknown"` says the page's data function already ran once during Codebook's readiness request, so another start is the learner's decision when that function writes.
 * Spread into the `details` of {@link nextRefusal} by the seal and the stop checks of a Pages run.
 */
export const PAGES_STOP_REFUSAL_DETAILS = {
  router: 'pages',
  sideEffects: 'unknown',
} as const

/**
 * The variant a Pages run's `NEXT_ENTRY_REDIRECTED` failure text carries (`NEXT_ENTRY_REDIRECTED(pages): …`), so the fields of {@link PAGES_STOP_REFUSAL_DETAILS} survive the text a timer or an event records.
 * Written by {@link ConfiguredBrowserRun} when it records a redirect of a Pages entry (the entry load left the entry path, or the page left it before the click), and read by {@link refusalFailureOf} when it restores the text.
 */
export const NEXT_PAGES_FAILURE_VARIANT = 'pages'

/** The type of {@link NEXT_PAGES_FAILURE_VARIANT}, which {@link formatRefusalFailure} accepts for `NEXT_ENTRY_REDIRECTED`. */
export type NextPagesFailureVariant = typeof NEXT_PAGES_FAILURE_VARIANT

/**
 * The recovery of a Next run whose readiness check failed with an error of its own after the request was sent: no answer came (the connection broke), or, in an App Router run, the answer was not OK. The request runs the entry page's server code, so what it changed is not known.
 * It names fields, never values: it is passed as the {@link StudyError} recovery override, which reaches MCP without the sanitizer.
 */
export const READINESS_FAILURE_RECOVERY =
  "Codebook's own readiness request for the entry path ran the page's server code (a data function, server components) before any stop was armed, and it did not end with an OK answer: read readinessRequest in the run resource, which holds the HTTP status of an answer that is not OK, or the outcome when no answer came. When that code writes or sends (a database write, a counter, an email, a payment call), it may have run: details.sideEffects is unknown, not none. Tell the learner, ask before another start, and never start again unasked. No declared input and no click was sent; Codebook stops the server it started (read resourcesReleased in the run resource). See codebook://help/repository-browser#readiness.entry-request."

/**
 * The sentence a setup deadline's recovery starts with once Codebook's readiness request was sent: the request ran the entry page's server code before the deadline, so the learner decides another start when that code writes.
 * It names fields, never values: {@link withSetupDeadlineSideEffects} puts it before the deadline's own static recovery in the {@link StudyError} recovery override, which reaches MCP without the sanitizer.
 */
export const SETUP_DEADLINE_AFTER_READINESS_RECOVERY =
  "Codebook's own readiness request for the entry path ran the page's server code (a data function, server components) before this deadline, so details.sideEffects is unknown, not none (details.readinessRequest holds the HTTP status, or outcome timeout when the deadline came before an answer). When that code writes or sends (a database write, a counter, an email, a payment call), tell the learner and ask before any new start, and never start again unasked; the rest of this recovery applies once the learner agrees, or when that code writes and sends nothing."

/** The failure text of a Next run's setup deadline that carries no Next code: a run whose entry resolved as an App route, or a workspace without a Pages folder. */
export const UNCODED_SETUP_DEADLINE_TEXT = 'Repository setup deadline exceeded'

/** The side-effect sentence of a Pages setup deadline once the browser Codebook opened was closed: no input and no click went out. */
const BROWSER_CLOSED_NOTHING_SENT =
  'The browser Codebook opened was closed and no input or click was sent; Codebook stops the server it started (read resourcesReleased in the run resource).'

/** The anchor sentence every `NEXT_SETUP_DEADLINE` recovery ends with. */
const SETUP_DEADLINE_ANCHOR =
  'See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.'

/**
 * The static recovery of a `NEXT_SETUP_DEADLINE`, per variant of the step the run had reached.
 * Each text names fields, never values: it is passed as the {@link StudyError} recovery override, which reaches MCP without the sanitizer the message and cause pass through.
 */
const NEXT_SETUP_DEADLINE_RECOVERIES = {
  'before-browser': `Start once more with a new key (the first compile is warm after it); a second deadline means the project does not start in time for Codebook, so tell the learner the step the message names. Recovery: one retry, then the learner. The owned server was stopped; no browser was opened; no input was sent (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
  'browser-opened': `Start once more with a new key (the first compile of the page is warm after it); a second deadline means the entry page does not load in time, so tell the learner the step the message names. Recovery: one retry, then the learner. ${BROWSER_CLOSED_NOTHING_SENT} ${SETUP_DEADLINE_ANCHOR}`,
  'router-absent': `Tell the learner the page at entryPath is not a Next Pages page: it exposes no Next router. Set entryPath to the Pages page the question is about, then one new start; never retry with the same entryPath. Recovery: fix the configuration, then one new start. ${BROWSER_CLOSED_NOTHING_SENT} ${SETUP_DEADLINE_ANCHOR}`,
  'router-late': `Start once more with a new key (the first compile of the page is warm after it); a second deadline means the page router does not become ready in time, so tell the learner. Recovery: one retry, then the learner. ${BROWSER_CLOSED_NOTHING_SENT} ${SETUP_DEADLINE_ANCHOR}`,
  inputs: `Check the input selector the message names against the entry page, then start once more with a new key; a second deadline means the page does not take that input in time, so tell the learner. Recovery: one retry, then the learner. The inputs before the one the message names were written and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
  arming: `Start once more with a new key (the first compile of the page is warm after it); a second deadline means the page does not get ready in time to arm the first stop, so tell the learner. Recovery: one retry, then the learner. Every declared initial input was written (or there were none) and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
  'input-outcome-unknown': `Read the run's captured history before any new start: the reply to the input the message names was lost, so that input may have been written. Tell the learner, and start a new run only if the learner asks. Recovery: read, never resend. An input may have been written and no click was sent; the browser Codebook opened was closed and Codebook stops the server it started (read resourcesReleased in the run resource). ${SETUP_DEADLINE_ANCHOR}`,
} as const

/** One variant of a `NEXT_SETUP_DEADLINE`, which chooses its static recovery ({@link nextSetupDeadlineRecovery}). */
export type NextSetupDeadlineVariant =
  keyof typeof NEXT_SETUP_DEADLINE_RECOVERIES

/**
 * Gives the static recovery of a `NEXT_SETUP_DEADLINE` variant, or nothing for a name that is no variant.
 *
 * Why it exists: the failure text of a deadline carries its variant as text (`NEXT_SETUP_DEADLINE(<variant>): …`), and a name read back from text is untrusted, so only a known name selects a recovery. Called by {@link refusalFailureOf} when it restores a deadline from a run's failure text.
 * @param variant - The variant name as read from a failure text.
 * @returns
 * - The variant's static recovery for a known name
 * - `undefined` for any other text
 * @example
 * nextSetupDeadlineRecovery('router-absent') // => 'Tell the learner the page at entryPath is not a Next Pages page: … See codebook://help/repository-browser#NEXT_SETUP_DEADLINE.'
 * nextSetupDeadlineRecovery('router-gone')   // => undefined
 */
export function nextSetupDeadlineRecovery(variant: string): string | undefined {
  return Object.entries(NEXT_SETUP_DEADLINE_RECOVERIES).find(
    ([name]) => name === variant,
  )?.[1]
}

/** Where a setup step stands relative to the browser and the page, the part of the deadline's variant the step alone decides. */
type NextSetupStage =
  'before-browser' | 'browser-opened' | 'router' | 'inputs' | 'arming'

/** What a setup deadline says about the browser per step, and the stage that chooses its variant. A record, so a new step cannot be added without choosing both. */
const NEXT_SETUP_STEP_FACTS: Record<
  NextSetupStep,
  { browserState: string; stage: NextSetupStage }
> = {
  [NEXT_SETUP_STEPS.validatingProject]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.startingNext]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.waitingForServer]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.readingManifests]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.sealingStops]: {
    browserState: 'the browser was not opened',
    stage: 'before-browser',
  },
  [NEXT_SETUP_STEPS.openingBrowser]: {
    browserState:
      'the browser Codebook was opening was closed and no input or click was sent',
    stage: 'browser-opened',
  },
  [NEXT_SETUP_STEPS.loadingEntryPage]: {
    browserState:
      'the browser Codebook opened was closed and no input or click was sent',
    stage: 'browser-opened',
  },
  [NEXT_SETUP_STEPS.waitingForRouter]: {
    browserState:
      'the browser Codebook opened was closed and no input or click was sent',
    stage: 'router',
  },
  [NEXT_SETUP_STEPS.writingInputs]: {
    browserState:
      'the browser Codebook opened was closed and no click was sent',
    stage: 'inputs',
  },
  [NEXT_SETUP_STEPS.armingFirstStop]: {
    browserState:
      'the browser Codebook opened was closed and no click was sent',
    stage: 'arming',
  },
}

/**
 * Chooses the `NEXT_SETUP_DEADLINE` variant of the step a Pages run had reached, so its static recovery fits what had already run.
 *
 * Why it exists: the recovery class depends on the step (a retry before the browser, a fixed `entryPath` for a page with no Next router, reading the history when an input may have been written), and the recovery must stay static. Called by the configured browser run when the setup deadline of a Pages run expires, beside {@link nextSetupDeadlineSentence}.
 * @param step - The setup step reached, one of {@link NEXT_SETUP_STEPS}.
 * @param routerState - At the router step: whether `window.next.router` was never seen (`absent`, also when not given) or never turned ready (`late`).
 * @param inputOutcomeUnknown - At the input step: whether an input was dispatched and its reply was lost.
 * @returns
 * - `before-browser` for the steps up to sealing the stops
 * - `browser-opened` while opening the browser or loading the entry page
 * - `router-absent` or `router-late` at the router step
 * - `inputs`, or `input-outcome-unknown` when an input's outcome is unknown, at the input step
 * - `arming` once every input was written, while the first stop is armed
 * @example
 * nextSetupDeadlineVariantOf(NEXT_SETUP_STEPS.sealingStops) // => 'before-browser'
 * nextSetupDeadlineVariantOf(NEXT_SETUP_STEPS.waitingForRouter, 'late') // => 'router-late'
 * nextSetupDeadlineVariantOf(NEXT_SETUP_STEPS.writingInputs, undefined, true) // => 'input-outcome-unknown'
 */
export function nextSetupDeadlineVariantOf(
  step: NextSetupStep,
  routerState?: NextRouterState,
  inputOutcomeUnknown = false,
): NextSetupDeadlineVariant {
  const { stage } = NEXT_SETUP_STEP_FACTS[step]
  // A router never seen counts as absent: only a router that was seen and never turned ready is late.
  if (stage === 'router')
    return routerState === 'late' ? 'router-late' : 'router-absent'
  if (stage === 'inputs')
    return inputOutcomeUnknown ? 'input-outcome-unknown' : 'inputs'
  return stage
}

/**
 * Words the clause of a setup deadline that only the router step and the input step have: the router case, or the input being written.
 * @param stage - The stage of the step reached.
 * @param budgetSeconds - The setup budget in whole seconds.
 * @param routerState - What the router wait saw, at the router step.
 * @param pendingInputSelector - The selector of the input being written, at the input step.
 * @returns The clause, led by a colon or a comma, or an empty text when the step has none.
 * @example
 * stepDetail('router', 90, 'absent', undefined) // => ': the page exposes no Next router (window.next.router is absent)'
 * stepDetail('inputs', 90, undefined, '#email') // => ', at the input #email (the inputs before it were written)'
 */
function stepDetail(
  stage: NextSetupStage,
  budgetSeconds: number,
  routerState: NextRouterState | undefined,
  pendingInputSelector: string | undefined,
): string {
  if (stage === 'router' && routerState === 'absent')
    return ': the page exposes no Next router (window.next.router is absent)'
  if (stage === 'router' && routerState === 'late')
    return `: the router did not become ready within ${budgetSeconds} s`
  if (stage === 'inputs' && pendingInputSelector !== undefined)
    return `, at the input ${pendingInputSelector} (the inputs before it were written)`
  return ''
}

/**
 * Words the setup-deadline sentence of a Next Pages run without its code, naming the budget, the step it reached and what happened to the browser.
 *
 * Why it exists: a deadline expiry has no thrown error, so the run's timer builds this text and leads it with its code and variant ({@link formatRefusalFailure}); it mirrors {@link viteSetupDeadlineSentence}. Called by the configured browser run when a Pages run's setup budget expires.
 * @param step - The setup step reached, one of {@link NEXT_SETUP_STEPS}.
 * @param budgetMs - The setup budget that expired.
 * @param routerState - At the router step: `absent` when the page exposes no `window.next.router`, `late` when it never turned ready; ignored at any other step.
 * @param pendingInputSelector - At the input step: the selector of the input being written, whose earlier inputs were written; ignored at any other step.
 * @returns The sentence; the dynamic values (the step, the budget, the selector) stay in this message, never in the recovery.
 * @example
 * nextSetupDeadlineSentence(NEXT_SETUP_STEPS.waitingForRouter, 90_000, 'absent')
 * // => 'Repository setup deadline (90 s) exceeded while waiting for the page router to become ready before sending the declared input or click: the page exposes no Next router (window.next.router is absent). Codebook stopped the server it started; the browser Codebook opened was closed and no input or click was sent.'
 */
export function nextSetupDeadlineSentence(
  step: NextSetupStep,
  budgetMs: number,
  routerState?: NextRouterState,
  pendingInputSelector?: string,
): string {
  const { browserState, stage } = NEXT_SETUP_STEP_FACTS[step],
    budgetSeconds = Math.round(budgetMs / MILLISECONDS_PER_SECOND)
  const detail = stepDetail(
    stage,
    budgetSeconds,
    routerState,
    pendingInputSelector,
  )
  return `Repository setup deadline (${budgetSeconds} s) exceeded while ${step}${detail}. Codebook stopped the server it started; ${browserState}.`
}
