import { setTimeout as delay } from 'node:timers/promises'

import type {
  ExtensionObservation,
  FlatCdpConnection,
} from './chromeExtensionContracts'
import type { ExtensionPauseState } from './chromeExtensionDebugger'
import {
  EXTENSION_OBSERVE_BOUND_MS,
  EXTENSION_OBSERVE_DEPTH_LIMIT,
  EXTENSION_OBSERVE_POLL_MS,
  EXTENSION_OBSERVE_READ_LIMIT_BYTES,
  EXTENSION_OBSERVE_READ_TIMEOUT_MS,
  EXTENSION_OBSERVE_SETTLE_MS,
} from './constants'
import type { ChromeExtensionObserved } from './runtime'
import { readCdpString } from './runtimeSupport/utils/cdpFieldReaders'
import { canonicalJson } from './utils/canonicalJson'
import {
  maskExtensionObservedRead,
  type ExtensionObservedRawRead,
} from './utils/maskExtensionObservedRead'
import type { CauseRoots } from './utils/sanitizeCause'

/** The cause of a read whose value is over the byte or depth limit (ER23). */
const OBSERVATION_LIMIT_CAUSE = 'larger than the read limit'

/** What one reader needs: the browser connection, the extension and the declared observation. */
export type ExtensionObservationReaderInput = {
  cdp: FlatCdpConnection
  extensionId: string
  observe: ExtensionObservation
  /** The surface's flat session while it exists; `undefined` once the surface was lost, when only a storage read can still complete. */
  surfaceSessionId(): string | undefined
  /** Defaults to {@link EXTENSION_OBSERVE_READ_TIMEOUT_MS}. */
  readTimeoutMs?: number
  /** Defaults to {@link EXTENSION_OBSERVE_READ_LIMIT_BYTES}. */
  limitBytes?: number
  /** Defaults to {@link EXTENSION_OBSERVE_DEPTH_LIMIT}. */
  depthLimit?: number
}

/** The reader of one declared observation. */
export interface ExtensionObservationReader {
  /** Reads the observed value once; never throws: a failed read is `unavailable` with its cause. */
  read(): Promise<ExtensionObservedRawRead>
}

