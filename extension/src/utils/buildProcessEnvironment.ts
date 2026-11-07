import { buildDevelopmentServerEnvironment } from './developmentServerEnvironment'

/**
 * Builds the complete environment of a build process (the WXT build, the library build).
 *
 * Why it exists: the project's build code (`wxt.config`, Vite plugins, package scripts) runs inside the build, so credentials and `NODE_OPTIONS` of the extension host must not reach it.
 * Called by {@link buildWxtExtension} and the library build when they prepare the spawn request. It reuses the allow-list of {@link buildDevelopmentServerEnvironment} and drops the Next-only entries.
 *
 * @param host - The extension host's environment to inherit from.
 * @param additions - Variables the caller sets on top of the allow-list (for example a `PATH` that starts with the external Node); they win over inherited ones.
 * @returns A new environment object with only the allow-listed variables, `CI`, `HUSKY` and the additions.
 * @example
 * ```ts
 * buildProcessEnvironment({ PATH: '/bin', GITHUB_TOKEN: 'x' }) // => PATH, CI and HUSKY; no GITHUB_TOKEN
 * buildProcessEnvironment({ PATH: '/bin' }, { PATH: '/node/bin:/bin' }) // => PATH is '/node/bin:/bin'
 * ```
 */
export function buildProcessEnvironment(
  host: NodeJS.ProcessEnv = process.env,
  additions: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const environment = buildDevelopmentServerEnvironment(host)
  // The Next-only settings mean nothing to a build.
  for (const name of Object.keys(environment))
    if (name.startsWith('NEXT_')) delete environment[name]
  return { ...environment, ...additions }
}
