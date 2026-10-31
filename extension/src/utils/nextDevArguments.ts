/**
 * The arguments Codebook gives the Next executable for a run: webpack, the loopback host and the project's own port.
 *
 * Why it exists: the launcher starts Next with them and a Pages launch or compile failure names them, so the two can never differ. Called by {@link launchDevelopmentServer} (after the executable's path) and by {@link describeNextLaunchFailure} (after `next`).
 * @param port - The project's own port ({@link readDeclaredDevelopmentPort}).
 * @returns `dev --webpack --hostname 127.0.0.1 --port <port>` as separate words; the server inspector flag, when requested, is added by the launcher.
 * @example
 * nextDevArguments(3000) // => ['dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3000']
 */
export function nextDevArguments(port: number): string[] {
  return ['dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)]
}
