import { OWNED_APPLICATION_LOOPBACK_HOSTS } from '../constants'

/**
 * Turns an origin on any loopback host into the origins of the same port on every loopback name.
 *
 * Called by {@link ConfiguredBrowserRun} (DOM read, storage seeding) and {@link prepareRepositoryInputs} (in-page origin checks), so a page that moves between `localhost`, `127.0.0.1` and `[::1]` at the owned port stays owned (D65).
 *
 * @param origin - An `http://<loopback host>:<port>` origin, such as the one Next prints.
 * @returns The three origins at that port; another port or host is not among them.
 *
 * @example
 * ```ts
 * loopbackOriginsOf('http://127.0.0.1:3165') // ['http://localhost:3165', 'http://127.0.0.1:3165', 'http://[::1]:3165']
 * ```
 */
export function loopbackOriginsOf(origin: string): string[] {
  const { port } = new URL(origin)
  return OWNED_APPLICATION_LOOPBACK_HOSTS.map(
    (host) => `http://${host}:${port}`,
  )
}

/**
 * Names the origin the recorded browser opens: `localhost` at the port of the origin Next printed.
 * `next dev` prints `localhost` by default and dev configurations (AUTH_URL, OAuth callbacks, cookies) name it; the server itself still binds 127.0.0.1 only.
 *
 * @param origin - The origin the owned server reported, such as `http://127.0.0.1:3165`.
 * @returns `http://localhost:<port>`.
 *
 * @example
 * ```ts
 * browserOriginOf('http://127.0.0.1:3165') // 'http://localhost:3165'
 * ```
 */
export function browserOriginOf(origin: string): string {
  return `http://localhost:${new URL(origin).port}`
}

/**
 * Tells whether a page origin is the owned application's origin under any loopback name.
 * @param pageOrigin - The page's `location.origin`.
 * @param ownedOrigin - The origin of the owned application.
 * @returns `true` for `localhost`, `127.0.0.1` or `[::1]` at the owned port.
 * @example isOwnedApplicationOrigin('http://localhost:3165', 'http://127.0.0.1:3165') // true
 */
export function isOwnedApplicationOrigin(
  pageOrigin: unknown,
  ownedOrigin: string,
): boolean {
  return (
    typeof pageOrigin === 'string' &&
    loopbackOriginsOf(ownedOrigin).includes(pageOrigin)
  )
}
