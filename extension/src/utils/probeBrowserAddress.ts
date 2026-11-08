import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import type { FlatCdpConnection } from '../chromeExtensionContracts'
import type { ReverseProxyRefusalReason } from '../constants'
import { connectFlatCdp } from '../runtimeSupport/flatCdpConnection'
import { ownedChromeArguments } from '../runtimeSupport/utils/ownedChromeArguments'
import { readDevToolsActivePort } from '../runtimeSupport/utils/readDevToolsActivePort'
import { REAL_PROCESS_STOPPER } from '../runtimeSupport/utils/stopListedProcesses'

import { isProcessGroupGone } from './isProcessGroupGone'
import { signalProcessGroup } from './signalProcessGroup'

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

/** How often the probe looks for Chrome's `DevToolsActivePort` file and for the first page target. */
const PROBE_POLL_MS = 50
/** How long the end of the throwaway Chrome's process group may take before the probe stops waiting for it. */
const PROBE_CLEANUP_BOUND_MS = 5_000
/** How long the WebSocket to the throwaway Chrome may take to open. */
const PROBE_CONNECT_BOUND_MS = 5_000
/** Folder-name prefix of the probe's empty profile. */
const PROBE_PROFILE_PREFIX = 'codebook-probe-'

/** The throwaway Chrome the probe owns: its process, its empty profile folder and its CDP connection once open. */
type ProbeBrowser = {
  child: ChildProcess
  profile: string
  cdp?: FlatCdpConnection
}

/** The facts the verdict reads from the first Network event that ends the probed request. */
type ProbeEvent = {
  /** The response (or the redirecting response) the browser got; absent for a failure. */
  response?: { status: number; address: string; port: number }
  /** The browser's `net::ERR_…` text of a failed request. */
  errorText?: string
}

/**
 * Reads a number field of an untyped CDP object.
 * @param value - The object.
 * @param key - The field.
 * @returns The number; `NaN` when the field is absent or not a number.
 */
function numberOf(value: unknown, key: string): number {
  const field = (value as Record<string, unknown> | undefined)?.[key]
  return typeof field === 'number' ? field : Number.NaN
}

/**
 * Reads the response facts the verdict needs from a CDP `Response` object.
 * @param response - The `response` of `Network.responseReceived` or the `redirectResponse` of `Network.requestWillBeSent`.
 * @returns Status, address (brackets removed) and port; an empty address and port `NaN` when Chrome named none.
 */
function responseOf(response: unknown): NonNullable<ProbeEvent['response']> {
  const address = (response as Record<string, unknown> | undefined)
    ?.remoteIPAddress
  return {
    status: numberOf(response, 'status'),
    address: typeof address === 'string' ? address.replace(/^\[|\]$/g, '') : '',
    port: numberOf(response, 'remotePort'),
  }
}

/**
 * Turns one browser failure text into the refusal the learner sees.
 * @param errorText - Chrome's `net::ERR_…` text.
 * @returns `browser-certificate-untrusted` for an unknown issuer, `browser-certificate-rejected` for any other certificate error, `proof-unreachable` otherwise.
 * @example
 * failureOf('net::ERR_CERT_AUTHORITY_INVALID') // => { ok: false, reason: 'browser-certificate-untrusted', browserError: 'net::ERR_CERT_AUTHORITY_INVALID' }
 */
function failureOf(errorText: string): BrowserAddressProbeResult {
  if (errorText === 'net::ERR_CERT_AUTHORITY_INVALID')
    return {
      ok: false,
      reason: 'browser-certificate-untrusted',
      browserError: errorText,
    }
  if (errorText.startsWith('net::ERR_CERT_'))
    return {
      ok: false,
      reason: 'browser-certificate-rejected',
      browserError: errorText,
    }
  return { ok: false, reason: 'proof-unreachable', browserError: errorText }
}

/**
 * Decides the probe's verdict from the first event of the probed request.
 * The address and port are judged before the status: a route the proof did not check is the first problem, whatever the server there answered.
 * @param event - The first response, redirect or failure of the request.
 * @param input - The expected address and port.
 * @returns The probe result.
 */
