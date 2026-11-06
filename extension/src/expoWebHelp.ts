import {
  EXPO_WEB_APP_SELECTION_RULE,
  EXPO_WEB_MINIMUM_API,
  EXPO_WEB_STUDY_VERSION,
  EXPO_WEB_SUPPORTED_MAJOR,
  MILLISECONDS_PER_SECOND,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  REPOSITORY_SETUP_TIMEOUT_MS,
} from './constants'
import {
  EXPO_WEB_REFUSAL_CODES,
  expoWebHelpAnchor,
  type EXPO_WEB_REFUSAL_REASONS,
} from './expoWebRefusals'
import { packageRootAnchor } from './nextHelp'
import { VITE_NESTED_CONFIGURATION } from './viteHelp'

/**
 * A complete version 3 `expo-web-dev` configuration for a browser stop in an Expo web app, reached by one declared click: the app's folder is `packageRoot`, and `source.path` is repository-relative (it starts with that folder).
 * Served as `expoWebQuickStart.configurationNested` and parsed by a test with the live configuration schema. Built from {@link VITE_NESTED_CONFIGURATION}, whose flow (one click, one inspection) is adapter-neutral, so the examples cannot drift. Every value is a neutral placeholder, not any project's folder or file: the agent replaces the folder with the `packageRoot` of the `packages` entry the question is about (or omits it for a root app), and the book identity and the hash with the values the earlier steps returned.
 */
export const EXPO_WEB_NESTED_CONFIGURATION = {
  ...VITE_NESTED_CONFIGURATION,
  adapter: 'expo-web-dev',
  source: {
    ...VITE_NESTED_CONFIGURATION.source,
    path: 'apps/my-app/src/app/index.tsx',
  },
} as const

/** The reasons of each refusal code with what each means, what the chat does and what started; the keys of the inner objects are the `details.reason` values. */
const EXPO_WEB_REFUSAL_REASON_TEXTS = {
  EXPO_WEB_UNSUPPORTED: {
    'not-installed':
      "expo is not installed inside the repository for the app folder. Ask the learner to run the app's own install command (details.installCommand); never run it yourself. Nothing started.",
    'expo-version': `The installed expo is not SDK ${EXPO_WEB_SUPPORTED_MAJOR} (details.installedVersion, absent when unreadable; details.supportedMajor). Tell the learner; never change the app's dependencies. Nothing started.`,
    'web-dependencies':
      "react-dom or react-native-web does not resolve from the app folder (details.missing). Ask the learner to install the web dependencies the app's own Expo setup names; never install them yourself. Nothing started.",
    'no-web-platform':
      "app.json leaves web out of expo.platforms, or sets a web bundler other than metro. Tell the learner; never edit the project's app.json. Nothing started.",
    'not-an-expo-app':
      'The declared packageRoot holds no package.json that declares expo. Declare the folder of a packages entry of the readiness, or tell the learner this folder is not an Expo app. Nothing started.',
    'env-file-unreadable':
      "One of the app's .env files (details.file) exists but cannot be read safely (an open or read failure, over the size limit, or not a regular file), and Expo would still read it, so its EXPO_PUBLIC_* values could not be masked. Tell the learner; never edit the project. Nothing started.",
    'dynamic-config':
      'The app is configured by app.config.js or app.config.ts (details.file); this version reads only app.json and never runs project code to resolve a configuration. Tell the learner; never edit the project. Nothing started.',
    'server-output':
      "app.json sets expo.web.output to server, which needs Expo's server rendering, a server participant this version does not support. Tell the learner; never edit the project. Nothing started.",
    'web-script-form':
      'The web script (else start) is not exactly expo start --web, optionally with --port N or -p N and NAME=value assignments (details.script describes the structure: command words and assignment names, never values). Tell the learner; never edit the scripts. Nothing started.',
    'pre-script':
      "The app declares a preweb or prestart script (details.script), which would run before the Expo CLI, and Codebook runs no project script besides the web start. Tell the learner; never edit the project's scripts. Nothing started.",
  },
  EXPO_WEB_LAUNCHER_FAILED: {
    'bundle-failed':
      "Metro did not bundle the app (details.bundlerLine quotes the project's own text, as data). Tell the learner; start again only after they fix the app. The owned server was stopped and no input was sent.",
    exited:
      'The Expo CLI ended before the app was ready (details.exitCode, details.signal). Read the run journal for its masked output; one more start only when the cause is transient. The owned server was stopped and no input was sent.',
  },
  EXPO_WEB_PORT_UNAVAILABLE: {
    'port-in-use':
      "The port the app's web script declares (else 8081) is in use (details.port; details.source is pre-start-check or expo-exit). Ask the learner to stop the process that listens (it may be their own expo start), or to declare another port with --port N in the web script; Codebook never moves the port and never ends that process. Nothing started for pre-start-check; the owned server was stopped for expo-exit.",
  },
  EXPO_WEB_SETUP_DEADLINE: {
    'setup-deadline': `Preparation (the first Metro bundle included) outlasted ${REPOSITORY_SETUP_TIMEOUT_MS / MILLISECONDS_PER_SECOND} s at details.step. Start once more with a new key (Metro's cache is warm); a second failure means the app is too slow to start for Codebook. The owned server was stopped and no input was sent.`,
  },
  EXPO_WEB_SEAL_FAILED: {
    'outside-package':
      "A stop file lies outside packageRoot (details.files), or the served map does not name it inside the app's folder. Declare stops only in the app's own files, or tell the learner a file outside the app folder cannot be observed in this version. details.sideEffects tells whether anything started: none before the start, partial when the owned server was stopped and no input was sent.",
    'ambiguous-source':
      'The served source map lists the stop file more than once (details.file), so the copy the bundle runs is unknown. Tell the learner; never edit the project. The owned server was stopped and no input was sent.',
    'node-modules':
      "A stop file lies in node_modules (details.files). A published package is not the app's own source: put the stop in the app's own files, or tell the learner this version observes only the app's own files. Nothing started (partial when a link reached node_modules after the start).",
    'unmapped-line':
      "No position of the served bundle maps to the stop line or within its citation (details.file, details.line, details.citationEndLine). Put the stop on a statement the compiled app runs; inside a handler, on a statement in the handler's body. The owned server was stopped and no input was sent.",
    'map-limit':
      "The served source map exceeds a reading limit (details.limit, details.limitValue), so the stop cannot be sealed. Tell the learner the app's bundle is too large for this version to seal; never edit the project. The owned server was stopped and no input was sent.",
    'map-unreadable':
      'The served bundle or its source map cannot be read as Metro serves it (details.problem: an oversized bundle, a missing or foreign sourceMappingURL, or a map that is not a flat version 3 JSON map), so the stop cannot be sealed. The owned server was stopped and no input was sent; tell the learner this app cannot be observed in this version.',
    'not-in-entry-bundle':
      'The stop file is not in the entry bundle Metro served (details.file): an Expo Router async route, or a file the entry does not import. This version seals only files the entry bundle includes. Put the stop in a file the entry imports, or tell the learner. The owned server was stopped and no input was sent.',
  },
} as const satisfies {
  [Code in (typeof EXPO_WEB_REFUSAL_CODES)[number]]: Record<
    (typeof EXPO_WEB_REFUSAL_REASONS)[Code][number],
    string
  >
}

