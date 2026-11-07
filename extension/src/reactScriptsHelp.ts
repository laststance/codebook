import {
  MILLISECONDS_PER_SECOND,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  LIBRARY_BUILD_TIMEOUT_MS,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  REACT_SCRIPTS_APP_SELECTION_RULE,
  REACT_SCRIPTS_LIBRARY_MINIMUM_API,
  REACT_SCRIPTS_MINIMUM_API,
  REACT_SCRIPTS_SUPPORTED_MAJOR,
  REPOSITORY_OPERATION_ACTION,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'
import { LIBRARY_STOP_REASONS, packageRootAnchor } from './nextHelp'
import {
  REACT_SCRIPTS_REFUSAL_CODES,
  reactScriptsHelpAnchor,
} from './reactScriptsRefusals'
import {
  VITE_LIBRARY_CONFIGURATION,
  VITE_NESTED_CONFIGURATION,
} from './viteHelp'

/**
 * A complete version 3 `react-scripts-dev` configuration for a browser stop in a Create React App app, reached by one declared click: the app's folder is `packageRoot`, and `source.path` is repository-relative (it starts with that folder).
 * Served as `reactScriptsQuickStart.configurationNested` and parsed by a test with the live configuration schema. Built from {@link VITE_NESTED_CONFIGURATION}, whose flow (one click, one inspection) is adapter-neutral, so the two examples cannot drift. Every value is a neutral placeholder, not any project's folder or file: the agent replaces the folder with the `packageRoot` of the `packages` entry the question is about (or omits it for a root app), and the book identity and the hash with the values the earlier steps returned.
 */
export const REACT_SCRIPTS_NESTED_CONFIGURATION = {
  ...VITE_NESTED_CONFIGURATION,
  adapter: 'react-scripts-dev',
  source: {
    ...VITE_NESTED_CONFIGURATION.source,
    path: 'apps/my-app/src/components/Counter.js',
  },
} as const

/**
 * A complete version 3 `react-scripts-dev` configuration for a browser stop in a Create React App Example below the repository root that runs on the repository's own library: the Example's folder is `packageRoot`, the library package's folder is `library.packageRoot`, and `source.path` is repository-relative and lies in the Example.
 * Served as `reactScriptsQuickStart.library.sample` and parsed by a test with the live configuration schema. Built from {@link VITE_LIBRARY_CONFIGURATION}, whose flow is adapter-neutral, so the two samples cannot drift. Every value is a neutral placeholder, not any project's folder or file: replace the folders with the Example and the library package the question is about, the book identity and the hash with the values the earlier steps returned.
 */
const REACT_SCRIPTS_LIBRARY_CONFIGURATION = {
  ...VITE_LIBRARY_CONFIGURATION,
  adapter: 'react-scripts-dev',
  packageRoot: 'examples/widgets-cra',
  source: {
    ...VITE_LIBRARY_CONFIGURATION.source,
    path: 'examples/widgets-cra/src/features/counter/counter.js',
  },
} as const

/** The side-effects clause of a library-source stop under `react-scripts-dev`: the library was built and packed and the owned server ran, but no browser opened. */
const REACT_SCRIPTS_LIBRARY_STOP_SIDE_EFFECTS =
  'details.sideEffects is partial: Codebook built and packed the library and wrote its ignored build output, the owned react-scripts server was stopped, the private folder was removed, no browser opened and no input was sent. details.library names the library.'

/**
 * The refusal rows of a browser stop in the library's checked-out source under `react-scripts-dev`, keyed by reason.
 * `library-place-ambiguous` is absent on purpose: a `react-scripts-dev` run declares at most one library, so a stop never has two places. The key type enforces a row for every other reason of the shared {@link LIBRARY_STOP_REASONS}.
 */
const REACT_SCRIPTS_LIBRARY_STOP_ROWS: Record<
  Exclude<(typeof LIBRARY_STOP_REASONS)[number], 'library-place-ambiguous'>,
  { code: string; meaning: string; fix: string }
> = {
  'library-build-stale': {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    meaning: `A stop lies in the library's checked-out source and the source map of the served bundle carries source text that differs from the checked-out file: the library was edited after this run's build. ${REACT_SCRIPTS_LIBRARY_STOP_SIDE_EFFECTS}`,
    fix: 'Tell the learner the file changed after the build; start the run again so it builds the current source. Do not run the build yourself.',
  },
  'library-not-in-build': {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    meaning: `The bundle the page parsed, with its source map, does not contain the stop file at that line: the Example does not import that file, or the library entry the Example loads does not reach it. ${REACT_SCRIPTS_LIBRARY_STOP_SIDE_EFFECTS}`,
    fix: "Tell the learner the page does not load that library file, or choose a stop on a line the page's code runs. Do not start another run with the same stop.",
  },
  'library-build-unmapped': {
    code: 'REACT_SCRIPTS_SEAL_FAILED',
    meaning: `The served bundle's source map cannot tie the stop to the checked-out file; details.cause is no-sources-content (the map names the file without its source text) or content-differs (the map's text differs from the file). ${REACT_SCRIPTS_LIBRARY_STOP_SIDE_EFFECTS}`,
    fix: "Tell the learner the cause. For no-sources-content the library can be rebuilt with source maps that include the source text; for content-differs start again after the library was built from the current source. Otherwise offer a stop in the Example's own files.",
  },
  'library-build-changed': {
    code: 'RUNTIME_FAILED',
    meaning:
      'During the run, the bundle the browser executed differs from the bytes Codebook sealed (a rebuild or a hot update replaced it). Raised after the page loaded; details.library names the library. details.sideEffects is partial.',
    fix: 'Tell the learner the library was rebuilt during the run and start the run again once the rebuild is done. Do not run the build yourself.',
  },
}

/**
 * The refusals of a `react-scripts-dev` library run that are not library-source stops, keyed by `details.reason`.
 * Why it exists: one anchor per reason lets a chat that meets a refusal read its fix without the long sections; {@link reactScriptsLibraryRefusals} serves the rows in this record's order.
 */
const REACT_SCRIPTS_LIBRARY_REFUSALS = {
  'library-needs-package-root': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      'library was declared on a react-scripts app at the repository root (packageRoot absent or "."): the library route redirects an Example below the repository root. Nothing started (details.sideEffects none).',
    fix: "Declare the Example's folder as packageRoot next to library, or drop library to run the root app on its installed copy.",
  },
  'not-a-dependency': {
    code: 'LIBRARY_BUILD_UNSUPPORTED',
    meaning:
      "Neither the Example's package.json nor the installed manifest of one of its direct dependencies lists the library, so the Example does not use it. Nothing started (details.sideEffects none).",
    fix: 'Tell the learner the Example does not depend on that library, directly or through a direct dependency; drop library, saying the Example then runs its installed copy.',
  },
  'library-redirect-not-applied': {
    code: 'REACT_SCRIPTS_UNSUPPORTED',
    meaning:
      "The first compile ended without the preload's applied marker, or with its error line (details.cause): react-scripts did not take the redirect to the packed library. details.sideEffects is partial: the library was built and packed, the owned server was stopped and no browser opened.",
    fix: 'Tell the learner this react-scripts installation cannot take the library route in this version, then run without library, saying the Example then runs its installed copy. Do not retry with library.',
  },
} as const

