import type { LookupAddress } from 'node:dns'

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
      reason: 'not-loopback'
      /** The first answer, in resolver order, that is not a loopback address. */
      address: string
    }

/**
 * Resolves the declared host through this machine's resolver and requires every address to be a loopback address (`127.0.0.0/8` or `::1`).
 *
 * Why it exists: Codebook trusts only a proxy on this machine, so a host that resolves anywhere else is refused before anything starts. The resolution is raced against {@link REVERSE_PROXY_RESOLVE_TIMEOUT_MS} and the run's signal. Called by `ReverseProxyGate.resolve()`.
 * @param hostname - The canonical host name of the declared origin.
 * @param dependencies - The resolver; the real one in the product.
 * @param signal - The run's signal; a pending lookup cannot be cancelled, its late result is dropped.
 * @returns The first address when all are loopback; `not-resolved` for an error, an empty answer or the timeout; `not-loopback` naming the first other address.
 * @throws The signal's reason when the run is cancelled.
 * @example
 * await resolveReverseProxyHost('app.example.test', { lookup }, signal) // => { ok: true, address: '127.0.0.1', family: 4 }
 */
export async function resolveReverseProxyHost(
  hostname: string,
  dependencies: ReverseProxyResolveDependencies,
  signal: AbortSignal,
): Promise<ResolvedReverseProxyHost> {
  void hostname
  void dependencies
  void signal
  throw new Error('not implemented')
}
