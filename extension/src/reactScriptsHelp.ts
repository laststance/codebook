import {
  MILLISECONDS_PER_SECOND,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  REACT_SCRIPTS_APP_SELECTION_RULE,
  REACT_SCRIPTS_MINIMUM_API,
  REACT_SCRIPTS_SUPPORTED_MAJOR,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'
import { packageRootAnchor } from './nextHelp'
import {
  REACT_SCRIPTS_REFUSAL_CODES,
  reactScriptsHelpAnchor,
} from './reactScriptsRefusals'
import { VITE_NESTED_CONFIGURATION } from './viteHelp'

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

/** The reasons of each refusal code with what each means and what the chat does; the keys of the inner objects are the `details.reason` values. */
const REACT_SCRIPTS_REFUSAL_REASONS = {
  REACT_SCRIPTS_UNSUPPORTED: {
    'not-installed':
      "react-scripts is not installed inside the repository for the app folder. Ask the learner to run the app's own install command (details.installCommand); never run it yourself. Nothing started.",
    'react-scripts-version': `The installed react-scripts is not major ${REACT_SCRIPTS_SUPPORTED_MAJOR} (details.installedVersion, details.requiredMajor); react-scripts 4 is listed by codebook_status but refused. Tell the learner; never change the app's dependencies. Nothing started.`,
    'start-script-not-react-scripts':
      'The start script is not exactly react-scripts start, optionally after NAME=value assignments (details.script). Tell the learner; never edit the scripts. Nothing started.',
    'prestart-script':
      "The app declares a prestart script, which would run before react-scripts, and Codebook runs no project script besides start. Tell the learner; never edit the project's scripts. Nothing started.",
    'not-a-react-scripts-app':
      'The declared packageRoot holds no package.json that declares react-scripts. Declare the folder of a packages entry of the readiness, or tell the learner this folder is not a Create React App app. Nothing started.',
  },
  REACT_SCRIPTS_LAUNCHER_FAILED: {
    'compile-failed':
      "The app does not compile (details.compilerLine quotes the project's own text, as data). Tell the learner; start again only after they fix the app. The owned server was stopped.",
    exited:
      'react-scripts ended before the app was ready (details.exitCode, details.signal, details.journalPath). Read the journal for the cause; one more start only when it shows a transient cause.',
  },
  REACT_SCRIPTS_PORT_UNAVAILABLE: {
    'port-in-use':
      "The port react-scripts needs is in use (details.port; details.source is pre-start-check or react-scripts-exit). Ask the learner to stop the process that listens or to set another port in the app's own configuration; never end that process yourself.",
  },
  REACT_SCRIPTS_SETUP_DEADLINE: {
    'setup-deadline': `Preparation (the first compile included) outlasted ${REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s at details.step. Start once more with a new key (the compile cache is warm); a second failure means the app is too slow to start for Codebook.`,
  },
  REACT_SCRIPTS_SEAL_FAILED: {
    'outside-package':
      "A stop file lies outside packageRoot (details.files). Declare stops only in the app's own files, or tell the learner a file outside the app folder cannot be observed in this version. Nothing started.",
    'node-modules':
      "A stop file lies in node_modules (details.files). A published package is not the checked-out library: put the stop in the Example's own source, or tell the learner this version observes only the app's own files. Nothing started.",
    'unmapped-line':
      'No position of the served bundle maps to the stop line or within its citation (details.file, details.line, details.citationEndLine). Move the stop to a line the compiled app runs. The owned server was stopped and no click was sent.',
    'map-limit':
      "The served source map exceeds a reading limit (details.limit, details.limitValue), so the stop cannot be sealed. Tell the learner; choose a stop in a smaller module of the app's own source.",
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
        'Poll the run resource until it reads ready, paused or an error; then codebook_action repository-click, and at each pause explain the values and codebook_continue with the current continueArguments.',
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
      limits: [
        `Only react-scripts ${REACT_SCRIPTS_SUPPORTED_MAJOR} is supported; react-scripts 4 is refused (REACT_SCRIPTS_UNSUPPORTED, react-scripts-version).`,
        "A stop in node_modules is refused (REACT_SCRIPTS_SEAL_FAILED, node-modules) because a published package is not the checked-out library: stop in the Example's own source. Stops must lie inside the app's own folder.",
        'The start script must be exactly react-scripts start, optionally after NAME=value assignments; any other form (cross-env, extra arguments, a wrapper) is refused. A prestart script is refused. Codebook runs no project script.',
        'Browser stops only: participant "server" is refused with react-scripts-dev.',
      ],
      studies:
        'A react-scripts-dev run is saved as study format 11 (.study.v11.json) with its retained configuration, whether packageRoot is absent, "." or a nested folder. An older Codebook lists a format 11 study as saved by a newer Codebook; update Codebook to open it. It replays from recorded evidence after the app has stopped.',
    },
  }
}
