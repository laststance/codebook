import type { LookupAddress } from 'node:dns'
import { BlockList } from 'node:net'

import { REVERSE_PROXY_RESOLVE_TIMEOUT_MS } from '../constants'

/** The resolver call the host is looked up with; the real one is `dns.promises.lookup(hostname, { all: true, verbatim: true })`, and tests inject a stand-in. */
export type ReverseProxyLookup = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>

/** What {@link resolveReverseProxyHost} needs from the machine. */
export type ReverseProxyResolveDependencies = {
  lookup: ReverseProxyLookup
}

/** What {@link resolveReverseProxyHost} answers: the validated address, or why the host cannot be trusted. */
export type ResolvedReverseProxyHost =
  | {
      ok: true
      /** The first answer of the resolver (resolver order kept); every answer was a loopback address. */
      address: string
      family: 4 | 6
    }
  | { ok: false; reason: 'not-resolved' }
  | {
      ok: false
      reason: 'not-loopback' | 'same-socket'
      /** For `not-loopback` the first answer, in resolver order, that is not a loopback address; for `same-socket` the address Codebook's own socket holds. */
      address: string
    }

/** The origin's port against the dev server's port, for the same-socket rule. */
export type ReverseProxySocketPorts = {
  /** The port a browser connects to at the declared origin. */
  effectivePort: number
  /** The port Codebook starts the development server on. */
  upstreamPort: number
}

/** Loopback only: `127.0.0.0/8` and `::1`; `::ffff:127.0.0.1` and unspecified addresses are outside it on purpose. */
const LOOPBACK_IPV4 = new BlockList()
LOOPBACK_IPV4.addSubnet('127.0.0.0', 8, 'ipv4')
/** Kept apart from the IPv4 list: one list would match `::ffff:127.0.0.1` through its IPv4 rule. */
const LOOPBACK_IPV6 = new BlockList()
LOOPBACK_IPV6.addAddress('::1', 'ipv6')

/** The two sockets Codebook itself holds for the dev server and its `[::1]` forwarder. */
const OWN_SOCKET_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1'])

/**
 * Whether one resolver answer is a loopback address by the rule of the declaration.
 * @param entry - One resolver answer.
 * @returns True for `127.0.0.0/8` and `::1` only.
 * @example
 * isLoopbackAnswer({ address: '127.0.0.2', family: 4 }) // => true
 */
function isLoopbackAnswer(entry: LookupAddress): boolean {
  return entry.family === 6
    ? LOOPBACK_IPV6.check(entry.address, 'ipv6')
    : LOOPBACK_IPV4.check(entry.address, 'ipv4')
}

/**
 * Races the resolver against the bound and the run's signal; a late lookup result is dropped.
 * @param hostname - The host to look up.
 * @param dependencies - The resolver.
 * @param signal - The run's signal.
 * @returns The answers, or `undefined` for an error, an empty answer or the timeout.
 * @throws The signal's reason when the run is cancelled.
 */
async function lookupWithin(
  hostname: string,
  dependencies: ReverseProxyResolveDependencies,
  signal: AbortSignal,
): Promise<LookupAddress[] | undefined> {
  signal.throwIfAborted()
  const settled = new AbortController()
  const guard = new Promise<undefined>((resolve, reject) => {
    const timer = setTimeout(resolve, REVERSE_PROXY_RESOLVE_TIMEOUT_MS)
    // Either end of the race clears the timer and the listener.
    settled.signal.addEventListener('abort', () => clearTimeout(timer))
    signal.addEventListener('abort', () => reject(signal.reason), {
      once: true,
      signal: settled.signal,
    })
  })
  const lookup = dependencies
    .lookup(hostname, { all: true, verbatim: true })
    .catch(() => undefined)
  try {
    return await Promise.race([lookup, guard])
  } finally {
    settled.abort()
  }
}

/**
 * Resolves the declared host through this machine's resolver and requires every address to be a loopback address (`127.0.0.0/8` or `::1`).
 *
 * Why it exists: Codebook trusts only a proxy on this machine, so a host that resolves anywhere else is refused before anything starts. The resolution is raced against {@link REVERSE_PROXY_RESOLVE_TIMEOUT_MS} and the run's signal. Called by `ReverseProxyGate.resolve()`.
 * @param hostname - The canonical host name of the declared origin.
 * @param dependencies - The resolver; the real one in the product.
 * @param signal - The run's signal; a pending lookup cannot be cancelled, its late result is dropped.
 * @param ports - When given, the first address is refused as `same-socket` if it is one of Codebook's own sockets (`127.0.0.1`, `::1`) and the origin's port equals the dev server's.
 * @returns The first address when all are loopback; `not-resolved` for an error, an empty answer or the timeout; `not-loopback` naming the first other address; `same-socket`.
 * @throws The signal's reason when the run is cancelled.
 * @example
 * await resolveReverseProxyHost('app.example.test', { lookup }, signal) // => { ok: true, address: '127.0.0.1', family: 4 }
 */
export async function resolveReverseProxyHost(
  hostname: string,
  dependencies: ReverseProxyResolveDependencies,
  signal: AbortSignal,
  ports?: ReverseProxySocketPorts,
): Promise<ResolvedReverseProxyHost> {
  const answers = await lookupWithin(hostname, dependencies, signal)
  const first = answers?.[0]
  // An error, the timeout and an empty answer are one outcome.
  if (!answers || !first) return { ok: false, reason: 'not-resolved' }
  // The first answer outside the loopback rule names the refusal (resolver order).
  const outside = answers.find((entry) => !isLoopbackAnswer(entry))
  if (outside)
    return { ok: false, reason: 'not-loopback', address: outside.address }
  // Codebook's own dev-server socket cannot be the proxy's.
  const sharesOwnSocket =
    ports?.effectivePort === ports?.upstreamPort &&
    OWN_SOCKET_ADDRESSES.has(first.address)
  if (ports && sharesOwnSocket)
    return { ok: false, reason: 'same-socket', address: first.address }
  return {
    ok: true,
    address: first.address,
    family: first.family === 6 ? 6 : 4,
  }
}
