import { buildViteEnvironment } from './launchViteDevelopmentServer'

/**
 * Builds the complete environment of the Expo CLI process: the allowlist, the script's assignments, then the values Codebook sets, which win.
 *
 * Why it exists: `CI`, `BROWSER` and `EXPO_NO_TELEMETRY` keep the CLI non-interactive, away from a browser and off the network for telemetry; an assignment of the same name in the app's web script must not change them (E-3, E-13). It is also the base environment the `.env` references resolve against, so the mask list and the spawn read one source of truth. Called by {@link launchExpoWebDevelopmentServer} and {@link assessExpoWebWorkspace}.
 * @param assignments - The `NAME=value` assignments of the accepted web script.
 * @returns The environment.
 * @example buildExpoWebEnvironment({ CI: '0' }) // => { …, BROWSER: 'none', CI: '1', EXPO_NO_TELEMETRY: '1' }
 */
export function buildExpoWebEnvironment(
  assignments: Record<string, string>,
): NodeJS.ProcessEnv {
  // The Vite environment is the neutral allowlist + assignments + BROWSER=none + no colors; only the overrides below are Expo's own.
  return {
    ...buildViteEnvironment(assignments),
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
  }
}
