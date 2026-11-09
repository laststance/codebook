import {
  MILLISECONDS_PER_SECOND,
  LIBRARY_BUILD_TIMEOUT_MS,
  REPOSITORY_OPERATION_ACTION,
  STATIC_PAGE_MINIMUM_API,
  STATIC_PAGE_REFERENCES_MAX,
  STATIC_PAGE_SCRIPT_READS_MAX,
} from './constants'
import { packageRootAnchor } from './nextHelp'
import {
  STATIC_PAGE_REFUSAL_CODES,
  staticPageHelpAnchor,
} from './staticPageRefusals'
import {
  VITE_LIBRARY_CONFIGURATION,
  VITE_NESTED_CONFIGURATION,
} from './viteHelp'

/**
 * A complete version 3 `static-page` configuration for a browser stop in an inline script of a plain HTML page below the repository root, reached by one declared click: the page's folder is `packageRoot`, the entry path is `/` (its `index.html`), and `source.path` is the repository-relative entry page.
 * Served as `staticPageQuickStart.configurationNested` and parsed by a test with the live configuration schema. Built from {@link VITE_NESTED_CONFIGURATION}, whose flow (one click, one inspection) is adapter-neutral, so the examples cannot drift. Every value is a neutral placeholder, not any project's folder or file: replace the folder with the `packageRoot` of the `packages` entry the question is about, the book identity and the hash with the values the earlier steps returned.
 */
export const STATIC_PAGE_NESTED_CONFIGURATION = {
  ...VITE_NESTED_CONFIGURATION,
  adapter: 'static-page',
  packageRoot: 'examples/page',
  source: {
    ...VITE_NESTED_CONFIGURATION.source,
    path: 'examples/page/index.html',
  },
} as const

/**
 * A complete version 3 `static-page` configuration that declares the repository's own library: the page imports the library from a CDN and the packed checked-out build is served in its place.
 * Served as `staticPageQuickStart.library.sample` and parsed by a test with the live configuration schema. Built from {@link VITE_LIBRARY_CONFIGURATION}, whose flow is adapter-neutral. Every value is a neutral placeholder: replace the folders with the page and the library package the question is about.
 */
export const STATIC_PAGE_LIBRARY_CONFIGURATION = {
  ...VITE_LIBRARY_CONFIGURATION,
  adapter: 'static-page',
  packageRoot: 'examples/page',
  library: { packageRoot: 'packages/lib' },
  source: {
    ...VITE_LIBRARY_CONFIGURATION.source,
    path: 'examples/page/index.html',
  },
} as const

/** The side effects of a refusal raised once the server ran: the owned server was stopped and no input was sent. */
const SERVER_STOPPED = 'The owned server was stopped and no input was sent.'

