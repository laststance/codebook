import type { ApiRequestFact } from '../configuredStudySchemas'
import {
  API_REQUEST_EARLY_END_LIMIT,
  API_REQUEST_METHOD_LIMIT_CHARS,
  API_REQUEST_METHOD_TOKEN_PATTERN,
  API_REQUEST_PATH_ELLIPSIS,
  API_REQUEST_PATH_LIMIT_CHARS,
  API_REQUEST_SEVERAL_MIN_COUNT,
  ROUTE_HANDLER_REQUEST_LIMIT,
} from '../constants'

import { describeApiRequestSentence } from './describeApiRequestSentence'

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

/** One stretch of a request's life spent at the API origin: a redirect chain gives a request one hop per URL. */
interface TrackedHop {
  method: string
  url: string
  startWallMs: number
  startTimestamp: number
  /** Monotonic end timestamp (seconds): the next redirect hop's start or an end event. */
  endTimestamp?: number
}

/** Keeps a masked path within {@link API_REQUEST_PATH_LIMIT_CHARS}, ending a cut path with {@link API_REQUEST_PATH_ELLIPSIS}. */
function capPath(path: string): string {
  if (path.length <= API_REQUEST_PATH_LIMIT_CHARS) return path
  return (
    path.slice(
      0,
      API_REQUEST_PATH_LIMIT_CHARS - API_REQUEST_PATH_ELLIPSIS.length,
    ) + API_REQUEST_PATH_ELLIPSIS
  )
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
  /** Hops at the API origin per request id, oldest hop first. */
  private readonly requests = new Map<string, TrackedHop[]>()
  /** End events that arrived before their start; bounded apart from the starts so they cannot evict one. */
  private readonly earlyEnds = new Map<string, number>()
  /** Ids of requests seen starting outside the API origin, so their end events are not kept as early ends. */
  private readonly outsideIds = new Set<string>()
  /** Newest start (wall ms) of any request dropped at the limit; `-Infinity` while none was. */
  private evictedNewestStartWallMs = -Infinity
  /** Latest end (wall ms, `Infinity` when still open) of any request dropped at the limit. */
  private evictedLatestEndWallMs = -Infinity

  /**
   * @param port - The declared `apiServer.port`; requests to `localhost`, `127.0.0.1` and `[::1]` on it are tracked.
   * @param limit - Most requests kept; the oldest finished ones go first.
   */
  constructor(
    private readonly port: number,
    private readonly limit: number = ROUTE_HANDLER_REQUEST_LIMIT,
  ) {}

  /**
   * Records a request start or a redirect hop.
   *
   * A redirect hop ends the previous hop at the hop's own timestamp; a hop outside the API origin starts no candidate, and a hop into the API origin starts one at the hop's time.
   */
  requestWillBeSent(event: ApiRequestWillBeSent): void {
    const isRedirectHop = event.redirectResponse !== undefined
    const hops = this.requests.get(event.requestId)
    if (isRedirectHop && hops) {
      // The request left its previous URL here, whatever origin the next one is.
      const previous = hops[hops.length - 1]!
      previous.endTimestamp ??= event.timestamp
    }
    if (!this.isApiOrigin(event.request.url)) {
      this.rememberOutside(event.requestId)
      return
    }
    const early = this.earlyEnds.get(event.requestId)
    this.earlyEnds.delete(event.requestId)
    const hop: TrackedHop = {
      method: event.request.method,
      url: event.request.url,
      startWallMs: event.wallTime * 1000,
      startTimestamp: event.timestamp,
      endTimestamp: early,
    }
    // A repeated start of the same id without a redirect response starts the request afresh.
    if (isRedirectHop && hops) hops.push(hop)
    else this.requests.set(event.requestId, [hop])
    this.trim()
  }

  /** Records `loadingFinished` or `loadingFailed`; an end received before its start waits for it. */
  requestEnded(event: ApiRequestEnded): void {
    const hops = this.requests.get(event.requestId)
    if (hops) {
      const last = hops[hops.length - 1]!
      // A hop already closed by a redirect keeps that end.
      last.endTimestamp ??= event.timestamp
      return
    }
    // A request seen starting outside the API origin has no start to wait for.
    if (this.outsideIds.has(event.requestId)) return
    this.earlyEnds.set(event.requestId, event.timestamp)
    if (this.earlyEnds.size > API_REQUEST_EARLY_END_LIMIT)
      this.earlyEnds.delete(this.earlyEnds.keys().next().value!)
  }

  /**
   * Judges one API pause: the requests that started in the window and were still open at the cutoff.
   *
   * Uniqueness is refused when it cannot be shown: a candidate whose method cannot be saved (not an RFC 9110 token within {@link API_REQUEST_METHOD_LIMIT_CHARS}) is counted but never named, so a lone one gives `none` (no request Codebook can name), and history dropped at the limit that may hold an in-window request turns a lone candidate into `several`.
   * @param pause - The window, operation and masking.
   * @returns The fact with its ready sentence.
   */
  attribute(pause: ApiPauseWindow): ApiRequestFact {
    const candidates = [...this.requests.values()]
      .flat()
      .filter((hop) => this.isCandidate(hop, pause))
    const only = candidates.length === 1 ? candidates[0]! : undefined
    const method = only?.method.toUpperCase()
    const mayHaveLostCandidate =
      this.evictedNewestStartWallMs >= pause.windowStartWallMs &&
      this.evictedLatestEndWallMs > pause.cutoffWallMs
    if (
      only &&
      method !== undefined &&
      isKeepableMethod(method) &&
      !mayHaveLostCandidate
    ) {
      // Cut at the producer so the saved study stays valid; the sentence names the same path.
      const path = capPath(pause.maskText(new URL(only.url).pathname))
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
    // A lone candidate that cannot be named, or whose neighbours may have been dropped, is not a unique match.
    const count =
      only && mayHaveLostCandidate
        ? API_REQUEST_SEVERAL_MIN_COUNT
        : candidates.length === 1
          ? 0
          : candidates.length
    const reason = count === 0 ? 'none' : 'several'
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

  private isCandidate(hop: TrackedHop, pause: ApiPauseWindow): boolean {
    if (hop.method.toUpperCase() === 'OPTIONS') return false
    if (
      hop.startWallMs < pause.windowStartWallMs ||
      hop.startWallMs > pause.cutoffWallMs
    )
      return false
    // No end yet: still open. Otherwise the end instant comes from the hop's own timestamps.
    return hopEndWallMs(hop) > pause.cutoffWallMs
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

  private rememberOutside(requestId: string): void {
    this.outsideIds.add(requestId)
    if (this.outsideIds.size > API_REQUEST_EARLY_END_LIMIT)
      this.outsideIds.delete(this.outsideIds.values().next().value!)
  }

  /** Drops the oldest finished requests (then the oldest overall) beyond the bound, remembering what was lost. */
  private trim(): void {
    while (this.requests.size > this.limit) {
      const finished = [...this.requests].find(
        ([, hops]) => hops[hops.length - 1]!.endTimestamp !== undefined,
      )
      const victimId = finished?.[0] ?? this.requests.keys().next().value!
      for (const hop of this.requests.get(victimId)!) {
        this.evictedNewestStartWallMs = Math.max(
          this.evictedNewestStartWallMs,
          hop.startWallMs,
        )
        this.evictedLatestEndWallMs = Math.max(
          this.evictedLatestEndWallMs,
          hopEndWallMs(hop),
        )
      }
      this.requests.delete(victimId)
    }
  }
}

/** The wall time (ms) a hop ended, from its own timestamps; `Infinity` while it has no end. */
function hopEndWallMs(hop: TrackedHop): number {
  if (hop.endTimestamp === undefined) return Infinity
  return hop.startWallMs + (hop.endTimestamp - hop.startTimestamp) * 1000
}

/** Whether an upper-cased method can be saved in an `apiRequest` fact (token characters, within the length bound). */
function isKeepableMethod(method: string): boolean {
  return (
    method.length <= API_REQUEST_METHOD_LIMIT_CHARS &&
    API_REQUEST_METHOD_TOKEN_PATTERN.test(method)
  )
}
