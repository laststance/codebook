import { StudyError, type ErrorCode } from './errors'
import { encodeViteLibraryVariant } from './utils/viteLibraryFailureIdentity'

/**
 * The stable codes the `static-page` adapter and its CDN import redirect refuse with, in the order of the groups of the agent-ready contract:
 * unsupported page, server failure, seal failure and the declared library's missing file.
 * The help writer lists one anchor per entry.
 */
export const STATIC_PAGE_REFUSAL_CODES = [
  'STATIC_PAGE_UNSUPPORTED',
  'STATIC_PAGE_SERVER_FAILED',
  'STATIC_PAGE_SEAL_FAILED',
  'REPOSITORY_BROWSER_LIBRARY_REFUSED',
] as const satisfies readonly ErrorCode[]

/** One code of {@link STATIC_PAGE_REFUSAL_CODES}. */
export type StaticPageRefusalCode = (typeof STATIC_PAGE_REFUSAL_CODES)[number]

/**
 * The help anchor of a refusal code: `codebook://help/repository-browser#<CODE>`.
 * @param code - A refusal code.
 * @returns The resource address with the code as its anchor.
 * @example
 * staticPageHelpAnchor('STATIC_PAGE_SEAL_FAILED') // => 'codebook://help/repository-browser#STATIC_PAGE_SEAL_FAILED'
 */
export function staticPageHelpAnchor(code: StaticPageRefusalCode): string {
  return `codebook://help/repository-browser#${code}`
}

/** Whether nothing started (`none`) or a server started and was stopped (`partial`). */
type StaticPageSideEffects = 'none' | 'partial'

/** The sentence that ends every recovery: the fix needs one new start, and where the help for the code lives. */
function recoveryEnd(code: StaticPageRefusalCode): string {
  return `Recovery: fix it, then one new start. See ${staticPageHelpAnchor(code)}.`
}

/**
 * Builds a refusal of the `static-page` adapter: a {@link StudyError} whose recovery is the static sentence given and whose details carry the reason and side effects.
 *
 * Why it exists: every builder below shares the shape of {@link reactScriptsRefusal}, so one place assembles it. Called by each builder in this module.
 * @param code - The refusal code.
 * @param message - What was refused; names files and lines, never page text.
 * @param recovery - The static recovery; names fields, never values.
 * @param details - The structured fields, `reason` and `sideEffects` included.
 * @returns The error to throw.
 * @example
 * staticPageRefusal('STATIC_PAGE_UNSUPPORTED', 'No.', 'Fix it.', { reason: 'no-entry-page', sideEffects: 'none' }).code // => 'STATIC_PAGE_UNSUPPORTED'
 */
function staticPageRefusal(
  code: StaticPageRefusalCode,
  message: string,
  recovery: string,
  details: Readonly<Record<string, unknown>>,
): StudyError {
  return new StudyError(code, message, message, recovery, undefined, details)
}

/**
 * Builds the `STATIC_PAGE_UNSUPPORTED` refusal of a folder that has no entry page.
 * @param entry - The entry file the run looked for, relative to the page folder (`index.html` for the default entry path).
 * @returns The refusal: `details.reason: "no-entry-page"`, `entry` and `sideEffects: "none"`.
 * @example
 * staticPageNoEntryRefusal('index.html').details?.reason // => 'no-entry-page'
 */
export function staticPageNoEntryRefusal(entry: string): StudyError {
  return staticPageRefusal(
    'STATIC_PAGE_UNSUPPORTED',
    `The page folder has no ${entry}, so there is no page to serve; nothing was started.`,
    `Set packageRoot to the folder that holds the page and entryPath to its .html file inside that folder (details.entry is the file that was missing), or tell the learner this folder is not a plain page. ${recoveryEnd('STATIC_PAGE_UNSUPPORTED')}`,
    { reason: 'no-entry-page', entry, sideEffects: 'none' },
  )
}

/**
 * Builds the `STATIC_PAGE_UNSUPPORTED` refusal of a page that needs a bundler: a reference to a file that is not in the folder, or a bare-specifier import.
 * @param reference - The first offending reference as the page wrote it, cut to one short line.
 * @param kind - `missing-file` for a `<script src>` or `<link href>` naming an absent file, `bare-import` for an import only a bundler resolves.
 * @returns The refusal: `details.reason: "needs-bundler"`, `reference`, `kind` and `sideEffects: "none"`.
 * @example
 * staticPageNeedsBundlerRefusal('/src/main.tsx', 'missing-file').details?.reference // => '/src/main.tsx'
 */
