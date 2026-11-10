import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import type { FlatCdpConnection } from '../chromeExtensionContracts'
import {
  REVERSE_PROXY_PROBE_CLEANUP_BOUND_MS,
  REVERSE_PROXY_PROBE_CONNECT_BOUND_MS,
  REVERSE_PROXY_PROBE_POLL_MS,
  REVERSE_PROXY_PROBE_PROFILE_REMOVE_RETRIES,
  REVERSE_PROXY_PROBE_PROFILE_REMOVE_RETRY_DELAY_MS,
  type ReverseProxyRefusalReason,
} from '../constants'
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
  /**
   * Called once, on every path (pass, failure, cancellation, launch failure), when the cleanup (process group ended within its bound and profile folder removed) is not confirmed.
   * `release` tries the same cleanup again (same process group, same folder) and resolves `true` when both are confirmed.
   */
  onUnreleased?: (release: () => Promise<boolean>) => void
  /**
   * Called synchronously each time the probe completes a phase, with the milliseconds since the probe's entry; for diagnosis only (Codebook's gate passes none).
   * Each phase is reported at most once; an exception it throws is ignored. It must be synchronous and return nothing: a rejected promise it returned would go unhandled.
   * A phase can still arrive while the probe ends (an event already in flight, or a command answered just as the run was cancelled), never after the probe returned.
   */
  onPhase?: (phase: BrowserAddressProbePhase, elapsedMs: number) => void
}

/**
 * The phases a browser address probe completes, reported through {@link BrowserAddressProbeInput.onPhase}.
 * The start phases come in this order; `request-sent` and `request-continued` come from Chrome's events and can arrive before `request-evaluated`.
 */
export type BrowserAddressProbePhase =
  /** The empty profile folder exists and is resolved. */
  | 'profile-made'
  /** The spawn returned a child; a binary that cannot run is reported afterwards, as a spawn error, so this phase does not show that Chrome started. */
  | 'chrome-spawned'
  /** Chrome's `DevToolsActivePort` was read. */
  | 'debugging-port'
  /** The CDP WebSocket is open. */
  | 'connected'
  /** The first page target was found. */
  | 'page-target'
  /** `Target.attachToTarget` answered. */
  | 'attached'
  /** `Network.enable` answered. */
  | 'network-enabled'
  /** `Fetch.enable` answered. */
  | 'fetch-enabled'
  /** `Runtime.evaluate` of the fetch answered. */
  | 'request-evaluated'
  /** The first `Network.requestWillBeSent` for the probed URL arrived. */
  | 'request-sent'
  /** The probe issued `Fetch.continueRequest` for the probed request (before Chrome answered that command). */
  | 'request-continued'

/** The refusal reasons the probe can end in. */
type BrowserAddressProbeFailureReason = Extract<
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

/** What the probe concluded from the browser's first event, before its cleanup is known. */
type BrowserAddressVerdict =
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
      /** For `proof-unreachable`: `false` only when the error shows that nothing was sent, `true` when the probe's GET may have reached a server. */
      requestWritten?: boolean
    }

/** What {@link probeBrowserAddress} answers: the verdict, and whether the probe confirmed that it ended the throwaway Chrome's process group and removed its profile folder. */
export type BrowserAddressProbeResult = BrowserAddressVerdict & {
  /** `false` when the process group did not end within its bound or the profile folder could not be removed; the gate reports it as `resourcesReleased: false`. */
  cleanupConfirmed: boolean
}

/** Folder-name prefix of the probe's empty profile. */
const PROBE_PROFILE_PREFIX = 'codebook-probe-'

/**
 * The throwaway Chrome the probe owns: its empty profile folder, its process and its CDP connection, each set as soon as it exists.
 * The record is created before anything is made, so the probe's cleanup sees whatever a failed start left behind.
 */