/**
 * Builds the refusal rows of the `react-scripts-dev` library route: the rows above, then one per reason of the shared {@link LIBRARY_STOP_REASONS} that occurs for react-scripts.
 *
 * Why it exists: the Next, Vite and react-scripts help list the same library-stop reasons with the same anchors, so the reason list is shared and a reason cannot be added without choosing its react-scripts row. Called by {@link reactScriptsLibraryHelp}.
 *
 * @returns The rows keyed by reason, each with its anchor (`codebook://help/repository-browser#<reason>`), code, meaning and fix.
 * @example
 * reactScriptsLibraryRefusals()['library-build-stale'].anchor // => 'codebook://help/repository-browser#library-build-stale'
 */
function reactScriptsLibraryRefusals() {
  return Object.fromEntries([
    ...Object.entries(REACT_SCRIPTS_LIBRARY_REFUSALS).map(
      ([reason, entry]) =>
        [reason, { anchor: packageRootAnchor(reason), ...entry }] as const,
    ),
    ...LIBRARY_STOP_REASONS.flatMap((reason) =>
      // library-place-ambiguous never occurs under react-scripts-dev (one library per run); every other reason must have a row, which the table's key type enforces
      reason === 'library-place-ambiguous'
        ? []
        : [
            [
              reason,
              {
                anchor: packageRootAnchor(reason),
                ...REACT_SCRIPTS_LIBRARY_STOP_ROWS[reason],
              },
            ] as const,
          ],
    ),
  ])
}

