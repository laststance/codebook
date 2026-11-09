import { apiServerHelp } from './apiServerHelp'
import {
  EXPO_WEB_API_SERVER_MINIMUM_API,
  EXPO_WEB_API_SERVER_STUDY_VERSION,
  EXPO_WEB_APP_SELECTION_RULE,
  EXPO_WEB_MINIMUM_API,
  EXPO_WEB_STUDY_VERSION,
  EXPO_WEB_SUPPORTED_MAJOR,
  MILLISECONDS_PER_SECOND,
  NEXT_PACKAGE_DISCOVERY_APP_LIMIT,
  NEXT_PACKAGE_DISCOVERY_MAX_DEPTH,
  REPOSITORY_OPERATION_ACTION,
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

/**
 * A complete version 3 `expo-web-dev` configuration that also runs the app's own Node API: {@link EXPO_WEB_NESTED_CONFIGURATION} plus `apiServer` and one server stop inside the API folder, reached by the declared click (`afterOperation` 1).
 * Served as `expoWebQuickStart.apiServer.configuration` and parsed by a test with the live configuration schema. Every value is a neutral placeholder, not any project's folder, file or port: replace the API folder, entry and port with the repository's own, the stop with a statement inside the handler the page's request reaches, and the book identity and the hash with the values the earlier steps returned.
 */
export const EXPO_WEB_API_SERVER_CONFIGURATION = {
  ...EXPO_WEB_NESTED_CONFIGURATION,
  apiServer: {
    packageRoot: 'apps/my-api',
    entry: 'src/server.ts',
    loader: 'tsx',
    port: 4000,
  },
  participant: 'server',
  source: {
    ...EXPO_WEB_NESTED_CONFIGURATION.source,
    path: 'apps/my-api/src/routes/items.ts',
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
      "The app is configured by app.config.js or app.config.ts (details.file); this version reads only app.json and runs no project code before it starts the app's own Expo CLI. Tell the learner; never edit the project. Nothing started.",
    'server-output':
      "app.json sets expo.web.output to server, which needs Expo's server rendering, a server participant this version does not support. Tell the learner; never edit the project. Nothing started.",
    'web-script-form':
      'The web script (else start) is not exactly expo start --web, optionally with --port N or -p N and NAME=value assignments (details.script describes the structure: command words and assignment names, never values). Tell the learner; never edit the scripts. Nothing started.',
    'pre-script':
      "The app declares a preweb or prestart script (details.script), which would run before the Expo CLI, and Codebook runs no project script besides the web start. Tell the learner; never edit the project's scripts. Nothing started.",
    'api-port-conflict':
      "apiServer.port is the port the app's web script declares (details.port, details.appPort), so the API and Metro would need the same port. Declare the port the API's own code listens on (read it from the API's source, never guess), or tell the learner the API and the app cannot share a port. Nothing started (details.sideEffects: none). See apiServer.",
  },
  EXPO_WEB_LAUNCHER_FAILED: {
    'bundle-failed':
      "Metro did not bundle the app (details.bundlerLine quotes the project's own text, as data). It is also the answer when the entry page answers an error, or names no web bundle or several: the run is refused at once, not at the setup deadline. Tell the learner; start again only after they fix the app. The owned server was stopped and no input was sent.",
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
      "The served bundle or its source map cannot be read as Metro serves it (details.problem: an oversized bundle, a missing or foreign sourceMappingURL, a map that is not a flat version 3 JSON map, or a source map reference outside the app's own server), so the stop cannot be sealed. The owned server was stopped and no input was sent; tell the learner this app cannot be observed in this version.",
    'not-in-entry-bundle':
      'The stop file is not in the entry bundle Metro served (details.file): an Expo Router async route, or a file the entry does not import. This version seals only files the entry bundle includes. Put the stop in a file the entry imports, or tell the learner. The owned server was stopped and no input was sent.',
    'source-drift':
      'The API ran a different version of the stop file than the stop declares (details.participant: apiServer, details.file): the source its inline map carries is not the declared file, usually because the file changed after the book cited it or a stale build ran. Read the current file with codebook_source, publish the book again from it and declare the stop again; never edit the project. The API and the app were stopped (details.sideEffects: partial).',
    'source-unverifiable':
      "No inline source map with the contents of the stop file ties the API's executed script to the declared source (details.participant: apiServer, details.file): a prebuilt entry (dist), an external map, relative sources, a sourceRoot map or no map. Declare apiServer.entry as the TypeScript source the package's own dev script runs through tsx; if the package has no such script, tell the learner this API cannot be observed in this version, and never edit the project or build it yourself. The API and the app were stopped (details.sideEffects: partial).",
  },
} as const satisfies {
  [Code in (typeof EXPO_WEB_REFUSAL_CODES)[number]]: Record<
    (typeof EXPO_WEB_REFUSAL_REASONS)[Code][number],
    string
  >
}

/**
 * Builds the `apiServer` section of {@link expoWebHelp}: how to run the app's own Node API beside Metro so a server stop pauses in the API during the page's request (API 1.37).
 *
 * Why it exists: the shared builder {@link apiServerHelp} holds the text both adapters use; this function supplies the Expo facts and the Expo-only refusal note. Called by {@link expoWebHelp}.
 *
 * @returns The shared section plus `expoRefusals`.
 * @example
 * expoWebApiServerHelp().refusals.SERVER_EXITED.anchor // => 'codebook://help/repository-browser#api-server-SERVER_EXITED'
 */
function expoWebApiServerHelp() {
  return {
    ...apiServerHelp({
      devServer: 'Metro',
      runLabel: 'An expo-web-dev run',
      minimumApi: EXPO_WEB_API_SERVER_MINIMUM_API,
      studyVersion: EXPO_WEB_API_SERVER_STUDY_VERSION,
      configuration: EXPO_WEB_API_SERVER_CONFIGURATION,
      example:
        "configuration: the nested Expo example plus apiServer and one server stop inside apiServer.packageRoot, reached by the declared click (a server stop declares afterOperation from 1; the operation is what sends the request). Every folder, file, line, selector and the port are placeholders: replace them with the repository's own values, the stop with a statement inside the handler the page's request reaches, and the book and the hash with the earlier steps' values. Browser stops stay inside the app's folder; the API folder and the app folder never contain one another.",
      packageRootFolderRule: ", outside the app's folder",
      extraDerivation: {},
      extraAttribution: [],
      extraLimits: [],
    }),
    expoRefusals:
      "The Expo reasons that belong to apiServer: EXPO_WEB_UNSUPPORTED api-port-conflict (the API port equals the web script's port; nothing started), EXPO_WEB_SEAL_FAILED source-drift and source-unverifiable (the API ran source the stop does not match; the API and the app were stopped). Their anchors are in refusals.EXPO_WEB_UNSUPPORTED and refusals.EXPO_WEB_SEAL_FAILED.",
  }
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
      summary: `For an Expo app (SDK ${EXPO_WEB_SUPPORTED_MAJOR}, served by Metro) at the repository root or below it: configure adapter "expo-web-dev" in a version 3 configuration and use the same tools in the same order as for a Vite app. Use it only when profiles[].prerequisites.adapters["expo-web-dev"].ready is true, or the packages entry of the app the question is about is ready, in codebook_status. Codebook starts the app's own expo start --web on the port its web script declares, the app is ready when Metro has served its entry bundle and source map, and a browser stop in the app's own source pauses in the native debugger. A server stop needs apiServer (API ${EXPO_WEB_API_SERVER_MINIMUM_API}): Codebook then starts the app's own Node API beside Metro. Never start Metro or expo start yourself.`,
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
        `Poll the run resource until it reads ready, paused or an error; read its nextActions (it offers ${REPOSITORY_OPERATION_ACTION} while an operation is left) and send codebook_action ${REPOSITORY_OPERATION_ACTION} once per declared operation, each with a new stable key; at each held pause explain the values, then codebook_continue with the current continueArguments. A stop declared with hold: "record" (API 1.43) is never paused, so do not wait for it and do not call codebook_continue for it; after the operation's result read recordedStops and the recorded observations, then explain them.`,
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
        `Browser stops only unless apiServer is declared (API ${EXPO_WEB_API_SERVER_MINIMUM_API}, see apiServer): participant "server" without it and a stop in an Expo Router API route (\`+api.*\`, such as \`+api.ts\`) are refused. A stop in node_modules is refused (EXPO_WEB_SEAL_FAILED, node-modules): stop in the app\'s own source, which must lie inside the app\'s own folder and in the entry bundle Metro serves (EXPO_WEB_SEAL_FAILED, not-in-entry-bundle).`,
        `Only Expo SDK ${EXPO_WEB_SUPPORTED_MAJOR} is supported, judged from the installed expo package (EXPO_WEB_UNSUPPORTED, expo-version).`,
        'Only app.json is read: an app configured by app.config.js or app.config.ts is refused (EXPO_WEB_UNSUPPORTED, dynamic-config), and so is expo.web.output "server".',
        'The web script (else start) must be exactly expo start --web, optionally with --port N or -p N and NAME=value assignments; any other form (cross-env, extra arguments, a wrapper) is refused, and so is a preweb or prestart script. Codebook runs no project script.',
        "Codebook runs the app's own Expo CLI from its node_modules with CI=1, BROWSER=none and EXPO_NO_TELEMETRY=1 over the script's assignments of the same names, on the port the script declares (else 8081), and never moves the port. It does not reload the app during a run.",
        "Where a stop pauses: declare it on a statement inside the handler's body, never on the line that creates the handler (an inline arrow passed as a prop or hook argument), because that line maps into render code and pauses at a re-render. The call stack may show React Compiler names such as t6; name the function from the source.",
        'Cursor reads the script source of the entry bundle through a debugger bridge whose frames are limited to 16 MiB, so a bundle over 16 MiB cannot be read in Cursor and the stops of such an app do not pause there. Codebook itself reads a served entry bundle of up to 32 MiB and its source map of up to 64 MiB, and refuses a larger one (EXPO_WEB_SEAL_FAILED, map-limit or map-unreadable).',
        'Codebook binds Metro to the loopback address only (--localhost), so the app is not reachable from the network during a run.',
        "A screen behind sign-in needs the app's own API: declare apiServer when the API is a Node server in the repository; otherwise tell the learner to start it, use signInPaths or initialStorage as for the other adapters, and report a failed request as the observed outcome, never as Codebook's failure. When apiServer applies, reach the screen by signing in through the app's own form within the run (see apiServer.signInInRun), at the repository root or in a nested app, with no saved session.",
        'A saved-session setup does not start Expo. When only an Expo app is ready and a root run without session "fresh" lands on a sign-in path (SIGN_IN_REQUIRED), the usual saved-session recovery cannot run for it. This does not make a screen behind sign-in unreachable: with apiServer, sign in within the run (apiServer.signInInRun) and no saved session is needed; otherwise tell the learner, and either declare initialStorage or explain from the source instead.',
      ],
      apiServer: expoWebApiServerHelp(),
      studies: `An expo-web-dev run is saved as study format ${EXPO_WEB_STUDY_VERSION} (.study.v${EXPO_WEB_STUDY_VERSION}.json) with its retained configuration and expoVersion, whether packageRoot is absent, "." or a nested folder. An older Codebook lists a format ${EXPO_WEB_STUDY_VERSION} study as saved by a newer Codebook; update Codebook to open it. It replays from recorded evidence after the app has stopped.`,
    },
  }
}