type ProbeBrowser = {
  profile?: string
  child?: ChildProcess
  cdp?: FlatCdpConnection
  /** The spawn `error` event (for example `ENOENT` for a missing binary), which ends every wait at once. */
  spawnError?: Error
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

/** The `net::ERR_*` texts that show Chrome sent nothing (the probe's own interception included), so `proof-unreachable` may say `requestWritten: false`. */
const NOTHING_SENT_ERRORS: ReadonlySet<string> = new Set([
  'net::ERR_CONNECTION_REFUSED',
  'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_ADDRESS_UNREACHABLE',
  'net::ERR_NETWORK_CHANGED',
  'net::ERR_BLOCKED_BY_CLIENT',
])

/**
 * Turns one browser failure text into the refusal the learner sees.
 * @param errorText - Chrome's `net::ERR_…` text.
 * @returns `browser-certificate-untrusted` for an unknown issuer, `browser-certificate-rejected` for any other certificate error, `browser-address-mismatch` for a proxy or tunnel error (the browser did not reach the checked address directly), `proof-unreachable` with `requestWritten` otherwise.
 * @example
 * failureOf('net::ERR_CERT_AUTHORITY_INVALID') // => { ok: false, reason: 'browser-certificate-untrusted', browserError: 'net::ERR_CERT_AUTHORITY_INVALID' }
 * failureOf('net::ERR_EMPTY_RESPONSE') // => { ok: false, reason: 'proof-unreachable', browserError: 'net::ERR_EMPTY_RESPONSE', requestWritten: true }
 */
function failureOf(errorText: string): BrowserAddressVerdict {
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
  // A dead or refusing system or PAC proxy: the browser never reached the checked address directly.
  if (
    errorText.startsWith('net::ERR_PROXY_') ||
    errorText.startsWith('net::ERR_TUNNEL_')
  )
    return {
      ok: false,
      reason: 'browser-address-mismatch',
      browserError: errorText,
    }
  return {
    ok: false,
    reason: 'proof-unreachable',
    browserError: errorText,
    requestWritten: !NOTHING_SENT_ERRORS.has(errorText),
  }
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
): BrowserAddressVerdict {
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
 * @param signal - The run's signal, or the probe's own when a later phase failed.
 * @param boundMs - What is left of the probe's deadline.
 * @param mark - Reports `request-sent` once the probed URL's first request is seen.
 * @returns The verdict; `proof-timeout` when nothing arrived within `boundMs`.
 * @throws The signal's reason when it aborts.
 */
function waitForVerdict(
  cdp: FlatCdpConnection,
  input: BrowserAddressProbeInput,
  signal: AbortSignal,
  boundMs: number,
  mark: ProbeClock['mark'],
): Promise<BrowserAddressVerdict> {
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
      boundMs,
    )
    signal.addEventListener('abort', onAbort, { once: true })
    for (const method of PROBE_EVENT_METHODS)
      off.push(
        cdp.on(method, (params) => {
          const event = eventOf(method, params, requestIds, input.url)
          // The probed URL's first request is known once eventOf recorded its id; mark reports it once.
          if (requestIds.size > 0) mark('request-sent')
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

/** The one deadline of a probe, computed at its entry; every phase gets only what is left. */
type ProbeClock = {
  /** The run's signal. */
  signal: AbortSignal
  /** Milliseconds left until the probe's deadline; never negative. */
  remainingMs: () => number
  /** Reports a completed phase to {@link BrowserAddressProbeInput.onPhase}, once per phase. */
  mark: (phase: BrowserAddressProbePhase) => void
}

/**
 * Builds a probe's {@link ProbeClock.mark}: each phase reaches `onPhase` once, with the milliseconds since `startedAt`; called once by {@link probeBrowserAddress} at its entry.
 * @param onPhase - The caller's diagnostic callback, if any.
 * @param startedAt - The probe's entry time (`Date.now()`).
 * @returns The mark function; without `onPhase` it reports nothing.
 * @example
 * const mark = phaseMarker((phase, elapsedMs) => console.log(phase, elapsedMs), Date.now())
 * mark('profile-made') // logs: profile-made 3
 * mark('profile-made') // logs nothing: already reported
 */
function phaseMarker(
  onPhase: BrowserAddressProbeInput['onPhase'],
  startedAt: number,
): ProbeClock['mark'] {
  const reported = new Set<BrowserAddressProbePhase>()
  return (phase): void => {
    // Each phase once: the event listeners can see the probed request more than once.
    if (reported.has(phase)) return
    reported.add(phase)
    try {
      onPhase?.(phase, Date.now() - startedAt)
    } catch {
      // A diagnostic callback never changes the probe's verdict, phases or cleanup.
    }
  }
}

/**
 * Starts the throwaway headless Chrome on an empty profile with the pin, leading its own process group off Windows.
 *
 * The profile folder and the child are recorded on `browser` the moment each exists, so the caller's cleanup finds them even when a later step throws.
 * @param input - The probe input.
 * @param browser - The record to fill; the profile folder exists after this returns, the debugging port is not known yet.
 * @param mark - Reports `profile-made` and `chrome-spawned`.
 * @throws When the folder cannot be made or resolved, or the spawn throws (an invalid binary path); the recorded folder is still removed by the caller.
 */
async function startProbeBrowser(
  input: BrowserAddressProbeInput,
  browser: ProbeBrowser,
  mark: ProbeClock['mark'],
): Promise<void> {
  const made = await mkdtemp(join(tmpdir(), PROBE_PROFILE_PREFIX))
  // Recorded before `realpath`, so a failure of the next steps still leaves the folder to remove.
  browser.profile = made
  const profile = await realpath(made)
  browser.profile = profile
  mark('profile-made')
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
  browser.child = child
  // A spawn error (for example ENOENT) is kept, and the waits for the port and the page end on it at once.
  child.once('error', (error) => {
    browser.spawnError = error
  })
  mark('chrome-spawned')
}

/**
 * Polls until `attempt` answers, the run is cancelled, Chrome failed to start or ended, or the probe's deadline passes.
 * @param browser - The probe browser.
 * @param clock - The probe's signal and deadline.
 * @param attempt - One look; a value ends the wait, `undefined` keeps polling.
 * @param failure - The message when the deadline passes first.
 * @returns What `attempt` answered.
 * @throws The signal's reason on cancellation, the spawn error, or an `Error` when Chrome ended or the deadline passed.
 */
async function pollProbe<Found>(
  browser: ProbeBrowser,
  clock: ProbeClock,
  attempt: () => Promise<Found | undefined>,
  failure: string,
): Promise<Found> {
  // One look per turn; each turn checks the run's signal, the spawn error and Chrome's own exit first.
  while (clock.remainingMs() > 0) {
    clock.signal.throwIfAborted()
    if (browser.spawnError) throw browser.spawnError
    const child = browser.child
    if (
      child !== undefined &&
      (child.exitCode !== null || child.signalCode !== null)
    )
      throw new Error('Chrome ended early')
    const found = await attempt()
    if (found !== undefined) return found
    await delay(REVERSE_PROXY_PROBE_POLL_MS)
  }
  throw new Error(failure)
}

/**
 * Waits for Chrome's `DevToolsActivePort`, then opens the browser-level connection.
 * @param browser - The started probe browser.
 * @param clock - The probe's signal, deadline and phase marks (`debugging-port`, `connected`).
 * @returns The connection.
 * @throws When Chrome fails to start or ends first, the run is cancelled or the deadline passes.
 */
async function connectProbeBrowser(
  browser: ProbeBrowser,
  clock: ProbeClock,
): Promise<FlatCdpConnection> {
  const file = join(browser.profile ?? '', 'DevToolsActivePort')
  const endpoint = await pollProbe(
    browser,
    clock,
    async () =>
      readDevToolsActivePort(await readFile(file, 'utf8').catch(() => '')) ??
      undefined,
    'Chrome did not become ready',
  )
  clock.mark('debugging-port')
  const cdp = await connectFlatCdp(
    `ws://127.0.0.1:${endpoint.port}${endpoint.path}`,
    Math.min(REVERSE_PROXY_PROBE_CONNECT_BOUND_MS, clock.remainingMs()),
  )
  clock.mark('connected')
  return cdp
}

/**
 * Finds the first page target of the throwaway Chrome.
 * @param browser - The probe browser, whose connection is open.
 * @param cdp - The browser-level connection.
 * @param clock - The probe's signal and deadline.
 * @returns The target id.
 * @throws When no page target appears before the deadline, or the run is cancelled.
 */
function firstPageTarget(
  browser: ProbeBrowser,
  cdp: FlatCdpConnection,
  clock: ProbeClock,
): Promise<string> {
  // The first page may be created a moment after the debugging port opens.
  return pollProbe(
    browser,
    clock,
    async () => {
      const { targetInfos } = await cdp.request(
        'Target.getTargets',
        {},
        undefined,
        clock.remainingMs(),
      )
      const page = (targetInfos as { type?: string; targetId?: string }[]).find(
        (info) => info.type === 'page',
      )
      return page?.targetId
    },
    'No page target',
  )
}

/**
 * Holds every request of the throwaway page at the request stage: only the probe's own first request (the exact probe URL, the first time) continues, every other one, a redirect's follow-up included, fails with `BlockedByClient` before it is sent.
 *
 * Why it exists: with `redirect: 'follow'` Chrome would send the redirected request before Codebook saw the 3xx, so a proxy that answers with a redirect could make the browser contact another destination.
 * @param cdp - The browser-level connection.
 * @param sessionId - The page session the Fetch domain is enabled on.
 * @param url - The probed URL.
 * @param mark - Reports `request-continued` when the probed request is let go.
 * @returns The unsubscribe of the listener.
 */
function interceptProbeRequests(
  cdp: FlatCdpConnection,
  sessionId: string,
  url: string,
  mark: ProbeClock['mark'],
): () => void {
  let didAllowProbe = false
  return cdp.on('Fetch.requestPaused', (params) => {
    const request = params.request as { url?: unknown } | undefined
    const requestId = String(params.requestId)
    // Only the first request for the exact probe URL continues; a repeat or a redirect follow-up is blocked.
    const isProbe = !didAllowProbe && request?.url === url
    if (isProbe) {
      didAllowProbe = true
      mark('request-continued')
    }
    const command = isProbe
      ? cdp.request('Fetch.continueRequest', { requestId }, sessionId)
      : cdp.request(
          'Fetch.failRequest',
          { requestId, errorReason: 'BlockedByClient' },
          sessionId,
        )
    // A command that fails after the page ended is of no use to the verdict.
    command.catch(() => undefined)
  })
}

/**
 * Attaches the first page target and starts the probed request in it.
 * The profile is empty and credentials are omitted, so no cookie exists to send; `redirect: 'follow'` because `manual` with `no-cors` is a network error that sends nothing.
 * Every command is bounded by what is left of the deadline, and the run's signal is checked before each.
 * @param browser - The probe browser, whose connection is open.
 * @param url - The probed URL.
 * @param clock - The probe's signal, deadline and phase marks (`page-target` through `request-evaluated`).
 * @throws When no page target appears, a command fails or times out, or the run is cancelled.
 */
async function startProbedRequest(
  browser: ProbeBrowser,
  url: string,
  clock: ProbeClock,
): Promise<void> {
  const cdp = browser.cdp!
  const targetId = await firstPageTarget(browser, cdp, clock)
  clock.mark('page-target')
  clock.signal.throwIfAborted()
  const { sessionId } = await cdp.request(
    'Target.attachToTarget',
    { targetId, flatten: true },
    undefined,
    clock.remainingMs(),
  )
  clock.mark('attached')
  clock.signal.throwIfAborted()
  await cdp.request(
    'Network.enable',
    {},
    String(sessionId),
    clock.remainingMs(),
  )
  clock.mark('network-enabled')
  clock.signal.throwIfAborted()
  // The listener lives as long as the connection, which the probe's cleanup closes.
  interceptProbeRequests(cdp, String(sessionId), url, clock.mark)
  await cdp.request(
    'Fetch.enable',
    { patterns: [{ urlPattern: '*', requestStage: 'Request' }] },
    String(sessionId),
    clock.remainingMs(),
  )
  clock.mark('fetch-enabled')
  clock.signal.throwIfAborted()
  await cdp.request(
    'Runtime.evaluate',
    {
      expression: `fetch(${JSON.stringify(url)}, { credentials: 'omit', mode: 'no-cors', cache: 'no-store', redirect: 'follow' }).catch(() => undefined)`,
      awaitPromise: false,
    },
    String(sessionId),
    clock.remainingMs(),
  )
  clock.mark('request-evaluated')
}

/**
 * Ends the throwaway Chrome's process group and waits, bounded, until it is gone.
 * @param pid - The group leader.
 * @returns `true` when the group is gone (on Windows: when `taskkill` returned).
 */
async function endProbeProcesses(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    await REAL_PROCESS_STOPPER.taskkill(pid)
    return true
  }
  const endAt = Date.now() + REVERSE_PROXY_PROBE_CLEANUP_BOUND_MS
  signalProcessGroup(pid, 'SIGKILL')
  // A group that still holds a member is signalled again until it is gone or the bound passes.
  while (!isProcessGroupGone(pid) && Date.now() < endAt) {
    await delay(REVERSE_PROXY_PROBE_POLL_MS)
    signalProcessGroup(pid, 'SIGKILL')
  }
  return isProcessGroupGone(pid)
}

/**
 * Ends the throwaway Chrome and removes its profile; bounded, and silent about its own failures.
 * @param browser - The probe browser, with whatever a failed start left of it.
 * @returns `true` only when the process group ended (or never existed) and the profile folder is removed.
 */
async function endProbeBrowser(browser: ProbeBrowser): Promise<boolean> {
  browser.cdp?.close()
  const pid = browser.child?.pid
  const processesEnded =
    pid === undefined ? true : await endProbeProcesses(pid).catch(() => false)
  const profileRemoved =
    browser.profile === undefined
      ? true
      : await rm(browser.profile, {
          recursive: true,
          force: true,
          maxRetries: REVERSE_PROXY_PROBE_PROFILE_REMOVE_RETRIES,
          retryDelay: REVERSE_PROXY_PROBE_PROFILE_REMOVE_RETRY_DELAY_MS,
        }).then(
          () => true,
          () => false,
        )
  return processesEnded && profileRemoved
}

/**
 * Runs the phases of one probe on an already created record: start, connect, subscribe, send, wait.
 * @param browser - The record the phases fill.
 * @param input - The probe input.
 * @param clock - The probe's signal and deadline.
 * @returns The verdict.
 * @throws When a phase fails or the run is cancelled; the caller turns a failure into `proof-unclassified`.
 */
async function runProbe(
  browser: ProbeBrowser,
  input: BrowserAddressProbeInput,
  clock: ProbeClock,
): Promise<BrowserAddressVerdict> {
  await startProbeBrowser(input, browser, clock.mark)
  browser.cdp = await connectProbeBrowser(browser, clock)
  // The wait ends with this call, whatever phase fails; the verdict listener and its timer never outlive it.
  const waiting = new AbortController()
  try {
    // Subscribe first, then send the request, so the first event cannot be missed.
    const verdict = waitForVerdict(
      browser.cdp,
      input,
      AbortSignal.any([clock.signal, waiting.signal]),
      clock.remainingMs(),
      clock.mark,
    )
    verdict.catch(() => undefined)
    await startProbedRequest(browser, input.url, clock)
    return await verdict
  } finally {
    waiting.abort()
  }
}

/**
 * Checks, with a throwaway headless Chrome that holds no cookie, which address and port a browser really reaches for the declared origin.
 *
 * Why it exists: a system proxy, a PAC file or a VPN can route Chrome past the `--host-resolver-rules` pin, and the saved profile's cookies must never reach a server that was not proved. The probe starts Chrome on an empty profile with the same pin, evaluates `fetch(url, { credentials: 'omit', mode: 'no-cors', cache: 'no-store', redirect: 'follow' })` and reads the first `Network.responseReceived` or `Network.loadingFailed` for the URL. One deadline is computed at entry and every phase gets only what is left of it, so the whole check ends within `input.timeoutMs`; the run's signal is checked at each polling turn and before each command. After every path, a pass, a failure or a cancellation, the process group is ended and the profile folder removed, and the result says whether both were confirmed (`cleanupConfirmed`). Called by `ReverseProxyGate.prove()` after the Node proof, before any browser that holds the saved profile.
 * @param input - {@link BrowserAddressProbeInput}.
 * @param signal - The run's signal; it ends the browser.
 * @returns `{ ok: true, address, port, cleanupConfirmed }` when the browser reached the expected address and port with status 200; otherwise the classified failure (a spawn error such as a missing binary, or any other failure of the browser itself, is `proof-unclassified`), with `cleanupConfirmed`. When the cleanup is not confirmed, `input.onUnreleased` receives a function that retries it.
 * @throws The signal's reason when the run is cancelled (no refusal), after the cleanup ran.
 * @example
 * await probeBrowserAddress({ chromeBinary, hostResolverRules, url, expectedAddress: '127.0.0.1', expectedPort: 443, timeoutMs: 10_000 }, signal) // => { ok: true, address: '127.0.0.1', port: 443, cleanupConfirmed: true }
 */
export async function probeBrowserAddress(
  input: BrowserAddressProbeInput,
  signal: AbortSignal,
): Promise<BrowserAddressProbeResult> {
  signal.throwIfAborted()
  const startedAt = Date.now()
  const deadline = startedAt + input.timeoutMs
  const clock: ProbeClock = {
    signal,
    remainingMs: () => Math.max(0, deadline - Date.now()),
    mark: phaseMarker(input.onPhase, startedAt),
  }
  const browser: ProbeBrowser = {}
  let verdict: BrowserAddressVerdict = {
    ok: false,
    reason: 'proof-unclassified',
  }
  try {
    verdict = await runProbe(browser, input, clock)
  } catch {
    // A failure of the browser itself stays unclassified; a cancelled run is rethrown after the cleanup below.
  }
  const cleanupConfirmed = await endProbeBrowser(browser)
  // The gate learns of an unconfirmed cleanup on every path, a cancellation included, and may try again.
  if (!cleanupConfirmed) input.onUnreleased?.(() => endProbeBrowser(browser))
  // A cancelled run is no refusal.
  signal.throwIfAborted()
  return { ...verdict, cleanupConfirmed }
}