/**
 * Builds the `library` key of `reactScriptsQuickStart`: when to declare `library.packageRoot` under `react-scripts-dev` (API 1.35), what the build and pack run and write, the confirmation wait, the observation states, the refusals, the limits, the study format and one complete sample.
 *
 * Why it exists: a Create React App Example inside a library repository usually installs the library by a published version, so the Example runs a different release than the source the learner reads; a chat needs the route, its disclosure and its limits before it declares a run. Mirrors `viteLibrary` so a chat reads one vocabulary for every bundler. Called by {@link reactScriptsHelp}.
 *
 * @returns The JSON-serializable section.
 * @example
 * reactScriptsLibraryHelp().sample.library.packageRoot // => 'packages/widgets'
 */
function reactScriptsLibraryHelp() {
  return {
    anchor: packageRootAnchor('reactScriptsLibrary'),
    minimumApi: REACT_SCRIPTS_LIBRARY_MINIMUM_API,
    requires: `codebook_status reports API ${REACT_SCRIPTS_LIBRARY_MINIMUM_API} or later (compare the number after the dot as a whole number). An older Codebook refuses library under react-scripts-dev as an unknown key: tell the learner to update Codebook and do not run the Example by another route.`,
    whenToUse:
      "The Create React App Example lives below the root of a library repository and uses that library: its package.json lists the library, or the installed manifest of one of its direct dependencies does, so its own node_modules holds an installed copy, not the checked-out source. Declare library.packageRoot (the library package's folder, relative to the repository root; \".\" when the library is the repository root itself, even though the Example lies below it; never the Example's own folder or a folder inside it) together with the Example's nested packageRoot, and the Example runs on the checked-out library. A react-scripts app at the repository root with library is refused (library-needs-package-root). Without library the Example runs the installed copy: say so to the learner and never call that copy the checked-out library.",
    whatRuns: [
      "The learner's editor confirmation comes first and names the build and pack, because the build runs the project's own build scripts. Tell the learner a build will run and to answer the editor's confirmation; a declined confirmation starts nothing.",
      "The repository's package manager runs the library's own build script in library.packageRoot, then packs the library into the run's private folder with lifecycle scripts off.",
      "Codebook then starts the Example's own react-scripts with a preload that redirects the Example's imports of the library to the packed copy; the Example's files, its node_modules and its caches stay as they are (caches go to the run's private folder).",
      `The build and pack together are bounded at ${LIBRARY_BUILD_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s. Codebook never installs packages.`,
    ],
    phase:
      'The run reads confirming, then building, then running. codebook_start answers its receipt at once; keep polling the run resource while it reads confirming (the learner is answering the editor dialog) and do not end your turn there.',
    facts:
      'The run resource carries library: { package, version, packageRoot, revision, dirty, packageManager, buildMs, packMs, tarballSha256, installedVersion, prepared, observation, loaded, loadCount, publishedCopyLoaded, publishedCopyPath, cleanup }, the same shape as a node-script and a vite-dev run. For react-scripts loaded means a module of the packed copy was in a bundle the page parsed (matched by the parsed script\'s SHA-256 against the compilation report), and publishedCopyLoaded means another copy was in such a bundle. When a direct dependency of the Example, not the Example itself, declares the library, the facts add reachedThrough (at most 16 sorted package names) and reachedThroughCount, and the correspondence sentence adds ", declared by <dependencies> in this Example": say declared by, never imported by.',
    observationStates: [
      'prepared: the library was built and packed. It alone proves nothing about what the page parsed.',
      'loaded true, publishedCopyLoaded false, observation complete: a module of the packed copy was in a parsed bundle and no other copy was. Say "ran on the checked-out library" only then.',
      'loaded false with a complete observation: built but not in any bundle this page parsed; the page never imported the package.',
      'publishedCopyLoaded true: the page also parsed another copy (publishedCopyPath names the first); say which copy ran and make no correspondence claim.',
      'pending, incomplete or unreadable observation: say what the page loaded was not fully observed, never "not loaded".',
    ],
    refusals: reactScriptsLibraryRefusals(),
    librarySourceStops:
      "A browser stop in the library's checked-out source (a file below library.packageRoot, never in node_modules) is sealed against the served bundle's source map and pauses there. Its refusals, in the order the checks run, are library-build-stale, library-not-in-build, library-build-unmapped (details.cause) and, during the run, library-build-changed; each carries details.library and details.sideEffects partial.",
    limits: [
      "Versions can differ from a fresh install: the library's dependencies come from its own install, not from the Example's.",
      'One library per run; browser stops only; the Example must use react-scripts 5.',
      'A react-scripts installation whose webpack configuration the preload cannot wrap is refused after the first compile (library-redirect-not-applied); run without library then.',
      'Yarn and Bun repositories are refused (package-manager-unsupported); the Example runs its installed copy.',
    ],
    studies:
      'A react-scripts-dev run that declares library is saved as study format 17 (.study.v17.json) with its retained configuration and the library facts; a run without library keeps the format it takes today. An older Codebook lists a format 17 study as saved by a newer Codebook; update Codebook to open it. The replay reads only the saved facts and recorded evidence.',
    sample: REACT_SCRIPTS_LIBRARY_CONFIGURATION,
  }
}

