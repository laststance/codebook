import type { ReverseProxyRefusalReason } from '../constants'

/** What {@link probeBrowserAddress} needs for one throwaway-browser check. */
export type BrowserAddressProbeInput = {
  /** The Chrome binary the real browser uses. */
  chromeBinary: string
  /** The whole `--host-resolver-rules=…` switch, from {@link hostResolverRuleOf}. */
  hostResolverRules: string
  /** The origin plus the proof path with a fresh challenge. */
  url: string
  /** The validated address (brackets removed) the browser must have reached. */
  expectedAddress: string
  /** The origin's effective port the browser must have reached. */
  expectedPort: number
  /** Bound on the whole check, {@link REVERSE_PROXY_PROBE_TIMEOUT_MS}. */
  timeoutMs: number
}

/** The refusal reasons the probe can end in. */
export type BrowserAddressProbeFailureReason = Extract<
  ReverseProxyRefusalReason,
  | 'browser-certificate-untrusted'
  | 'browser-certificate-rejected'
  | 'browser-address-mismatch'
  | 'proof-wrong-server'
  | 'proof-redirected'
  | 'proof-unreachable'
  | 'proof-timeout'
  | 'proof-unclassified'
>

/** What {@link probeBrowserAddress} answers. */
export type BrowserAddressProbeResult =
  | { ok: true; address: string; port: number }
  | {
      ok: false
      reason: BrowserAddressProbeFailureReason
      /** The browser's `net::ERR_…` text, for the `browser-certificate-*` reasons. */
      browserError?: string
      /** The address the browser actually reached, for `browser-address-mismatch`. */
      browserAddress?: string
      /** The HTTP status, for `proof-wrong-server` and `proof-redirected`. */
      status?: number
    }

/**
 * Checks, with a throwaway headless Chrome that holds no cookie, which address and port a browser really reaches for the declared origin.
 *
 * Why it exists: a system proxy, a PAC file or a VPN can route Chrome past the `--host-resolver-rules` pin, and the saved profile's cookies must never reach a server that was not proved. The probe starts Chrome on an empty profile with the same pin, evaluates `fetch(url, { credentials: 'omit', mode: 'no-cors', cache: 'no-store', redirect: 'follow' })` and reads the first `Network.responseReceived` or `Network.loadingFailed` for the URL. A `finally` ends the process group and removes the profile folder. Called by `ReverseProxyGate.prove()` after the Node proof, before any browser that holds the saved profile.
 * @param input - {@link BrowserAddressProbeInput}.
 * @param signal - The run's signal; it ends the browser.
 * @returns `{ ok: true, address, port }` when the browser reached the expected address and port with status 200; otherwise the classified failure.
 * @throws The signal's reason when the run is cancelled (no refusal).
 * @example
 * await probeBrowserAddress({ chromeBinary, hostResolverRules, url, expectedAddress: '127.0.0.1', expectedPort: 443, timeoutMs: 10_000 }, signal) // => { ok: true, address: '127.0.0.1', port: 443 }
 */
export async function probeBrowserAddress(
  input: BrowserAddressProbeInput,
  signal: AbortSignal,
): Promise<BrowserAddressProbeResult> {
  void input
  void signal
  throw new Error('not implemented')
}