function verdictOf(
  event: ProbeEvent,
  input: BrowserAddressProbeInput,
): BrowserAddressProbeResult {
  if (event.response === undefined) return failureOf(event.errorText ?? '')
  const { status, address, port } = event.response
  // A different or empty address, or a different port (a forward proxy on the same loopback address), is a route the proof did not check.
  if (address !== input.expectedAddress || port !== input.expectedPort)
    return {
      ok: false,
      reason: 'browser-address-mismatch',
      ...(address === '' ? {} : { browserAddress: address }),
    }
  if (status >= 300 && status < 400)
    return { ok: false, reason: 'proof-redirected', status }
  if (status !== 200) return { ok: false, reason: 'proof-wrong-server', status }
  return { ok: true, address, port }
}

/**
 * Reads the event of the probed request out of one `Network.*` message.
 * @param method - The event name.
 * @param params - The event's parameters.
 * @param requestIds - The ids of the requests whose URL is the probed one; grown by this call.
 * @param url - The probed URL.
 * @returns The event when it ends the request (a response, a redirect or a failure of a probed request); `undefined` otherwise.
 */
function eventOf(
  method: string,
  params: Record<string, unknown>,
  requestIds: Set<unknown>,
  url: string,
): ProbeEvent | undefined {
  if (method === 'Network.requestWillBeSent') {
    const request = params.request as { url?: unknown } | undefined
    if (request?.url === url) requestIds.add(params.requestId)
    // A redirect shows its redirecting response on the next request of the same id.
    if (requestIds.has(params.requestId) && params.redirectResponse)
      return { response: responseOf(params.redirectResponse) }
    return undefined
  }
  if (!requestIds.has(params.requestId)) return undefined
  if (method === 'Network.responseReceived')
    return { response: responseOf(params.response) }
  return { errorText: String(params.errorText ?? '') }
}

/** The Network events the probe subscribes to. */
const PROBE_EVENT_METHODS = [
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFailed',
] as const

/**
 * Waits for the first Network event of the probed request, the signal or the bound.
 * @param cdp - The connection to the throwaway Chrome.
 * @param input - The probe input.
 * @param signal - The run's signal.
 * @returns The verdict; `proof-timeout` when nothing arrived within `input.timeoutMs`.
 * @throws The signal's reason when it aborts.
 */
function waitForVerdict(
  cdp: FlatCdpConnection,
  input: BrowserAddressProbeInput,
  signal: AbortSignal,
): Promise<BrowserAddressProbeResult> {
  return new Promise((resolve, reject) => {
    const requestIds = new Set<unknown>()
    const off: (() => void)[] = []
    const finish = (end: () => void): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      for (const stop of off) stop()
      end()
    }
    const onAbort = (): void => finish(() => reject(signal.reason))
    const timer = setTimeout(
      () => finish(() => resolve({ ok: false, reason: 'proof-timeout' })),
      input.timeoutMs,
    )
    signal.addEventListener('abort', onAbort, { once: true })
    for (const method of PROBE_EVENT_METHODS)
      off.push(
        cdp.on(method, (params) => {
          const event = eventOf(method, params, requestIds, input.url)
          if (event) finish(() => resolve(verdictOf(event, input)))
        }),
      )
    off.push(
      cdp.onClose(() =>
        finish(() => resolve({ ok: false, reason: 'proof-unclassified' })),
      ),
    )
    if (signal.aborted) onAbort()
  })
}

/**
 * Starts the throwaway headless Chrome on an empty profile with the pin, leading its own process group off Windows.
 * @param input - The probe input.
 * @returns The browser; the profile folder exists, the debugging port is not known yet.
 */
