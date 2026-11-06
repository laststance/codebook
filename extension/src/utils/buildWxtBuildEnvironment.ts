import { buildDevelopmentServerEnvironment } from './developmentServerEnvironment'

/**
 * Builds the complete environment of the WXT build process.
 *
 * Why it exists: the project's `wxt.config` and Vite plugins run inside the build, so credentials and `NODE_OPTIONS` of the extension host must not reach it.
 * Called by {@link buildWxtExtension} when it prepares the spawn request. It reuses the allow-list of {@link buildDevelopmentServerEnvironment} and drops the Next-only entries.
 *
 * @param host - The extension host's environment to inherit from.
 * @returns A new environment object with only the allow-listed variables, `CI` and `HUSKY`.
 * @example
 * ```ts
 * buildWxtBuildEnvironment({ PATH: '/bin', GITHUB_TOKEN: 'x' }) // => PATH, CI and HUSKY; no GITHUB_TOKEN
 * ```
 */
export function buildWxtBuildEnvironment(
  host: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = buildDevelopmentServerEnvironment(host)
  // The Next-only settings mean nothing to WXT.
  for (const name of Object.keys(environment))
    if (name.startsWith('NEXT_')) delete environment[name]
  return environment
}
