import { nextDevArguments } from './nextDevArguments'

/** What a Next launch may add to the Node command line beside the executable (Cycle 0098, decision D16). */
export type NextLaunchOptions = {
  /** The generated preload of a Next library run: Node runs it with `--require` before the Next executable, so the forked server child inherits it and no `NODE_OPTIONS` is set. Absent for every other run. */
  preloadPath?: string
}

/**
 * The Node arguments of a Next launch: an optional preload, the verified Next executable, then Next's own arguments.
 *
 * Why it exists: the preload is a Node option and must come before the executable, or Next would receive it as its own argument. Called by {@link launchDevelopmentServer} for a launch with no launcher spec.
 * @param nextExecutable - The verified `dist/bin/next` the launch runs.
 * @param port - The project's own port.
 * @param options - {@link NextLaunchOptions}; none for a run without `library`.
 * @returns `[--require, <preload>,] <executable> dev --webpack --hostname 127.0.0.1 --port <port>` as separate words (the server inspector flag is added by the launcher).
 * @example
 * nextLaunchArguments('/app/node_modules/next/dist/bin/next', 3000, { preloadPath: '/tmp/run/preload.cjs' })
 * // => ['--require', '/tmp/run/preload.cjs', '/app/node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000']
 */
export function nextLaunchArguments(
  nextExecutable: string,
  port: number,
  options: NextLaunchOptions,
): string[] {
  return [
    ...(options.preloadPath === undefined
      ? []
      : ['--require', options.preloadPath]),
    nextExecutable,
    ...nextDevArguments(port),
  ]
}
