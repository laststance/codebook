import {
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
  REACT_SCRIPTS_OPENSSL_LEGACY_OPTION,
  REACT_SCRIPTS_OPENSSL_MIN_NODE_MAJOR,
} from '../constants'

import { buildViteEnvironment } from './launchViteDevelopmentServer'

/** What decides the Node options of a react-scripts child: the installed react-scripts major and the major of the Node executable that runs `start.js` (absent when it was not read, which only a react-scripts 5 run may leave). */
export type ReactScriptsRuntime = {
  reactScriptsMajor: number
  nodeMajor?: number
}

/**
 * Builds the complete environment of the react-scripts process: the allowlist, the script's assignments, then the values Codebook sets, which win.
 *
 * Why it exists: `HOST`, `PORT` and `BROWSER` decide where the server listens and whether it opens a browser, and `CI=true` keeps start.js from exiting when its stdin (none) ends; a script assignment of the same name must not change them. It is also the base environment `.env` references resolve against, so the mask list and the spawn read one source of truth. Called by {@link launchReactScriptsDevelopmentServer} once per launch and by {@link readReactScriptsAppSettings}.
 * @param assignments - The `NAME=value` assignments of the accepted `start` script.
 * @param port - The port the run listens on.
 * @param runtime - The installed react-scripts major and the major of the Node executable that runs `start.js`; react-scripts 4 on Node 17 or later gets {@link REACT_SCRIPTS_OPENSSL_LEGACY_OPTION} in `NODE_OPTIONS` (webpack 4 hashes with MD4, which OpenSSL 3 refuses). Major 5 and Node 16 or older add nothing.
 * @param host - The editor's environment, read for a `NODE_OPTIONS` the start script does not assign.
 * @returns The environment.
 * @example buildReactScriptsEnvironment({ PORT: '4000', HOST: '0.0.0.0' }, 3000, { reactScriptsMajor: 5 }) // => { …, PORT: '3000', HOST: '127.0.0.1', BROWSER: 'none', CI: 'true' }
 * @example buildReactScriptsEnvironment({ NODE_OPTIONS: '--max-old-space-size=4096' }, 3000, { reactScriptsMajor: 4, nodeMajor: 24 }).NODE_OPTIONS // => '--max-old-space-size=4096 --openssl-legacy-provider'
 */
export function buildReactScriptsEnvironment(
  assignments: Record<string, string>,
  port: number,
  runtime: ReactScriptsRuntime,
  host: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // The Vite environment is the neutral allowlist + assignments + no colors; only the overrides below are react-scripts' own.
  const environment: NodeJS.ProcessEnv = {
    ...buildViteEnvironment(assignments),
    HOST: '127.0.0.1',
    PORT: String(port),
    BROWSER: 'none',
    CI: 'true',
  }
  const needsLegacyProvider =
    runtime.reactScriptsMajor === 4 &&
    runtime.nodeMajor !== undefined &&
    runtime.nodeMajor >= REACT_SCRIPTS_OPENSSL_MIN_NODE_MAJOR
  if (!needsLegacyProvider) return environment
  // The learner's value is the start script's assignment when it has one, else the editor's; the option is added once.
  const learnerOptions = assignments.NODE_OPTIONS ?? host.NODE_OPTIONS ?? ''
  const alreadyThere = learnerOptions
    .split(/\s+/)
    .includes(REACT_SCRIPTS_OPENSSL_LEGACY_OPTION)
  environment.NODE_OPTIONS = alreadyThere
    ? learnerOptions
    : [learnerOptions.trim(), REACT_SCRIPTS_OPENSSL_LEGACY_OPTION]
        .filter((part) => part !== '')
        .join(' ')
  return environment
}

/**
 * Reads the port a react-scripts start declares: the script's `PORT` assignment, else react-scripts' default.
 * @param assignments - The `start` script's assignments.
 * @returns The port and where it was declared.
 * @example declaredReactScriptsPort({ PORT: '4000' }) // => { port: 4000, source: 'the start script PORT' }
 */
export function declaredReactScriptsPort(assignments: Record<string, string>): {
  port: number
  source: string
} {
  const port = Number(assignments.PORT)
  if (Number.isInteger(port) && port > 0 && port <= DEVELOPMENT_SERVER_MAX_PORT)
    return { port, source: 'the start script PORT' }
  return {
    port: DEVELOPMENT_SERVER_DEFAULT_PORT,
    source: "react-scripts' default port",
  }
}