/** The reasons of each refusal code: what happened, what the chat tells the learner, what started. The keys of the inner objects are the `details.reason` values. */
const STATIC_PAGE_REFUSAL_REASONS = {
  STATIC_PAGE_UNSUPPORTED: {
    'no-entry-page':
      'The page folder has no entry file (details.entry: index.html for the entry path "/", else the .html file the entry path names). Set packageRoot to the folder that holds the page and entryPath to its .html file, or tell the learner the folder is not a plain page. Nothing started.',
    'needs-bundler': `The entry page names a <script src> or <link href> file that does not exist in the page folder (details.kind missing-file), or an inline or same-origin module script imports a bare specifier only a bundler resolves (details.kind bare-import); details.reference is the first offender, found within ${STATIC_PAGE_REFERENCES_MAX} references and one level of same-origin imports. Tell the learner the page needs a bundler and this version cannot serve it; never edit the project or run its bundler. Nothing started.`,
    'entry-unreadable':
      'The entry page cannot be read (details.problem: over the byte limit, not a regular file or not UTF-8 text). Tell the learner; never edit the project. Nothing started.',
    'not-a-static-page':
      'The declared packageRoot is an app that another adapter serves (details.adapter). Start again with that adapter for the folder, or choose a folder that holds a plain page. Nothing started.',
  },
  STATIC_PAGE_SERVER_FAILED: {
    'listen-failed':
      "Codebook's static server could not listen on a loopback port (details.cause). Tell the learner, then one new start with a new key. Nothing started.",
    'not-ready': `The entry page and its same-origin scripts were not all served before the setup deadline (details.step). Start once more with a new key; a second failure means the page's files cannot be served as written, so tell the learner the step. ${SERVER_STOPPED}`,
  },
  STATIC_PAGE_SEAL_FAILED: {
    'outside-package':
      "A stop file lies outside packageRoot (details.files), or its real path leaves the page folder. Declare stops only in the page's own files, or tell the learner a file outside the page folder cannot be observed in this version. details.sideEffects is none when the check ran before the start, partial when the owned server was stopped; no input was sent.",
    'node-modules':
      "A stop file lies in node_modules (details.files). A published package is not the checked-out library: put the stop in the page's own source, or declare library for a page that imports the library from a CDN. details.sideEffects is none before the start, partial after it.",
    'not-in-page-script': `The stop line (details.file, details.line) lies outside every inline <script> of the entry page, so no JavaScript runs there. Move the stop to a line inside an inline script or to a same-origin .js file the page loads, or tell the learner the stop cannot be sealed. ${SERVER_STOPPED}`,
    'ambiguous-source': `The served maps name the stop file more than once (details.file), so the copy the page runs is unknown. Tell the learner; never edit the project. ${SERVER_STOPPED}`,
    'unmapped-line': `No mapped position of the served script lies on the stop line or within its citation (details.file, details.line, details.citationEndLine). Move the stop to a line the page runs. ${SERVER_STOPPED}`,
    'map-limit': `A served script or source map exceeds a reading limit (details.limit, details.limitValue; at most ${STATIC_PAGE_SCRIPT_READS_MAX} scripts are read). Tell the learner the page is too large for this version to seal; never edit the project. ${SERVER_STOPPED}`,
    'map-unreadable': `A served script or the packed library's map cannot be read in the form this version reads (details.problem). Tell the learner; never edit the project. ${SERVER_STOPPED}`,
    'library-build-stale': `A stop lies in the library's checked-out source and the file differs from its packed copy, so the library was edited after the build. Tell the learner the file changed after the build and start the run again so it builds the current source; never run the build yourself. Codebook built and packed the library; ${SERVER_STOPPED}`,
    'library-not-in-build': `The packed build the page loads, with its source map, does not contain the stop file: the page does not import that file, or the library files it imports from the CDN do not reach it. Tell the learner, or choose a stop on a line the page's code runs; do not start another run with the same stop. ${SERVER_STOPPED}`,
    'library-build-unmapped': `The packed build's source map names the stop file without its source text (details.cause no-sources-content) or with text that differs from the checked-out file (details.cause content-differs), so the stop cannot be sealed. Tell the learner the cause, or offer a stop in the page's own files. ${SERVER_STOPPED}`,
  },
  REPOSITORY_BROWSER_LIBRARY_REFUSED: {
    'library-path-absent':
      'The page asked for a path of the declared library (details.path, details.library) that the packed build does not hold, or one that leaves the packed folder, so the run would not load the checked-out library and was ended before any stop was sealed. Tell the learner, then either declare the library folder whose build produces that file or start again once without library, saying the page then runs its published copy; never run the build yourself. Codebook built and packed the library; the owned server and browser were stopped and no input was sent (details.sideEffects is partial).',
  },
} as const satisfies Record<
  (typeof STATIC_PAGE_REFUSAL_CODES)[number],
  Record<string, string>
>

/**
 * Builds the `library` key of `staticPageQuickStart`: what declaring `library.packageRoot` under `static-page` does to a page's CDN import, what the build writes, the refusals and one complete sample.
 *
 * Why it exists: a plain page inside a library repository usually imports the library from unpkg or jsDelivr, so the page runs the published release, not the source the learner reads; a chat needs the route and its disclosure before it declares a run. Called by {@link staticPageHelp}.
 * @returns The JSON-serializable section.
 * @example
 * staticPageLibraryHelp().sample.library.packageRoot // => 'packages/lib'
 */