/** Rejects when a read does not answer in time, even for a connection that ignores the request's own timeout. */
function withinReadTimeout<Value>(
  pending: Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the read did not answer within ${timeoutMs} ms`)),
      timeoutMs,
    )
  })
  return Promise.race([pending, expiry]).finally(() => clearTimeout(timer))
}

/**
 * Tells whether a JSON value nests deeper than a limit; stops walking at limit + 1 so a very deep value never overflows the stack.
 * Runs before the canonical text is built (ER23).
 */
function exceedsDepth(value: unknown, depthLimit: number): boolean {
  const pending: Array<{ node: unknown; depth: number }> = [
    { node: value, depth: 0 },
  ]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, depth } = next
    if (typeof node !== 'object' || node === null) continue
    if (depth + 1 > depthLimit) return true
    const children: unknown[] = Array.isArray(node) ? node : Object.values(node)
    for (const child of children)
      pending.push({ node: child, depth: depth + 1 })
  }
  return false
}

/** Reads a field of a CDP answer without a cast. */
function readField(source: unknown, name: string): unknown {
  return typeof source === 'object' && source !== null
    ? Reflect.get(source, name)
    : undefined
}

/**
 * Creates the reader of a run's declared observation (CR9, ER23, ER26): text through `Runtime.evaluate` on the surface session, storage through `Extensions.getStorageItems`, the popup through `chrome.action.getPopup({})` evaluated in the surface page.
 * Called by the run for the baseline at `ready` and for every poll after the last click; every read has its own timeout and the limits of ER23.
 * @param input - The connection, the extension, the observation and the surface session.
 * @returns A reader whose reads never throw.
 * @example
 * const reader = createExtensionObservationReader({ cdp, extensionId, observe: { kind: 'text', selector: '#out' }, surfaceSessionId: () => sessionId })
 * await reader.read() // => { value: 'Saved' }
 */
export function createExtensionObservationReader(
  input: ExtensionObservationReaderInput,
): ExtensionObservationReader {
  const timeoutMs = input.readTimeoutMs ?? EXTENSION_OBSERVE_READ_TIMEOUT_MS
  const limitBytes = input.limitBytes ?? EXTENSION_OBSERVE_READ_LIMIT_BYTES
  const depthLimit = input.depthLimit ?? EXTENSION_OBSERVE_DEPTH_LIMIT
  const { cdp } = input

  /** Evaluates an expression on the surface session and returns its JSON value. */
  const evaluate = async (
    expression: string,
    awaitPromise: boolean,
  ): Promise<unknown> => {
    const sessionId = input.surfaceSessionId()
    // No surface session: no execution context remains for a page read (SR26).
    if (sessionId === undefined)
      throw new Error('the extension surface no longer exists')
    const answer = await withinReadTimeout(
      cdp.request(
        'Runtime.evaluate',
        { expression, awaitPromise, returnByValue: true },
        sessionId,
        timeoutMs,
      ),
      timeoutMs,
    )
    const exception = readField(answer, 'exceptionDetails')
    if (exception !== undefined)
      throw new Error(
        readCdpExceptionText(exception) ?? 'the page script threw an error',
      )
    return readField(readField(answer, 'result'), 'value')
  }

  /** Reads one storage key, on the surface session or, once it is gone, on a short-lived extension page. */
  const readStorage = async (key: string): Promise<unknown> => {
    const surfaceSession = input.surfaceSessionId()
    const params = { id: input.extensionId, storageArea: 'local', keys: [key] }
    if (surfaceSession !== undefined) {
      const answer = await withinReadTimeout(
        cdp.request(
          'Extensions.getStorageItems',
          params,
          surfaceSession,
          timeoutMs,
        ),
        timeoutMs,
      )
      return readField(answer, 'data')
    }
    // Storage commands answer only on an extension-origin page session (TZ2): open one for the read and close it again, each step within the read timeout.
    const created = await withinReadTimeout(
      cdp.request(
        'Target.createTarget',
        { url: `chrome-extension://${input.extensionId}/manifest.json` },
        undefined,
        timeoutMs,
      ),
      timeoutMs,
    )
    const targetId = readCdpString(created, 'targetId')
    try {
      const attached = await withinReadTimeout(
        cdp.request(
          'Target.attachToTarget',
          { targetId, flatten: true },
          undefined,
          timeoutMs,
        ),
        timeoutMs,
      )
      const answer = await withinReadTimeout(
        cdp.request(
          'Extensions.getStorageItems',
          params,
          readCdpString(attached, 'sessionId'),
          timeoutMs,
        ),
        timeoutMs,
      )
      return readField(answer, 'data')
    } finally {
      await withinReadTimeout(
        cdp.request('Target.closeTarget', { targetId }, undefined, timeoutMs),
        timeoutMs,
      ).catch(() => undefined)
    }
  }

  /** Makes one raw read for the declared kind; throws on any failure. */
  const readRaw = async (): Promise<ExtensionObservedRawRead> => {
    const { observe } = input
    if (observe.kind === 'text') {
      const answer = await evaluate(
        `(() => { const element = document.querySelector(${JSON.stringify(observe.selector)}); return element === null ? { missing: true } : { text: element.textContent ?? '' } })()`,
        false,
      )
      if (readField(answer, 'missing') === true) return { missing: true }
      const text = readField(answer, 'text')
      return { value: typeof text === 'string' ? text : '' }
    }
    if (observe.kind === 'popup') {
      return { value: await evaluate('chrome.action.getPopup({})', true) }
    }
    const data = await readStorage(observe.key)
    if (
      typeof data !== 'object' ||
      data === null ||
      !Object.hasOwn(data, observe.key)
    )
      return { missing: true }
    return { value: Reflect.get(data, observe.key) }
  }

  return {
    async read() {
      try {
        const read = await readRaw()
        if ('value' in read) {
          // Depth first: canonicalJson recurses over the whole value.
          if (exceedsDepth(read.value, depthLimit))
            return { unavailable: true, cause: OBSERVATION_LIMIT_CAUSE }
          const canonical = canonicalJson(read.value)
          const size =
            typeof read.value === 'string'
              ? Buffer.byteLength(read.value)
              : Buffer.byteLength(canonical ?? '')
          if (size > limitBytes)
            return { unavailable: true, cause: OBSERVATION_LIMIT_CAUSE }
        }
        return read
      } catch (error) {
        return {
          unavailable: true,
          cause: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/** Takes the text of a CDP `exceptionDetails`. */
function readCdpExceptionText(details: unknown): string | undefined {
  const description = readField(readField(details, 'exception'), 'description')
  if (typeof description === 'string') return description.split('\n')[0]
  const text = readField(details, 'text')
  return typeof text === 'string' ? text : undefined
}

/** The canonical text a read is compared by; `undefined` for a failed read, which never agrees with anything. */
function readIdentity(read: ExtensionObservedRawRead): string | undefined {
  if ('unavailable' in read) return undefined
  if ('missing' in read) return 'missing'
  return `value:${canonicalJson(read.value) ?? 'undefined'}`
}

/** What the observation loop needs besides the reader. */
export type ExtensionObservationLoopInput = {
  read(): Promise<ExtensionObservedRawRead>
  pauseState: ExtensionPauseState
  /** Aborts the waits: a stop, the deadline or a debug-session end was accepted. */
  signal: AbortSignal
  /** Defaults to {@link EXTENSION_OBSERVE_SETTLE_MS}. */
  settleMs?: number
  /** Defaults to {@link EXTENSION_OBSERVE_POLL_MS}. */
  pollMs?: number
  /** Defaults to {@link EXTENSION_OBSERVE_BOUND_MS}. */
  boundMs?: number
  now?: () => number
  /** Told once the settle wait ended and the first poll is about to start. */
  onReading?: () => void
}

/**
 * Waits until no stop is paused and none was reached for `settleMs`: any change of the pause set restarts the timer, a paused stop stops it (SR23).
 * @param pauseState - The debugger's pause set.
 * @param settleMs - The quiet time to wait.
 * @param signal - Rejects the wait with its reason.
 * @returns Resolves once the quiet time passed.
 * @example await waitUntilExtensionSettled(debug.pauseState, 1_000, signal)
 */
function waitUntilExtensionSettled(
  pauseState: ExtensionPauseState,
  settleMs: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      clearTimeout(timer)
      stopListening()
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      finish()
      reject(signal.reason)
    }
    const arm = (): void => {
      clearTimeout(timer)
      timer = undefined
      // A paused stop holds the timer; the change that ends the pause starts it again.
      if (pauseState.isPaused()) return
      timer = setTimeout(() => {
        finish()
        resolve()
      }, settleMs)
    }
    const stopListening = pauseState.onChange(arm)
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    arm()
  })
}

/** Resolves once no pause is open; at once when none is. */
function waitUntilUnpaused(
  pauseState: ExtensionPauseState,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!pauseState.isPaused()) return resolve()
    const onAbort = (): void => {
      stopListening()
      reject(signal.reason)
    }
    const stopListening = pauseState.onChange(() => {
      if (pauseState.isPaused()) return
      stopListening()
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Reads the observation after the last click: waits until the run settled, then polls until two reads agree within `boundMs` of unpaused time (CR9, SR23, ER9).
 * Called by the run once the last declared click's work ended; a pause stops the bound and no read starts under one, so the read never races a stop's hold.
 * @param input - The reader, the pause set and the timings.
 * @returns The agreeing read; a read over the limit at once; `unavailable` with the last failure's cause (or that the value kept changing) when the bound passed.
 * @throws The signal's reason when it aborted.
 * @example
 * const after = await observeAfterLastClick({ read: reader.read, pauseState: debug.pauseState, signal })
 */
export async function observeAfterLastClick(
  input: ExtensionObservationLoopInput,
): Promise<ExtensionObservedRawRead> {
  const { pauseState, signal } = input
  const now = input.now ?? ((): number => performance.now())
  const pollMs = input.pollMs ?? EXTENSION_OBSERVE_POLL_MS
  const boundMs = input.boundMs ?? EXTENSION_OBSERVE_BOUND_MS
  await waitUntilExtensionSettled(
    pauseState,
    input.settleMs ?? EXTENSION_OBSERVE_SETTLE_MS,
    signal,
  )
  input.onReading?.()
  // The bound counts only unpaused time: pause intervals are summed from the pause set's own changes.
  const startedAtMs = now()
  let pausedTotalMs = 0
  let pausedSinceMs: number | undefined
  const stopListening = pauseState.onChange(() => {
    if (pauseState.isPaused()) pausedSinceMs ??= now()
    else if (pausedSinceMs !== undefined) {
      pausedTotalMs += now() - pausedSinceMs
      pausedSinceMs = undefined
    }
  })
  const unpausedMs = (): number =>
    now() -
    startedAtMs -
    pausedTotalMs -
    (pausedSinceMs === undefined ? 0 : now() - pausedSinceMs)
  let previous: string | undefined
  let latest: ExtensionObservedRawRead = {
    unavailable: true,
    cause: 'the result never settled',
  }
  try {
    while (unpausedMs() < boundMs) {
      signal.throwIfAborted()
      await waitUntilUnpaused(pauseState, signal)
      const read = await input.read()
      signal.throwIfAborted()
      // A value over the limit stays over it: no later read can fix it.
      if ('unavailable' in read && read.cause === OBSERVATION_LIMIT_CAUSE)
        return read
      const identity = readIdentity(read)
      if (identity !== undefined && identity === previous) return read
      previous = identity
      latest = read
      await delay(pollMs, undefined, { signal }).catch(() => {
        throw signal.reason
      })
    }
  } finally {
    stopListening()
  }
  return 'unavailable' in latest
    ? latest
    : {
        unavailable: true,
        cause: `the result kept changing for ${boundMs} ms`,
      }
}

/**
 * Decides whether the observation changed: compares the unmasked canonical values of the two reads.
 * @param before - The baseline read at `ready`.
 * @param after - The read after the last click.
 * @returns `true` or `false`; `undefined` when either read is unavailable.
 * @example extensionObservationChanged({ value: 'a' }, { value: 'b' }) // => true
 */
function extensionObservationChanged(
  before: ExtensionObservedRawRead,
  after: ExtensionObservedRawRead,
): boolean | undefined {
  const beforeIdentity = readIdentity(before)
  const afterIdentity = readIdentity(after)
  if (beforeIdentity === undefined || afterIdentity === undefined)
    return undefined
  return beforeIdentity !== afterIdentity
}

/**
 * Builds the observation report of the run resource from the two raw reads (CR9, DXR7).
 * @param input - The kind, both raw reads, the milliseconds since the launch and the private roots.
 * @returns The masked, bounded report; `changed` is absent when either read is unavailable.
 * @example
 * buildExtensionObserved({ kind: 'text', before: { value: 'a' }, after: { value: 'b' }, observedAtMs: 4_000, roots: {} }).changed // => true
 */
export function buildExtensionObserved(input: {
  kind: ExtensionObservation['kind']
  before: ExtensionObservedRawRead
  after: ExtensionObservedRawRead
  observedAtMs: number
  roots: CauseRoots
}): ChromeExtensionObserved {
  const changed = extensionObservationChanged(input.before, input.after)
  return {
    kind: input.kind,
    before: maskExtensionObservedRead(input.before, input.roots),
    after: maskExtensionObservedRead(input.after, input.roots),
    ...(changed === undefined ? {} : { changed }),
    observedAtMs: input.observedAtMs,
  }
}

/**
 * Names how the observation read, for the status text and for `claimable` (DXR7).
 * @param observed - The report.
 * @returns `missing` when the element or key is absent after the clicks; `changed` or `unchanged` when both reads were taken; `unavailable` otherwise.
 * @example extensionObservationResult({ kind: 'text', before: { value: 'a' }, after: { value: 'a' }, changed: false, observedAtMs: 1 }) // => 'unchanged'
 */
export function extensionObservationResult(
  observed: ChromeExtensionObserved,
): 'changed' | 'unchanged' | 'missing' | 'unavailable' {
  if ('unavailable' in observed.after) return 'unavailable'
  if ('missing' in observed.after) return 'missing'
  if (observed.changed === undefined) return 'unavailable'
  return observed.changed ? 'changed' : 'unchanged'
}
