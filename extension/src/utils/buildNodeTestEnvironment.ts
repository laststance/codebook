/** Process settings an owned Node test may inherit; account credentials and unrelated variables stay out. */
const INHERITED_VARIABLES = ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'PNPM_HOME', 'USER', 'LOGNAME'] as const;

/**
 * Builds the one restricted environment shared by an owned Vitest run and its file-listing preflight.
 *
 * Vitest configurations may branch on `CI` or `NODE_ENV`, so the preflight must see the same values as the run it predicts.
 * Called by {@link launchNodeTest} and {@link listVitestTestFiles}.
 *
 * @param inherited - The editor host environment to copy the allowed settings from.
 * @returns `CI=true`, `NODE_ENV=test` and only the allowed basic settings present in `inherited`.
 * @example
 * ```ts
 * buildNodeTestEnvironment({ PATH: '/usr/bin', GITHUB_TOKEN: 'x' }) // => { CI: 'true', NODE_ENV: 'test', PATH: '/usr/bin' }
 * ```
 */
export function buildNodeTestEnvironment(inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: 'true', NODE_ENV: 'test' };
  for (const name of INHERITED_VARIABLES) if (inherited[name]) environment[name] = inherited[name];
  return environment;
}