function staticPageLibraryHelp() {
  return {
    anchor: packageRootAnchor('staticPageLibrary'),
    minimumApi: STATIC_PAGE_MINIMUM_API,
    whenToUse:
      "The page imports the repository's own library from https://unpkg.com/<name>@<version>/<path> or https://cdn.jsdelivr.net/npm/<name>@<version>/<path> and the question is about the library's checked-out source. Declare library.packageRoot (the library package's folder, relative to the repository root; \".\" when the library is the root).",
    whatRuns: [
      "The learner's editor confirmation comes first and names the build and pack, because the build runs the project's own build scripts (the Build and run consent of the pack route). A declined confirmation starts nothing.",
      "The repository's package manager runs the library's own build script in library.packageRoot, then packs the library into the run's private folder with lifecycle scripts off.",
      "Through the run's browser, a request for either CDN URL of the declared package (the query dropped, any version) is answered with the packed build's file at that path, with the build's source map inline so a stop in the library's checked-out source pauses there. Other remote URLs load as they are.",
      `The build and pack together are bounded at ${LIBRARY_BUILD_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s. Codebook never installs packages.`,
    ],
    refusals: {
      'library-path-absent': `A path the packed build lacks ends the run with REPOSITORY_BROWSER_LIBRARY_REFUSED (library-path-absent): ${staticPageHelpAnchor('REPOSITORY_BROWSER_LIBRARY_REFUSED')}. details.cause is absent (the packed build lacks the path), too-large (a file over 32 MiB) or unreadable (a directory or a read error).`,
      'library-build-stale': `${staticPageHelpAnchor('STATIC_PAGE_SEAL_FAILED')} (library-build-stale)`,
      'library-not-in-build': `${staticPageHelpAnchor('STATIC_PAGE_SEAL_FAILED')} (library-not-in-build, for example a page reached only through a nested import of the library)`,
      'library-build-unmapped': `${staticPageHelpAnchor('STATIC_PAGE_SEAL_FAILED')} (library-build-unmapped)`,
    },
    limits: [
      'Without library, a CDN import loads the published copy, which is not the checked-out library; the run says so, and a chat must not call it the checked-out library.',
      'One library per run; browser stops only.',
    ],
    sample: STATIC_PAGE_LIBRARY_CONFIGURATION,
  }
}

/**
 * Builds the `staticPageQuickStart` key of `codebook://help/repository-browser`: how to run a plain HTML page at the repository root or in a folder of it (API 1.42).
 *
 * Why it exists: a chat that meets a plain page (an `examples/` folder of a library, a documentation page) needs the configuration shape, the limits and the refusal fixes before it reads the long sections. Called by the resource reader for the repository-browser help, which spreads the result among its keys.
 * @returns The key `staticPageQuickStart`: when to use it, one complete version 3 example, the call order, one anchor per refusal code with its reasons, the limits and the library route.
 * @example
 * staticPageHelp().staticPageQuickStart.refusals.STATIC_PAGE_SEAL_FAILED.anchor // => 'codebook://help/repository-browser#STATIC_PAGE_SEAL_FAILED'
 */
