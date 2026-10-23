import {
  DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES,
  REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS,
} from '../constants'

/**
 * Builds the complete environment of the owned `next dev` process.
 *
 * Called by {@link launchDevelopmentServer} when it spawns the app and by {@link readDeclaredDevelopmentPort} to expand `$VAR` references in `.env*` files against what Next itself will see.
 * Credentials and unrelated application configuration stay outside: only the variables named in {@link DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES} are inherited.
 *
 * @param host - The extension host's environment to inherit from.
 * @returns A new environment object; entries the host lacks are `undefined`.
 *
 * @example
 * ```ts
 * const environment = buildDevelopmentServerEnvironment({ PATH: '/bin' }) // PATH, CI and HUSKY are set
 * ```
 */
export function buildDevelopmentServerEnvironment(
  host: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    NEXT_TELEMETRY_DISABLED: '1',
    // Next's default100ms child cutoff can kill native lock cleanup before this closer's bounded wait.
    NEXT_EXIT_TIMEOUT_MS: String(REPOSITORY_APPLICATION_EXIT_TIMEOUT_MS),
    HUSKY: '0',
    CI: 'true',
  }
  // Inherit only basic process settings; credentials and unrelated application configuration stay outside the owned process.
  for (const name of DEVELOPMENT_SERVER_INHERITED_ENVIRONMENT_NAMES)
    environment[name] = host[name]
  return environment
}