async function startProbeBrowser(
  input: BrowserAddressProbeInput,
): Promise<ProbeBrowser> {
  const made = await mkdtemp(join(tmpdir(), PROBE_PROFILE_PREFIX))
  const profile = await realpath(made)
  const child = spawn(
    input.chromeBinary,
    ownedChromeArguments({
      profile,
      debugging: 'port',
      headless: true,
      startUrl: 'about:blank',
      hostResolverRules: input.hostResolverRules,
    }),
    {
      stdio: 'ignore',
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  )
  // A spawn error would be an unhandled event; the wait for the port ends on the missing file instead.
  child.once('error', () => undefined)
  return { child, profile }
}

/**
 * Waits for Chrome's `DevToolsActivePort`, then opens the browser-level connection.
 * @param browser - The started probe browser.
 * @param boundMs - How long the start may take.
 * @returns The connection.
 * @throws When Chrome exits first or the bound passes.
 */
async function connectProbeBrowser(
  browser: ProbeBrowser,
  boundMs: number,
): Promise<FlatCdpConnection> {
  const file = join(browser.profile, 'DevToolsActivePort')
  const endAt = Date.now() + boundMs
  // Poll until the file is complete, Chrome ended or the bound passed.
  while (Date.now() < endAt) {
    if (browser.child.exitCode !== null) throw new Error('Chrome ended early')
    const endpoint = readDevToolsActivePort(
      await readFile(file, 'utf8').catch(() => ''),
    )
    if (endpoint)
      return connectFlatCdp(
        `ws://127.0.0.1:${endpoint.port}${endpoint.path}`,
        PROBE_CONNECT_BOUND_MS,
      )
    await delay(PROBE_POLL_MS)
  }
  throw new Error('Chrome did not become ready')
}

/**
 * Finds the first page target of the throwaway Chrome.
 * @param cdp - The browser-level connection.
 * @param boundMs - How long the page may take to appear.
 * @returns The target id.
 * @throws When no page target appears in time.
 */
async function firstPageTarget(
  cdp: FlatCdpConnection,
  boundMs: number,
): Promise<string> {
  const endAt = Date.now() + boundMs
  // The first page may be created a moment after the debugging port opens.
  while (Date.now() < endAt) {
    const { targetInfos } = await cdp.request('Target.getTargets', {})
    const page = (targetInfos as { type?: string; targetId?: string }[]).find(
      (info) => info.type === 'page',
    )
    if (page?.targetId !== undefined) return page.targetId
    await delay(PROBE_POLL_MS)
  }
  throw new Error('No page target')
}

/**
 * Attaches the first page target and starts the probed request in it.
 * The profile is empty and credentials are omitted, so no cookie exists to send; `redirect: 'follow'` because `manual` with `no-cors` is a network error that sends nothing.
 * @param cdp - The browser-level connection.
 * @param url - The probed URL.
 * @param boundMs - How long finding the page may take.
 * @throws When no page target appears.
 */
async function startProbedRequest(
  cdp: FlatCdpConnection,
  url: string,
  boundMs: number,
): Promise<void> {
  const targetId = await firstPageTarget(cdp, boundMs)
  const { sessionId } = await cdp.request('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  await cdp.request('Network.enable', {}, String(sessionId))
  await cdp.request(
    'Runtime.evaluate',
    {
      expression: `fetch(${JSON.stringify(url)}, { credentials: 'omit', mode: 'no-cors', cache: 'no-store', redirect: 'follow' }).catch(() => undefined)`,
      awaitPromise: false,
    },
    String(sessionId),
  )
}

/**
 * Ends the throwaway Chrome's process group and waits, bounded, until it is gone.
 * @param pid - The group leader.
 */
async function endProbeProcesses(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await REAL_PROCESS_STOPPER.taskkill(pid)
    return
  }
  const endAt = Date.now() + PROBE_CLEANUP_BOUND_MS
  signalProcessGroup(pid, 'SIGKILL')
  // A group that still holds a member is signalled again until it is gone or the bound passes.
  while (!isProcessGroupGone(pid) && Date.now() < endAt) {
    await delay(PROBE_POLL_MS)
    signalProcessGroup(pid, 'SIGKILL')
  }
}

/**
 * Ends the throwaway Chrome and removes its profile; bounded, and silent about its own failures.
 * @param browser - The probe browser.
 */
async function endProbeBrowser(browser: ProbeBrowser): Promise<void> {
  browser.cdp?.close()
  const { pid } = browser.child
  if (pid !== undefined) await endProbeProcesses(pid).catch(() => undefined)
  await rm(browser.profile, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  }).catch(() => undefined)
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
  signal.throwIfAborted()
  let browser: ProbeBrowser | undefined
  try {
    browser = await startProbeBrowser(input)
    browser.cdp = await connectProbeBrowser(browser, input.timeoutMs)
    // Subscribe first, then send the request, so the first event cannot be missed.
    const verdict = waitForVerdict(browser.cdp, input, signal)
    verdict.catch(() => undefined)
    await startProbedRequest(browser.cdp, input.url, input.timeoutMs)
    return await verdict
  } catch (error) {
    // A cancelled run is no refusal; any other failure of the browser itself is unclassified.
    if (signal.aborted) throw signal.reason
    void error
    return { ok: false, reason: 'proof-unclassified' }
  } finally {
    if (browser) await endProbeBrowser(browser)
  }
}