export function staticPageHelp() {
  return {
    staticPageQuickStart: {
      anchor: packageRootAnchor('static-page-quick-start'),
      minimumApi: STATIC_PAGE_MINIMUM_API,
      summary: `For a plain HTML page at the repository root or in a folder of it (status lists pages at the root, in examples/* and in apps/*; a packageRoot declared elsewhere is judged when the run starts), which Codebook serves as written from its own loopback static server (no build step): configure adapter "static-page" in a version 3 configuration and use the same tools in the same order as for a Vite app. Use it only when profiles[].prerequisites.adapters["static-page"].ready is true in codebook_status; it needs API ${STATIC_PAGE_MINIMUM_API} or later (compare the number after the dot as a whole number), and on an older Codebook you tell the learner to update it and do not run the page by another route. The configuration is version 3 with adapter "static-page"; packageRoot is the folder of a page below the root (the packageRoot of the packages entry; omit it or use "." for a page at the root); entryPath is "/" for the folder's index.html, or the path of another .html file in that folder. A browser stop pauses in the page's inline scripts and in same-origin .js files the page loads.`,
      status: {
        packages:
          'profiles[].prerequisites.adapters["static-page"].packages (pages at the root, in examples/* and in apps/*): { packageRoot, ready, missing[], entry }; missing lists no-entry-page, needs-bundler or entry-unreadable. packagesTruncated is true when the list is incomplete; packagesTruncatedReason says why.',
      },
      configurationNested: STATIC_PAGE_NESTED_CONFIGURATION,
      example:
        'configurationNested: a browser stop in an inline script of examples/page/index.html, reached by one declared click (a browser stop declares afterOperation from 1). source.path stays repository-relative and starts with packageRoot. The folder, file, line, selectors and inspection are placeholders: replace them, the book and the hash with the page the question is about.',
      callOrder: [
        'codebook_status: confirm the static-page readiness (ready, or the packages entry) and copy instanceId.',
        'codebook_sources, then codebook_source: read the file the stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key.',
        `Poll the run resource until it reads ready, paused or an error; read its nextActions (it offers ${REPOSITORY_OPERATION_ACTION} while an operation is left) and send codebook_action ${REPOSITORY_OPERATION_ACTION} once per declared operation, each with a new stable key; at each pause explain the values, then codebook_continue with the current continueArguments.`,
      ],
      refusals: Object.fromEntries(
        STATIC_PAGE_REFUSAL_CODES.map((code) => [
          code,
          {
            anchor: staticPageHelpAnchor(code),
            reasons: STATIC_PAGE_REFUSAL_REASONS[code],
          },
        ]),
      ),
      library: staticPageLibraryHelp(),
      limits: [
        'needs-bundler (STATIC_PAGE_UNSUPPORTED): a <script src> or <link href> naming a file that is not in the page folder, or a bare-specifier import in an inline or same-origin module script (one level deep), means the page needs a bundler; it is listed not ready and a start is refused. Tell the learner; never edit the project or run its bundler.',
        "Codebook serves the page's files as written: the server never runs the Example's scripts, never installs anything and never builds the page; the browser loads the page and runs its scripts.",
        'The page loads other remote URLs (fonts, images, scripts that are not the declared library) as they are.',
        'Without library, a CDN import loads the published copy, which is not the checked-out library, and the run says so.',
        'A page that reaches the library only through a nested import of the CDN module can end with library-not-in-build (STATIC_PAGE_SEAL_FAILED) for a stop in a library file the page never loaded directly.',
        'A reference that starts with // or with a scheme (https:, data:, blob: and any other) is remote and is never judged as a file of the page folder.',
        'Only a <link> whose rel contains stylesheet or modulepreload, or preload with as="script" or as="style", is judged; icon, manifest, canonical and preconnect links are ignored.',
        'A bare specifier that equals a key of the entry page\'s <script type="importmap"> (imports or any scopes entry), or starts with a key that ends in /, is not judged; a malformed import map is ignored. A malformed percent-encoding in a reference counts as a missing file.',
        'The static server answers 403 to a request whose Host is not its own 127.0.0.1:<port> or localhost:<port>, and never serves a file or folder whose name starts with a dot (.git, .env).',
        'With library, the CDN imports to redirect are found in the entry page (inline scripts and <script src> values) and in the same-origin .js files the run reads one level deep; from each packed file the run follows relative imports inside the packed folder, at most 3 levels and 16 files, so code-split chunks are covered.',
        'Browser stops only: participant "server" is refused with static-page.',
      ],
      studies:
        'A static-page run is saved as study format 23 (.study.v23.json) with its retained configuration; a run that declares library keeps its library facts in that format. An older Codebook lists a format 23 study as saved by a newer Codebook; update Codebook to open it. It replays from recorded evidence after the server has stopped.',
    },
  }
}
