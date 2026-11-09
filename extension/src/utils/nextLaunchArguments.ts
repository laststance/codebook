import { nextDevArguments } from './nextDevArguments'

/** What a Next launch may add to the Node command line beside the executable (Cycle 0098, decision D16). */
export type NextLaunchOptions = {
  /** The generated preload of a Next library run: Node runs it with `--require` before the Next executable, so the forked server child inherits it and no `NODE_OPTIONS` is set. Absent for every other run. */
  preloadPath?: string
  /** The identity preload of a run that declares `reverseProxy` (API 1.40) and the secret it answers the proof with: Node runs the preload with `--require` first, and the launch adds the secret to the server's environment. Absent for every other run. */
  identity?: { preloadPath: string; secret: string }
}

/**
 * The Node arguments of a Next launch: an optional preload, the verified Next executable, then Next's own arguments.
 *
 * Why it exists: the preload is a Node option and must come before the executable, or Next would receive it as its own argument. Called by {@link launchDevelopmentServer} for a launch with no launcher spec.
 * @param nextExecutable - The verified `dist/bin/next` the launch runs.
 * @param port - The project's own port.
 * @param options - {@link NextLaunchOptions}; none for a run with neither `library` nor `reverseProxy`.
 * @returns `[--require, <identity preload>,] [--require, <library preload>,] <executable> dev --webpack --hostname 127.0.0.1 --port <port>` as separate words (the server inspector flag is added by the launcher).
 * @example
 * nextLaunchArguments('/app/node_modules/next/dist/bin/next', 3000, { preloadPath: '/tmp/run/preload.cjs' })
 * // => ['--require', '/tmp/run/preload.cjs', '/app/node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000']
 * nextLaunchArguments('/app/node_modules/next/dist/bin/next', 3000, { identity: { preloadPath: '/tmp/run/identity.cjs', secret: 'aa' } })
 * // => ['--require', '/tmp/run/identity.cjs', '/app/node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000']
 */
export function nextLaunchArguments(
  nextExecutable: string,
  port: number,
  options: NextLaunchOptions,
): string[] {
  // The identity preload comes first, then the library preload (the two never occur together in this cycle).
  return [
    ...[options.identity?.preloadPath, options.preloadPath].flatMap(
      (preloadPath) =>
        preloadPath === undefined ? [] : ['--require', preloadPath],
    ),
    nextExecutable,
    ...nextDevArguments(port),
  ]
}

/**
 * Reads the identity secret a Next launch carries.
 *
 * Why it exists: {@link launchDevelopmentServer} needs the secret for the environment and the output mask, and keeps the optional chain out of its own (large) body. Called once per launch.
 * @param options - {@link NextLaunchOptions} of the launch.
 * @returns The secret of a `reverseProxy` run; `undefined` for every other run.
 * @example
 * identitySecretOf({ identity: { preloadPath: '/tmp/i.cjs', secret: 'ab12' } }) // => 'ab12'
 * identitySecretOf({}) // => undefined
 */
export function identitySecretOf(
  options: NextLaunchOptions,
): string | undefined {
  return options.identity?.secret
}