/** The reasons of each refusal code with what each means and what the chat does; the keys of the inner objects are the `details.reason` values. */
const REACT_SCRIPTS_REFUSAL_REASONS = {
  REACT_SCRIPTS_UNSUPPORTED: {
    'not-installed':
      "react-scripts is not installed inside the repository for the app folder. Ask the learner to run the app's own install command (details.installCommand); never run it yourself. Nothing started.",
    'react-scripts-version': `The installed react-scripts is not major ${REACT_SCRIPTS_SUPPORTED_MAJOR} (details.installedVersion, details.requiredMajor); react-scripts 4 is listed by codebook_status but refused. Tell the learner; never change the app's dependencies. Nothing started.`,
    'start-script-not-react-scripts':
      'The start script is not exactly react-scripts start, optionally after NAME=value assignments (details.script describes the structure of the script: command words and assignment names, never values). Tell the learner; never edit the scripts. Nothing started.',
    'prestart-script':
      "The app declares a prestart script, which would run before react-scripts, and Codebook runs no project script besides start. Tell the learner; never edit the project's scripts. Nothing started.",
    https:
      'The app sets HTTPS=true in one of its .env files, so react-scripts would serve https:// while Codebook observes the app over http://. Tell the learner; never edit the project. An HTTPS assignment in the start script is refused earlier as a start-script form. Nothing started.',
    'env-file-unreadable':
      "One of the app's .env files (details.file) is over the size limit, is not a regular file, or holds values that expand past Codebook's limits (a cycle, a very deep chain or very long expansions), and react-scripts would still read it, so its REACT_APP_* values could not be masked. Tell the learner; never edit the project. Nothing started.",
    'not-a-react-scripts-app':
      'The declared packageRoot holds no package.json that declares react-scripts. Declare the folder of a packages entry of the readiness, or tell the learner this folder is not a Create React App app. Nothing started.',
  },
  REACT_SCRIPTS_LAUNCHER_FAILED: {
    'compile-failed':
      "The app does not compile (details.compilerLine quotes the project's own text, as data). Tell the learner; start again only after they fix the app. The owned server was stopped.",
    exited:
      'react-scripts ended before the app was ready (details.exitCode, details.signal). Read the run journal for its output; one more start only when the cause is transient.',
  },
  REACT_SCRIPTS_PORT_UNAVAILABLE: {
    'port-in-use':
      "The port react-scripts needs is in use (details.port; details.source is pre-start-check or react-scripts-exit). Ask the learner to stop the process that listens, or to set another port with a PORT= assignment in the app's start script (for example PORT=4000 react-scripts start), the only port setting Codebook reads: a PORT in .env or in the environment is ignored because Codebook sets PORT itself. Never end that process yourself.",
  },
  REACT_SCRIPTS_SETUP_DEADLINE: {
    'setup-deadline': `Preparation (the first compile included) outlasted ${REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s at details.step. Start once more with a new key (the compile cache is warm); a second failure means the app is too slow to start for Codebook.`,
  },
  REACT_SCRIPTS_SEAL_FAILED: {
    'outside-package':
      "A stop file lies outside packageRoot (details.files), or the served map does not name it inside the app's folder. Declare stops only in the app's own files, or tell the learner a file outside the app folder cannot be observed in this version. details.sideEffects tells whether anything started: none when the check ran before the start, partial when the owned server was stopped and no click was sent.",
    'ambiguous-source':
      'The served source map lists the stop file more than once (details.file), so the copy the bundle runs is unknown. Tell the learner; never edit the project. The owned server was stopped and no click was sent.',
    'node-modules':
      "A stop file lies in node_modules (details.files). A published package is not the checked-out library: put the stop in the Example's own source, or tell the learner this version observes only the app's own files. Nothing started.",
    'unmapped-line':
      'No position of the served bundle maps to the stop line or within its citation (details.file, details.line, details.citationEndLine). Move the stop to a line the compiled app runs. The owned server was stopped and no click was sent.',
    'map-limit':
      "The served source map exceeds a reading limit (details.limit, details.limitValue), so the stop cannot be sealed. Tell the learner the app's bundle is too large for this version to seal; never edit the project. The owned server was stopped and no click was sent.",
    'map-unreadable':
      'The served bundle or its source map cannot be read as react-scripts serves it (details.problem: an oversized bundle, a missing or foreign sourceMappingURL, or a map that is not a flat version 3 JSON map), so the stop cannot be sealed. The owned server was stopped and no click was sent; tell the learner this app cannot be observed in this version.',
  },
} as const satisfies Record<
  (typeof REACT_SCRIPTS_REFUSAL_CODES)[number],
  Record<string, string>
