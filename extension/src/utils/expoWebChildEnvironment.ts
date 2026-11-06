import { buildViteEnvironment } from './launchViteDevelopmentServer'

/** The Node option that makes `localhost` resolve to IPv4 first, so Metro's `--localhost` bind lands on 127.0.0.1, the address of the owned origin (measured with Expo 57 on Node 24: without it the bind is `[::1]` and 127.0.0.1 does not answer). */
const EXPO_WEB_IPV4_FIRST_NODE_OPTION = '--dns-result-order=ipv4first'

/**
 * Builds the complete environment of the Expo CLI process: the allowlist, the script's assignments, then the values Codebook sets, which win.
 *
 * Why it exists: `NODE_OPTIONS` gains {@link EXPO_WEB_IPV4_FIRST_NODE_OPTION} after any options the environment would otherwise carry, so the loopback-only bind of the CLI's `--localhost` is the IPv4 one. `CI`, `BROWSER` and `EXPO_NO_TELEMETRY` keep the CLI non-interactive, away from a browser and off the network for telemetry; an assignment of the same name in the app's web script must not change them (E-3, E-13). It is also the base environment the `.env` references resolve against, so the mask list and the spawn read one source of truth. Called by {@link launchExpoWebDevelopmentServer} and {@link assessExpoWebWorkspace}.
 * @param assignments - The `NAME=value` assignments of the accepted web script.
 * @returns The environment.
 * @example buildExpoWebEnvironment({ CI: '0' }) // => { …, BROWSER: 'none', CI: '1', EXPO_NO_TELEMETRY: '1', NODE_OPTIONS: '--dns-result-order=ipv4first' }
 */
export function buildExpoWebEnvironment(
  assignments: Record<string, string>,
): NodeJS.ProcessEnv {
  // The Vite environment is the neutral allowlist + assignments + BROWSER=none + no colors; only the overrides below are Expo's own.
  const base = buildViteEnvironment(assignments)
  // Append to whatever options the child would otherwise get, never replace them.
  const nodeOptions = [base.NODE_OPTIONS, EXPO_WEB_IPV4_FIRST_NODE_OPTION]
    .filter((option) => option !== undefined && option !== '')
    .join(' ')
  return {
    ...base,
    NODE_OPTIONS: nodeOptions,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
  }
}
