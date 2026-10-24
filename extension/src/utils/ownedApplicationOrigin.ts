import { OWNED_APPLICATION_LOOPBACK_HOSTS } from '../constants'

/** Replaces only the host of an origin, so `URL` drops a default port exactly as `location.origin` does. */
function originAtHost(origin: string, host: string): string {
  const url = new URL(origin)
  url.hostname = host
  return url.origin
}

/**
 * Turns an origin on any loopback host into the origins of the same port on every loopback name the run owns.
 *
 * Called by {@link ConfiguredBrowserRun} (DOM read, storage seeding) and {@link prepareRepositoryInputs} (in-page origin checks), so a page that moves between `localhost`, `127.0.0.1` and `[::1]` at the owned port stays owned (D65). `[::1]` is owned only when the run holds it ({@link startIpv6LoopbackForwarder}).
 *
 * @param origin - An `http://<loopback host>:<port>` origin, such as the one Next prints.
 * @param ipv6 - Whether the run owns `[::1]` at the port; `true` by default.
 * @returns The origins at that port, in the form `location.origin` reports (a default port is omitted); another port or host is not among them.
 *
 * @example
 * ```ts
 * loopbackOriginsOf('http://127.0.0.1:3165') // ['http://localhost:3165', 'http://127.0.0.1:3165', 'http://[::1]:3165']
 * ```
 */
export function loopbackOriginsOf(origin: string, ipv6 = true): string[] {
  return OWNED_APPLICATION_LOOPBACK_HOSTS.filter(
    (host) => ipv6 || host !== '[::1]',
  ).map((host) => originAtHost(origin, host))
}

/**
 * Names the origin the recorded browser opens: `localhost` at the port of the origin the owned server reported.
 * The server binds `127.0.0.1` (Codebook passes `--hostname 127.0.0.1`), while the project's own origin settings (AUTH_URL, OAuth callbacks, cookies) usually name `localhost`.
 *
 * @param origin - The origin the owned server reported, such as `http://127.0.0.1:3165`.
 * @returns `http://localhost:<port>`, without a port for port 80.
 *
 * @example
 * ```ts
 * browserOriginOf('http://127.0.0.1:3165') // 'http://localhost:3165'
 * ```
 */
export function browserOriginOf(origin: string): string {
  return originAtHost(origin, 'localhost')
}

/**
 * Tells whether a page origin is the owned application's origin under any loopback name the run owns.
 * @param pageOrigin - The page's `location.origin`.
 * @param ownedOrigin - The origin of the owned application.
 * @param ipv6 - Whether the run owns `[::1]` at the port; `true` by default.
 * @returns `true` for `localhost`, `127.0.0.1` or (when owned) `[::1]` at the owned port.
 * @example isOwnedApplicationOrigin('http://localhost:3165', 'http://127.0.0.1:3165') // true
 */
export function isOwnedApplicationOrigin(
  pageOrigin: unknown,
  ownedOrigin: string,
  ipv6 = true,
): boolean {
  return (
    typeof pageOrigin === 'string' &&
    loopbackOriginsOf(ownedOrigin, ipv6).includes(pageOrigin)
  )
}