>

/**
 * Builds the `reactScriptsQuickStart` key of `codebook://help/repository-browser`: how to run a Create React App app (react-scripts 5) at or below the repository root (API 1.25).
 *
 * Why it exists: a chat that meets a Create React App app (a library's `examples/` folder, a monorepo) needs the selection rule, the exact configuration shape, the refusal fixes and the limits before it reads the long sections. Called by the resource reader for the repository-browser help, which spreads the result among its keys.
 *
 * @returns The key `reactScriptsQuickStart`: when to use it, selection rule, status fields, one complete version 3 example, the call order, one anchor per refusal code with its reasons, the limits and the study-format note.
 * @example
 * reactScriptsHelp().reactScriptsQuickStart.refusals.REACT_SCRIPTS_SEAL_FAILED.anchor // => 'codebook://help/repository-browser#REACT_SCRIPTS_SEAL_FAILED'
 */
export function reactScriptsHelp() {
  return {
    reactScriptsQuickStart: {
      anchor: packageRootAnchor('react-scripts-quick-start'),
      minimumApi: REACT_SCRIPTS_MINIMUM_API,
      summary: `For a Create React App app (react-scripts ${REACT_SCRIPTS_SUPPORTED_MAJOR}) at the repository root or below it: configure adapter "react-scripts-dev" in a version 3 configuration and use the same tools in the same order as for a Vite app. Use it only when profiles[].prerequisites.adapters["react-scripts-dev"].ready is true in codebook_status. Codebook starts the app's own react-scripts on a loopback port, the app is ready after its first compile, and a browser stop in the app's own source pauses in the native debugger. It is never a server participant.`,
      selectionRule: REACT_SCRIPTS_APP_SELECTION_RULE,
      versionCheck: `react-scripts-dev exists only in configuration version 3 and only when codebook_status reports API ${REACT_SCRIPTS_MINIMUM_API} or later (compare the number after the dot as a whole number). On an older API, or when a start refuses the adapter name, tell the learner to update Codebook and do not run the app by another route.`,
      status: {
        rootIsApp:
          'react-scripts-dev readiness: true when the root package.json declares react-scripts. Only then is the root a candidate.',
        packages: `Array of the react-scripts apps below the root that tracked package.json files declare (depth ${NEXT_PACKAGE_DISCOVERY_MAX_DEPTH} or less, at most ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT}): { packageRoot, installed, ready, version?, missing[], startScript }. packageRoot is the exact value to declare; missing lists react-scripts-installed, react-scripts-5, start-script, prestart-script or not-a-react-scripts-app.`,
        packagesTruncated:
          'true when the list is incomplete; packagesTruncatedReason says why. When it is true and the app the question names is not in packages, declare its repository-relative packageRoot from the repository files; the start checks it.',
      },
      configurationNested: REACT_SCRIPTS_NESTED_CONFIGURATION,
      example:
        'configurationNested: a browser stop in a component of a react-scripts app whose folder is packageRoot, reached by one declared click (a browser stop declares afterOperation from 1). source.path stays repository-relative and starts with packageRoot; omit packageRoot (or use ".") for a root app. The folder, file, line, selectors and inspection are placeholders: replace them, the book and the hash with the app the question is about.',
      callOrder: [
        'codebook_status: confirm the react-scripts-dev readiness (ready, or the packages entry) and copy instanceId.',
        'codebook_sources, then codebook_source: read the file the stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key.',
        `Poll the run resource until it reads ready, paused or an error; read its nextActions (it offers ${REPOSITORY_OPERATION_ACTION} while an operation is left) and send codebook_action ${REPOSITORY_OPERATION_ACTION} once per declared operation, each with a new stable key; at each pause explain the values, then codebook_continue with the current continueArguments.`,
      ],
      refusals: Object.fromEntries(
        REACT_SCRIPTS_REFUSAL_CODES.map((code) => [
          code,
          {
            anchor: reactScriptsHelpAnchor(code),
            reasons: REACT_SCRIPTS_REFUSAL_REASONS[code],
          },
        ]),
      ),
      library: reactScriptsLibraryHelp(),
      limits: [
        `Only react-scripts ${REACT_SCRIPTS_SUPPORTED_MAJOR} is supported; react-scripts 4 is refused (REACT_SCRIPTS_UNSUPPORTED, react-scripts-version).`,
        "A stop in node_modules is refused (REACT_SCRIPTS_SEAL_FAILED, node-modules) because a published package is not the checked-out library: stop in the Example's own source, or, for an Example in a library repository, declare library (see the library section). Stops must lie inside the app's own folder, or in the library's checked-out source when library is declared.",
        'The start script must be exactly react-scripts start, optionally after NAME=value assignments; any other form (cross-env, extra arguments, a wrapper) is refused. A prestart script is refused. Codebook runs no project script.',
        "Codebook sets CI=true, HOST, PORT and BROWSER for a react-scripts start, overriding the start script's assignments of the same names (PORT is set to the value the script declares, else 3000); a CI, HOST or BROWSER assignment of the script has no effect.",
        'Browser stops only: participant "server" is refused with react-scripts-dev.',
      ],
      studies:
        'A react-scripts-dev run is saved as study format 11 (.study.v11.json) with its retained configuration, whether packageRoot is absent, "." or a nested folder. An older Codebook lists a format 11 study as saved by a newer Codebook; update Codebook to open it. It replays from recorded evidence after the app has stopped.',
    },
  }
}
