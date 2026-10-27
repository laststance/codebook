import { setTimeout as delay } from 'node:timers/promises'

import {
  NODE_SERVER_READY_CONNECT_TIMEOUT_MS,
  NODE_SERVER_READY_POLL_INTERVAL_MS,
} from '../constants'

import { probeLoopbackPort, type LoopbackHost } from './probeLoopbackPort'

/** What {@link waitForServerReadiness} waits with. */
export type ServerReadinessInput = {
  /** The declared port the server's own code listens on. */
  port: number
  /** Says whether the run's readiness budget has time left; the run computes it and suspends it during learner pauses. */
  hasTimeLeft: () => boolean
  /** Aborts the wait (the run is stopping). */
  signal: AbortSignal
  /** How long one probe waits for a connection; {@link NODE_SERVER_READY_CONNECT_TIMEOUT_MS} unless a test names its own. */
  connectTimeoutMs?: number
  /** The pause between two rounds; {@link NODE_SERVER_READY_POLL_INTERVAL_MS} unless a test names its own. */
  pollIntervalMs?: number
}

/**
 * Waits until the declared port accepts a connection on the IPv4 or the IPv6 loopback address, and says which one a request should use.
 * Why: a server's own code chooses its host, so the run learns it by probing; both addresses are probed every round so a server that listens on `::1` only is found too.
 * Called by the node-server run after the entry pause is released. Every probe socket is closed.
 * @param input - The port, the budget check, the abort signal and the probe timings ({@link ServerReadinessInput}).
 * @returns
 * - `{ host: '127.0.0.1', bothAccept }` when IPv4 accepts (also when both do)
 * - `{ host: '::1', bothAccept: false }` when only IPv6 accepts
 * - `undefined` once `hasTimeLeft()` is false without any address having accepted
 * @throws The signal's reason when it aborts.
 * @example
 * await waitForServerReadiness({ port: 4100, hasTimeLeft: () => Date.now() < deadline, signal }) // => { host: '127.0.0.1', bothAccept: true }
 */
export async function waitForServerReadiness(
  input: ServerReadinessInput,
): Promise<{ host: LoopbackHost; bothAccept: boolean } | undefined> {
  const connectTimeoutMs =
    input.connectTimeoutMs ?? NODE_SERVER_READY_CONNECT_TIMEOUT_MS
  const pollIntervalMs =
    input.pollIntervalMs ?? NODE_SERVER_READY_POLL_INTERVAL_MS
  // One round per iteration; the budget is checked before each round and after each pause.
  while (input.hasTimeLeft()) {
    input.signal.throwIfAborted()
    const [ipv4, ipv6] = await Promise.all([
      probeLoopbackPort(
        '127.0.0.1',
        input.port,
        connectTimeoutMs,
        input.signal,
      ),
      probeLoopbackPort('::1', input.port, connectTimeoutMs, input.signal),
    ])
    if (ipv4) return { host: '127.0.0.1', bothAccept: ipv6 }
    if (ipv6) return { host: '::1', bothAccept: false }
    await delay(pollIntervalMs, undefined, { signal: input.signal })
  }
  return undefined
}
