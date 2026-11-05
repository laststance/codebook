import {
  DEVELOPMENT_SERVER_DEFAULT_PORT,
  DEVELOPMENT_SERVER_MAX_PORT,
} from '../constants'

import { buildViteEnvironment } from './launchViteDevelopmentServer'

/**
 * Builds the complete environment of the react-scripts process: the allowlist, the script's assignments, then the values Codebook sets, which win.
 *
 * Why it exists: `HOST`, `PORT` and `BROWSER` decide where the server listens and whether it opens a browser, and `CI=true` keeps start.js from exiting when its stdin (none) ends; a script assignment of the same name must not change them. It is also the base environment `.env` references resolve against, so the mask list and the spawn read one source of truth. Called by {@link launchReactScriptsDevelopmentServer} once per launch and by {@link readReactScriptsAppSettings}.
 * @param assignments - The `NAME=value` assignments of the accepted `start` script.
 * @param port - The port the run listens on.
 * @returns The environment.
 * @example buildReactScriptsEnvironment({ PORT: '4000', HOST: '0.0.0.0' }, 3000) // => { …, PORT: '3000', HOST: '127.0.0.1', BROWSER: 'none', CI: 'true' }
 */
export function buildReactScriptsEnvironment(
  assignments: Record<string, string>,
  port: number,
): NodeJS.ProcessEnv {
  // The Vite environment is the neutral allowlist + assignments + no colors; only the overrides below are react-scripts' own.
  return {
    ...buildViteEnvironment(assignments),
    HOST: '127.0.0.1',
    PORT: String(port),
    BROWSER: 'none',
    CI: 'true',
  }
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