export function staticPageNeedsBundlerRefusal(
  reference: string,
  kind: 'missing-file' | 'bare-import',
): StudyError {
  const problem =
    kind === 'missing-file'
      ? `names ${reference}, a file that does not exist in the page folder`
      : `imports ${reference}, a bare specifier only a bundler resolves`
  return staticPageRefusal(
    'STATIC_PAGE_UNSUPPORTED',
    `The page ${problem}, so it needs a bundler and Codebook serves only a page whose files exist as written; nothing was started.`,
    `Tell the learner the page needs a bundler (details.reference is the first reference that does), so this version cannot serve it; never edit the project or run its bundler yourself. ${recoveryEnd('STATIC_PAGE_UNSUPPORTED')}`,
    { reason: 'needs-bundler', reference, kind, sideEffects: 'none' },
  )
}

/**
 * Builds the `STATIC_PAGE_UNSUPPORTED` refusal of an entry page that cannot be read.
 * @param problem - What is wrong, one short sentence part without a final period.
 * @returns The refusal: `details.reason: "entry-unreadable"`, `problem` and `sideEffects: "none"`.
 * @example
 * staticPageEntryUnreadableRefusal('it is over the byte limit').details?.reason // => 'entry-unreadable'
 */
export function staticPageEntryUnreadableRefusal(problem: string): StudyError {
  return staticPageRefusal(
    'STATIC_PAGE_UNSUPPORTED',
    `The entry page cannot be read: ${problem}; nothing was started.`,
    `Tell the learner the entry page is not in a form this version reads (details.problem says what is wrong); never edit the project. ${recoveryEnd('STATIC_PAGE_UNSUPPORTED')}`,
    { reason: 'entry-unreadable', problem, sideEffects: 'none' },
  )
}

/**
 * Builds the `STATIC_PAGE_UNSUPPORTED` refusal of a package root that is an app of another adapter, not a plain page.
 * @param packageRoot - The package root's canonical repository-relative path.
 * @param adapter - The adapter that serves the folder, named in the message.
 * @returns The refusal: `details.reason: "not-a-static-page"`, `packageRoot`, `adapter` and `sideEffects: "none"`.
 * @example
 * staticPageNotPageRefusal('examples/app', 'vite-dev').details?.adapter // => 'vite-dev'
 */
export function staticPageNotPageRefusal(
  packageRoot: string,
  adapter: string,
): StudyError {
  return staticPageRefusal(
    'STATIC_PAGE_UNSUPPORTED',
    `${packageRoot} is an app that ${adapter} serves, not a plain page; nothing was started.`,
    `Start again with adapter ${adapter} for this folder (details.packageRoot is the one refused), or choose a folder that holds a plain page. ${recoveryEnd('STATIC_PAGE_UNSUPPORTED')}`,
    { reason: 'not-a-static-page', packageRoot, adapter, sideEffects: 'none' },
  )
}

/**
 * Builds the `STATIC_PAGE_SERVER_FAILED` refusal of a static server that could not listen.
 * @param cause - The error code or short message the listen failed with, already free of paths.
 * @returns The refusal: `details.reason: "listen-failed"`, `cause` and `sideEffects: "none"`.
 * @example
 * staticPageListenFailedRefusal('EACCES').details?.cause // => 'EACCES'
 */
export function staticPageListenFailedRefusal(cause: string): StudyError {
  return staticPageRefusal(
    'STATIC_PAGE_SERVER_FAILED',
    `Codebook's static server could not listen on a loopback port (${cause}); nothing was served.`,
    `Tell the learner the loopback port could not be opened (details.cause), then one new start with a new key. ${recoveryEnd('STATIC_PAGE_SERVER_FAILED')}`,
    { reason: 'listen-failed', cause, sideEffects: 'none' },
  )
}

/**
 * Builds the `STATIC_PAGE_SERVER_FAILED` refusal of a page whose entry page or scripts were not served before the setup deadline.
 * @param step - The setup step the run had reached.
 * @returns The refusal: `details.reason: "not-ready"`, `step` and `sideEffects: "partial"`.
 * @example
 * staticPageNotReadyRefusal('waiting for the server to answer the entry page').details?.reason // => 'not-ready'
 */