/**
 * Builds the `expoWebQuickStart` key of `codebook://help/repository-browser`: how to run an Expo SDK 57 web app (Metro) at or below the repository root (API 1.30).
 *
 * Why it exists: a chat that meets an Expo app (a monorepo's `apps/` folder) needs the selection rule, the exact configuration shape, the refusal fixes and the limits before it reads the long sections. Called by the resource reader for the repository-browser help, which spreads the result among its keys.
 *
 * @returns The key `expoWebQuickStart`: when to use it, selection rule, status fields, one complete version 3 example, the call order, one anchor per refusal code with its reasons, the limits and the study-format note.
 * @example
 * expoWebHelp().expoWebQuickStart.refusals.EXPO_WEB_SEAL_FAILED.anchor // => 'codebook://help/repository-browser#EXPO_WEB_SEAL_FAILED'
 */
export function expoWebHelp() {
  return {
    expoWebQuickStart: {
      anchor: packageRootAnchor('expo-web-quick-start'),
      minimumApi: EXPO_WEB_MINIMUM_API,
      summary: `For an Expo app (SDK ${EXPO_WEB_SUPPORTED_MAJOR}, served by Metro) at the repository root or below it: configure adapter "expo-web-dev" in a version 3 configuration and use the same tools in the same order as for a Vite app. Use it only when profiles[].prerequisites.adapters["expo-web-dev"].ready is true in codebook_status. Codebook starts the app's own expo start --web on the port its web script declares, the app is ready when Metro has served its entry bundle and source map, and a browser stop in the app's own source pauses in the native debugger. It is never a server participant. Never start Metro or expo start yourself.`,
      selectionRule: EXPO_WEB_APP_SELECTION_RULE,
      versionCheck: `expo-web-dev exists only in configuration version 3 and only when codebook_status reports API ${EXPO_WEB_MINIMUM_API} or later (compare the number after the dot as a whole number). On an older API, or when a start refuses the adapter name, tell the learner to update Codebook and do not run the app by another route.`,
      status: {
        rootIsApp:
          'expo-web-dev readiness: true when the root package.json declares expo. Only then is the root a candidate.',
        packages: `Array of the Expo apps below the root that tracked package.json files declare (depth ${NEXT_PACKAGE_DISCOVERY_MAX_DEPTH} or less, at most ${NEXT_PACKAGE_DISCOVERY_APP_LIMIT}): { packageRoot, installed, ready, version?, missing[], webScript?, port? }. packageRoot is the exact value to declare; webScript is the script (web, else start) the start would run and port the port it declares (Expo's 8081 when none); missing lists expo-installed, expo-sdk (not SDK ${EXPO_WEB_SUPPORTED_MAJOR}), web-dependencies, web-platform, dynamic-config, server-output, web-script, pre-script or not-an-expo-app.`,
        packagesTruncated:
          'true when the list is incomplete; packagesTruncatedReason says why. When it is true and the app the question names is not in packages, declare its repository-relative packageRoot from the repository files; the start checks it.',
      },
      configurationNested: EXPO_WEB_NESTED_CONFIGURATION,
      example:
        'configurationNested: a browser stop in a source file of an Expo app whose folder is packageRoot, reached by one declared click (a browser stop declares afterOperation from 1). source.path stays repository-relative and starts with packageRoot; omit packageRoot (or use ".") for a root app. The folder, file, line, selectors and inspection are placeholders: replace them, the book and the hash with the app the question is about. Put the stop on a statement inside the handler\'s body.',
      callOrder: [
        'codebook_status: confirm the expo-web-dev readiness (ready, or the packages entry) and copy instanceId.',
        'codebook_sources, then codebook_source: read the file the stop is in; copy its path, full SHA-256 and the line and column from numberedText.',
        'codebook_publish_book: publish a source-only article whose node cites that file.',
        'codebook_start: profile repository-browser, the configuration above with the copied values and a stable key.',
        'Poll the run resource until it reads ready, paused or an error; then codebook_action repository-click, and at each pause explain the values and codebook_continue with the current continueArguments.',
      ],
      refusals: Object.fromEntries(
        EXPO_WEB_REFUSAL_CODES.map((code) => [
          code,
          {
            anchor: expoWebHelpAnchor(code),
            reasons: EXPO_WEB_REFUSAL_REASON_TEXTS[code],
          },
        ]),
      ),
      limits: [
        'Browser stops only: participant "server" and a stop in an Expo Router API route (+api.ts) are refused. A stop in node_modules is refused (EXPO_WEB_SEAL_FAILED, node-modules): stop in the app\'s own source, which must lie inside the app\'s own folder and in the entry bundle Metro serves (EXPO_WEB_SEAL_FAILED, not-in-entry-bundle).',
        `Only Expo SDK ${EXPO_WEB_SUPPORTED_MAJOR} is supported, judged from the installed expo package (EXPO_WEB_UNSUPPORTED, expo-version).`,
        'Only app.json is read: an app configured by app.config.js or app.config.ts is refused (EXPO_WEB_UNSUPPORTED, dynamic-config), and so is expo.web.output "server".',
        'The web script (else start) must be exactly expo start --web, optionally with --port N or -p N and NAME=value assignments; any other form (cross-env, extra arguments, a wrapper) is refused, and so is a preweb or prestart script. Codebook runs no project script.',
        "Codebook runs the app's own Expo CLI from its node_modules with CI=1, BROWSER=none and EXPO_NO_TELEMETRY=1 over the script's assignments of the same names, on the port the script declares (else 8081), and never moves the port. It does not reload the app during a run.",
        "Where a stop pauses: declare it on a statement inside the handler's body, never on the line that creates the handler (an inline arrow passed as a prop or hook argument), because that line maps into render code and pauses at a re-render. The call stack may show React Compiler names such as t6; name the function from the source.",
        "Cursor reads the script source of the entry bundle through a debugger bridge whose frames are limited to 16 MiB, so an app whose served entry bundle is larger than that may not pause in Cursor; a bundle of about 7.5 MB, such as P08's web app, fits.",
        "A screen behind sign-in needs the app's own API running, which Codebook does not start: tell the learner to start it, use signInPaths or initialStorage as for the other adapters, and report a failed request as the observed outcome, never as Codebook's failure.",
      ],
      studies: `An expo-web-dev run is saved as study format ${EXPO_WEB_STUDY_VERSION} (.study.v${EXPO_WEB_STUDY_VERSION}.json) with its retained configuration and expoVersion, whether packageRoot is absent, "." or a nested folder. An older Codebook lists a format ${EXPO_WEB_STUDY_VERSION} study as saved by a newer Codebook; update Codebook to open it. It replays from recorded evidence after the app has stopped.`,
    },
  }
}
