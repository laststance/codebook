import { ROUTE_HANDLER_REQUEST_LIMIT } from '../constants'

import { describeApiRequestSentence } from './describeApiRequestSentence'

/**
 * The fact a server (API) pause carries about the page request that waited for it. Structurally the same as the `ApiRequestFact` the saved-study schema exports.
 */
export type ApiRequestFact =
  | {
      state: 'attributed'
      method: string
      path: string
      operation: number
      basis: 'time-window'
      sentence: string
    }
  | {
      state: 'unattributed'
      reason: 'none' | 'several'
      count: number
      sentence: string
    }

/** The `Network.requestWillBeSent` fields {@link ApiRequestTracker} reads. */
export interface ApiRequestWillBeSent {
  requestId: string
  /** Monotonic seconds. */
  timestamp: number
  /** Wall-clock seconds. */
  wallTime: number
  request: { method: string; url: string }
  redirectResponse?: unknown
}

/** The `Network.loadingFinished` / `Network.loadingFailed` fields {@link ApiRequestTracker} reads. */
export interface ApiRequestEnded {
  requestId: string
  /** Monotonic seconds. */
  timestamp: number
}

/** What {@link ApiRequestTracker.attribute} judges one API pause by. */
export interface ApiPauseWindow {
  /** Wall time (ms) the stop's operation input was dispatched; inclusive. */
  windowStartWallMs: number
  /** Wall time (ms) the run received the pause. */
  cutoffWallMs: number
  /** The stop's `afterOperation`. */
  operation: number
  /** The operation's title, worded into the sentence. */
  title: string
  /** Masks the request path as the run masks text. */
  maskText: (text: string) => string
}

interface TrackedRequest {
  method: string
  url: string
  startWallMs: number
  startTimestamp: number
  /** Monotonic end timestamp (seconds), when an end event arrived. */
  endTimestamp?: number
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Follows the page's requests to the API origin so one API pause can be matched to the request waiting for it (D7).
 *
 * Why it exists: the paused API frames reach no request object (E1), so the only honest attribution is by time. Lifetimes come from each request's own timestamps, so the verdict never depends on the order events were delivered in (OV-1). Pure: the browser run feeds it the page's Network events and asks {@link ApiRequestTracker.attribute} at the pause.
 * @example
 * ```ts
 * const tracker = new ApiRequestTracker(4100)
 * tracker.requestWillBeSent(event)
 * tracker.attribute({ windowStartWallMs, cutoffWallMs, operation: 1, title: 'Press', maskText: (text) => text }).state // 'attributed'
 * ```
 */
export class ApiRequestTracker {
  private readonly requests = new Map<string, TrackedRequest>()
  /** End events that arrived before their start. */
  private readonly earlyEnds = new Map<string, number>()

  /**
   * @param port - The declared `apiServer.port`; requests to `localhost`, `127.0.0.1` and `[::1]` on it are tracked.
   * @param limit - Most requests kept; the oldest finished ones go first.
   */
  constructor(
    private readonly port: number,
    private readonly limit: number = ROUTE_HANDLER_REQUEST_LIMIT,
  ) {}

  /** Records a request start, or a redirect hop (same id: the first start stays, the last URL wins). */
  requestWillBeSent(event: ApiRequestWillBeSent): void {
    if (!this.isApiOrigin(event.request.url)) return
    const known = this.requests.get(event.requestId)
    // Redirect hop: keep the original start so the window judges when the page sent it.
    if (known && event.redirectResponse !== undefined) {
      known.url = event.request.url
      known.method = event.request.method
      return
    }
    const early = this.earlyEnds.get(event.requestId)
    this.earlyEnds.delete(event.requestId)
    this.requests.set(event.requestId, {
      method: event.request.method,
      url: event.request.url,
      startWallMs: event.wallTime * 1000,
      startTimestamp: event.timestamp,
      endTimestamp: early,
    })
    this.trim()
  }

  /** Records `loadingFinished` or `loadingFailed`; an end received before its start waits for it. */
  requestEnded(event: ApiRequestEnded): void {
    const known = this.requests.get(event.requestId)
    if (known) {
      known.endTimestamp = event.timestamp
      return
    }
    // Remember the end for a start still in flight, within the same bound.
    this.earlyEnds.set(event.requestId, event.timestamp)
    if (this.earlyEnds.size > this.limit)
      this.earlyEnds.delete(this.earlyEnds.keys().next().value!)
  }

  /**
   * Judges one API pause: the requests that started in the window and were still open at the cutoff.
   * @param pause - The window, operation and masking.
   * @returns The fact with its ready sentence.
   */
  attribute(pause: ApiPauseWindow): ApiRequestFact {
    const candidates = [...this.requests.values()].filter((request) =>
      this.isCandidate(request, pause),
    )
    if (candidates.length === 1) {
      const only = candidates[0]!
      const method = only.method.toUpperCase()
      const path = pause.maskText(new URL(only.url).pathname)
      return {
        state: 'attributed',
        method,
        path,
        operation: pause.operation,
        basis: 'time-window',
        sentence: describeApiRequestSentence({
          state: 'attributed',
          method,
          path,
          operation: pause.operation,
          title: pause.title,
        }),
      }
    }
    const reason = candidates.length === 0 ? 'none' : 'several'
    const count = candidates.length
    return {
      state: 'unattributed',
      reason,
      count,
      sentence: describeApiRequestSentence({
        state: 'unattributed',
        reason,
        count,
      }),
    }
  }

  private isCandidate(request: TrackedRequest, pause: ApiPauseWindow): boolean {
    if (request.method.toUpperCase() === 'OPTIONS') return false
    if (
      request.startWallMs < pause.windowStartWallMs ||
      request.startWallMs > pause.cutoffWallMs
    )
      return false
    // No end yet: still open. Otherwise the end instant comes from the request's own timestamps.
    if (request.endTimestamp === undefined) return true
    const endWallMs =
      request.startWallMs +
      (request.endTimestamp - request.startTimestamp) * 1000
    return endWallMs > pause.cutoffWallMs
  }

  private isApiOrigin(text: string): boolean {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return false
    }
    return (
      url.protocol === 'http:' &&
      LOOPBACK_HOSTNAMES.has(url.hostname) &&
      (url.port || '80') === String(this.port)
    )
  }

  /** Drops the oldest finished requests (then the oldest overall) beyond the bound. */
  private trim(): void {
    while (this.requests.size > this.limit) {
      const finished = [...this.requests].find(
        ([, request]) => request.endTimestamp !== undefined,
      )
      this.requests.delete(finished?.[0] ?? this.requests.keys().next().value!)
    }
  }
}