export function staticPageNotReadyRefusal(step: string): StudyError {
  return staticPageRefusal(
    'STATIC_PAGE_SERVER_FAILED',
    `The entry page and its scripts were not all served in time (${step}).`,
    `Start once more with a new key; a second failure means the page's files cannot be served as written, so tell the learner the step in details.step. The owned server was stopped and no input was sent. ${recoveryEnd('STATIC_PAGE_SERVER_FAILED')}`,
    { reason: 'not-ready', step, sideEffects: 'partial' },
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of stop files that lie outside the page's folder.
 * @param packageRoot - The package root's canonical repository-relative path.
 * @param files - Every offending repository-relative stop file, in declared order.
 * @param sideEffects - `none` when found before the start, `partial` at seal time (a stop whose real path leaves the folder).
 * @returns The refusal: `details.reason: "outside-package"`, `files`, `packageRoot` and `sideEffects`.
 * @example
 * staticPageOutsidePackageRefusal('examples/page', ['lib/a.js']).details?.files // => ['lib/a.js']
 * staticPageOutsidePackageRefusal('examples/page', ['lib/a.js'], 'partial').details?.sideEffects // => 'partial'
 */
export function staticPageOutsidePackageRefusal(
  packageRoot: string,
  files: readonly string[],
  sideEffects: StaticPageSideEffects = 'none',
): StudyError {
  return staticPageSealRefusal(
    `Stop file${files.length === 1 ? '' : 's'} ${files.join(', ')} lie${files.length === 1 ? 's' : ''} outside packageRoot ${packageRoot}; Codebook seals stops inside the page's own folder only.`,
    `Declare stops only in files inside details.packageRoot (every file in details.files lies outside it), or tell the learner a file outside the page folder cannot be observed in this version.`,
    { reason: 'outside-package', files: [...files], packageRoot },
    sideEffects,
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of stop files that lie in `node_modules`.
 * @param files - Every offending repository-relative stop file.
 * @param sideEffects - `none` when found before the start, `partial` at seal time.
 * @returns The refusal: `details.reason: "node-modules"`, `files` and `sideEffects`.
 * @example
 * staticPageNodeModulesRefusal(['page/node_modules/lib/index.js'], 'none').details?.reason // => 'node-modules'
 */
export function staticPageNodeModulesRefusal(
  files: readonly string[],
  sideEffects: StaticPageSideEffects = 'none',
): StudyError {
  return staticPageSealRefusal(
    `Stop file${files.length === 1 ? '' : 's'} ${files.join(', ')} lie${files.length === 1 ? 's' : ''} in node_modules, a published package and not the checked-out library.`,
    `A published package in node_modules is not the checked-out library, so put the stop in the page's own source (a file listed in details.files lies in node_modules); otherwise tell the learner this version observes only the page's own files.`,
    { reason: 'node-modules', files: [...files] },
    sideEffects,
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of a stop line that lies in no inline script of the entry page.
 * @param file - The repository-relative stop file (the entry page).
 * @param line - The declared stop line.
 * @returns The refusal: `details.reason: "not-in-page-script"`, `file`, `line` and `sideEffects: "partial"`.
 * @example
 * staticPageNotInScriptRefusal('examples/page/index.html', 3).details?.line // => 3
 */
export function staticPageNotInScriptRefusal(
  file: string,
  line: number,
): StudyError {
  return staticPageSealRefusal(
    `Declared stop ${file}:${line} lies outside every inline <script> of the page, so no JavaScript runs there and the stop cannot be sealed.`,
    `Move the stop to a line inside an inline <script> element of details.file (line details.line is markup), or to a .js file the page loads; otherwise tell the learner the stop cannot be sealed.`,
    { reason: 'not-in-page-script', file, line },
    'partial',
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of a stop file that more than one served script text names.
 * @param file - The repository-relative stop file.
 * @returns The refusal: `details.reason: "ambiguous-source"`, `file` and `sideEffects: "partial"`.
 * @example
 * staticPageAmbiguousSourceRefusal('examples/page/index.html').details?.reason // => 'ambiguous-source'
 */
export function staticPageAmbiguousSourceRefusal(file: string): StudyError {
  return staticPageSealRefusal(
    `The served maps name ${file} more than once, so Codebook cannot tell which copy the page runs and the stop cannot be sealed.`,
    `Tell the learner the served maps name the stop file more than once (details.file), so this version cannot seal a stop in it; never edit the project.`,
    { reason: 'ambiguous-source', file },
    'partial',
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of a stop line that no served source-map position reaches.
 * @param file - The repository-relative stop file.
 * @param line - The declared stop line.
 * @param citationEndLine - The last line of the stop's citation.
 * @returns The refusal: `details.reason: "unmapped-line"`, `file`, `line`, `citationEndLine` and `sideEffects: "partial"`.
 * @example
 * staticPageUnmappedLineRefusal('src/createStore.ts', 12, 14).details?.line // => 12
 */
export function staticPageUnmappedLineRefusal(
  file: string,
  line: number,
  citationEndLine: number,
): StudyError {
  return staticPageSealRefusal(
    `Declared stop ${file}:${line} cannot be sealed: no mapped position of the served script lies on line ${line} or within its citation through line ${citationEndLine}.`,
    `Move the stop to a line of details.file that the page runs (details.line to details.citationEndLine has no mapped position), or tell the learner the stop cannot be sealed.`,
    { reason: 'unmapped-line', file, line, citationEndLine },
    'partial',
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of a served map or script over a reading limit.
 * @param limit - Which limit was hit.
 * @param limitValue - The value of that limit.
 * @returns The refusal: `details.reason: "map-limit"`, `limit`, `limitValue` and `sideEffects: "partial"`.
 * @example
 * staticPageMapLimitRefusal('map-bytes', 16777216).details?.limit // => 'map-bytes'
 */
export function staticPageMapLimitRefusal(
  limit: string,
  limitValue: number,
): StudyError {
  return staticPageSealRefusal(
    `The served source map exceeds Codebook's reading limit ${limit} (${limitValue}), so the stops cannot be sealed.`,
    `Tell the learner the page's script is too large for this version to seal (details.limit names the limit, details.limitValue its value); never edit the project.`,
    { reason: 'map-limit', limit, limitValue },
    'partial',
  )
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of a served script or map that Codebook cannot read.
 * @param problem - What is wrong with the served text, one sentence without a final period.
 * @returns The refusal: `details.reason: "map-unreadable"`, `problem` and `sideEffects: "partial"`.
 * @example
 * staticPageMapUnreadableRefusal('the packed map is not JSON').details?.reason // => 'map-unreadable'
 */
export function staticPageMapUnreadableRefusal(problem: string): StudyError {
  return staticPageSealRefusal(
    `The served script cannot be sealed: ${problem}.`,
    `Tell the learner the page's script or the packed library's map is not in the form this version reads (details.problem names what is wrong); never edit the project.`,
    { reason: 'map-unreadable', problem },
    'partial',
  )
}

/**
 * Builds the `SOURCE_CHANGED` refusal of a stop file that is no longer the text the static server serves.
 * @param path - The stop's repository-relative path.
 * @returns The error to throw.
 * @example
 * staticPageSourceChangedRefusal('examples/page/index.html').code // => 'SOURCE_CHANGED'
 */
export function staticPageSourceChangedRefusal(path: string): StudyError {
  return new StudyError(
    'SOURCE_CHANGED',
    `${path} differs from the text the page serves, so the page does not run the checked-out file. Save the file unchanged and start again.`,
  )
}

/** The reasons of {@link staticPageLibrarySealRefusal}. */
export type StaticPageLibrarySealReason =
  'library-build-stale' | 'library-not-in-build' | 'library-build-unmapped'

/** What the page and the packed build did, per library seal reason: the sentence of the refusal and the recovery before the shared side-effects sentence. */
const STATIC_PAGE_LIBRARY_SEAL_TEXTS: Record<
  StaticPageLibrarySealReason,
  { message: (place: string, cause?: string) => string; recovery: string }
> = {
  'library-build-stale': {
    message: (place) =>
      `The checked-out ${place} differs from the copy Codebook packed for this run, so the library was edited after the build; the stop cannot be sealed.`,
    recovery:
      'The checked-out file changed after this run built and packed the library. Tell the learner the file changed after the build and start the run again so it builds the current source; never run the build yourself.',
  },
  'library-not-in-build': {
    message: (place) =>
      `The packed build the page loads does not name ${place}, so the page does not load that file from the packed build; the stop cannot be sealed.`,
    recovery:
      "The packed build the page loads, with its source map, does not contain the stop file: the page does not import that file, or the library files the page imports from the CDN do not reach it. Tell the learner, or choose a stop on a line the page's code runs; do not start another run with the same stop.",
  },
  'library-build-unmapped': {
    message: (place, cause) =>
      `The packed build's source map names ${place} ${cause === 'no-sources-content' ? 'without its source text' : 'with source text that differs from the checked-out file'}, so the stop cannot be sealed.`,
    recovery:
      "The packed build's source map cannot tie the stop to the checked-out file; details.cause says why (no-sources-content: the map names the file without its source text; content-differs: the map's text differs from the file). Tell the learner the cause, or offer a stop in the page's own files.",
  },
}

/**
 * Builds the `STATIC_PAGE_SEAL_FAILED` refusal of a stop in the checked-out library, raised at seal time, after the library was built and packed.
 *
 * Why it exists: a library stop of a static-page run is sealed against the packed build the redirect serves, and a chat reads the library vocabulary of the other adapters (`library-build-stale`, `library-not-in-build`, `library-build-unmapped`) under this code. Called by the library seal in {@link sealStaticPageLibraryStop}.
 * @param request - The reason, the page's package root, the library's name, the stop file and, for `library-build-unmapped`, the cause.
 * @returns The refusal: `details.reason`, `details.library`, `details.file`, `details.packageRoot`, `details.sideEffects: "partial"` and `details.cause` where the reason has one.
 * @example
 * staticPageLibrarySealRefusal({ reason: 'library-not-in-build', packageRoot: 'examples/page', library: 'lib', file: 'src/a.ts' }).details?.reason // => 'library-not-in-build'
 */
export function staticPageLibrarySealRefusal(request: {
  reason: StaticPageLibrarySealReason
  packageRoot: string
  library: string
  file: string
  cause?: 'no-sources-content' | 'content-differs'
}): StudyError {
  const { reason, packageRoot, library, file, cause } = request
  const texts = STATIC_PAGE_LIBRARY_SEAL_TEXTS[reason]
  return staticPageSealRefusal(
    texts.message(
      `${file} in library ${library} (packageRoot ${packageRoot})`,
      cause,
    ),
    texts.recovery,
    { reason, packageRoot, library, file, ...(cause ? { cause } : {}) },
    'partial',
  )
}

/**
 * Builds the shared shape of a `STATIC_PAGE_SEAL_FAILED` refusal.
 * @param message - What was refused.
 * @param recovery - The recovery before the shared side-effects sentence and the help anchor.
 * @param details - The structured fields without `sideEffects`.
 * @param sideEffects - Whether nothing started or the owned server was started and stopped.
 * @returns The error to throw.
 * @example
 * staticPageSealRefusal('No.', 'Fix it.', { reason: 'node-modules' }, 'none').details?.sideEffects // => 'none'
 */
function staticPageSealRefusal(
  message: string,
  recovery: string,
  details: Readonly<Record<string, unknown>>,
  sideEffects: StaticPageSideEffects,
): StudyError {
  const effect =
    sideEffects === 'none'
      ? 'Nothing was started'
      : 'The owned server was stopped and no input was sent'
  return staticPageRefusal(
    'STATIC_PAGE_SEAL_FAILED',
    sideEffects === 'none' ? `${message} Nothing was started.` : message,
    `${recovery} ${recoveryEnd('STATIC_PAGE_SEAL_FAILED')} ${effect} (details.sideEffects is ${sideEffects}).`,
    { ...details, sideEffects },
  )
}

/** Why the packed build cannot serve a path the page asked for: it holds no such file (or the path leaves the folder), the file is over the size limit, or it is a directory or cannot be read. Carried as `details.cause`. */
export type StaticPageLibraryPathCause = 'absent' | 'too-large' | 'unreadable'

/** The variant each cause carries in a run's failure text (`REPOSITORY_BROWSER_LIBRARY_REFUSED(<variant>:<identity>): …`); the reason code stays `library-path-absent` for all three. */
export const STATIC_PAGE_LIBRARY_PATH_VARIANTS: Readonly<
  Record<StaticPageLibraryPathCause, string>
> = {
  absent: 'library-path-absent',
  'too-large': 'library-path-too-large',
  unreadable: 'library-path-unreadable',
}

/** What each cause says the packed build did, completing the sentence `The page asked for <path> of <library>, which …`. */
const LIBRARY_PATH_CAUSE_WORDS: Readonly<
  Record<StaticPageLibraryPathCause, string>
> = {
  absent: 'the packed build of the declared library does not hold',
  'too-large':
    'the packed build of the declared library holds as a file too large to serve',
  unreadable:
    'the packed build of the declared library holds as a directory or a file that could not be read',
}

/**
 * Builds the `REPOSITORY_BROWSER_LIBRARY_REFUSED` refusal of a page request for a file the packed build of the declared library cannot serve.
 *
 * Why it exists: the redirect serves the packed build in place of the page's CDN import, and a path the build cannot serve (missing, outside the folder, too large, a directory or unreadable) would otherwise fall through to the published copy and run the wrong code. Called by the redirect when a matching request names such a path, before any stop is sealed.
 * @param request - The requested path inside the package, the library's package name, the page's package root and why the path cannot be served (`absent` when omitted).
 * @returns The refusal: `details.reason: "library-path-absent"`, `cause` (`absent`, `too-large` or `unreadable`), `path`, `library`, `packageRoot` and `sideEffects: "partial"` (the library was built and packed, the browser opened, no input was sent).
 * @example
 * staticPageLibraryPathAbsentRefusal({ path: 'dist/x.mjs', library: 'lib', packageRoot: 'examples/page' }).details?.path // => 'dist/x.mjs'
 * staticPageLibraryPathAbsentRefusal({ path: 'dist/x.mjs', library: 'lib', packageRoot: 'examples/page', cause: 'too-large' }).details?.cause // => 'too-large'
 */
export function staticPageLibraryPathAbsentRefusal(request: {
  path: string
  library: string
  packageRoot: string
  cause?: StaticPageLibraryPathCause
}): StudyError {
  const { path, library, packageRoot, cause = 'absent' } = request
  return staticPageRefusal(
    'REPOSITORY_BROWSER_LIBRARY_REFUSED',
    `The page asked for ${path} of ${library}, which ${LIBRARY_PATH_CAUSE_WORDS[cause]}, so the run would not load the checked-out library; the run was ended before any stop was sealed.`,
    `Tell the learner the page imports ${library} at a path (details.path) that the library's build output cannot serve (details.cause is ${cause}), then either declare the library folder whose build produces that file or start again once without library, saying the page then runs its published copy; never run the build yourself. Codebook built and packed the library, the owned server and browser were stopped, no stop was sealed and no input was sent (details.sideEffects is partial). ${recoveryEnd('REPOSITORY_BROWSER_LIBRARY_REFUSED')}`,
    {
      reason: 'library-path-absent',
      cause,
      path,
      library,
      packageRoot,
      sideEffects: 'partial',
    },
  )
}

/**
 * Writes the failure text a run records for a page request whose path the packed library cannot serve, the form {@link refusalFailureOf} restores.
 *
 * Why it exists: the refusal is raised by an event of the page's network layer, not by a thrown error, so only its text survives to the service. Called by the run's CDN redirect callback.
 * @param request - The requested path, the library's name, the page's package root and the cause (`absent` when omitted).
 * @returns `REPOSITORY_BROWSER_LIBRARY_REFUSED(<variant>:<identity>): <message>`, the variant naming the cause.
 * @example staticPageLibraryPathAbsentFailureText({ path: 'dist/x.mjs', library: 'lib', packageRoot: 'examples/page' }) // => 'REPOSITORY_BROWSER_LIBRARY_REFUSED(library-path-absent:%5B…%5D): The page asked for dist/x.mjs of lib, …'
 */
export function staticPageLibraryPathAbsentFailureText(request: {
  path: string
  library: string
  packageRoot: string
  cause?: StaticPageLibraryPathCause
}): string {
  const refusal = staticPageLibraryPathAbsentRefusal(request)
  return `REPOSITORY_BROWSER_LIBRARY_REFUSED(${encodeViteLibraryVariant(
    STATIC_PAGE_LIBRARY_PATH_VARIANTS[request.cause ?? 'absent'],
    {
      packageRoot: request.packageRoot,
      library: request.library,
      file: request.path,
    },
  )}): ${refusal.message}`
}
