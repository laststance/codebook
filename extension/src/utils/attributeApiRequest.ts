import type {
  ApiRequestFact,
  ApiRequestWatched,
} from '../configuredStudySchemas'
import {
  API_REQUEST_EARLY_END_LIMIT,
  API_REQUEST_METHOD_LIMIT_CHARS,
  API_REQUEST_METHOD_TOKEN_PATTERN,
  API_REQUEST_PATH_ELLIPSIS,
  API_REQUEST_PATH_LIMIT_CHARS,
  API_REQUEST_SEVERAL_MIN_COUNT,
  ROUTE_HANDLER_REQUEST_LIMIT,
} from '../constants'

import { apiRequestFactOf, type ApiRequestDecision } from './apiRequestFactOf'

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
  /** Which origin the hop went to. */
  route: ApiRequestRoute
  /** The declared prefix a dev-server hop matched. */
  proxyPath?: string
}

/** Which origin one page request went to. */
type ApiRequestRoute = 'api-origin' | 'dev-server-proxy'

/** Turns the tracker proxy-aware: the declared `apiServer.proxyPaths`, possibly empty (D29). */
export interface ApiProxyOptions {
  proxyPaths: readonly string[]
}

/** Where one request URL points, when it is a candidate. */
interface RequestClassification {
  route: ApiRequestRoute
  proxyPath?: string
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

/** Parses a URL that is `http:` on a loopback host; `undefined` for anything else (including text that is no URL). */
function loopbackHttpUrlOf(text: string): URL | undefined {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname)
    ? url
    : undefined
}

/**
 * Finds the longest declared prefix a path equals or continues at a `/` boundary.
 * @example matchedPrefixOf('/api/x', ['/api']) // => '/api'; matchedPrefixOf('/apiculture', ['/api']) // => undefined
 */
function matchedPrefixOf(
  pathname: string,
  prefixes: readonly string[],
): string | undefined {
  let best: string | undefined
  for (const prefix of prefixes) {
    const boundary = prefix.endsWith('/') ? prefix : `${prefix}/`
    const isMatch = pathname === prefix || pathname.startsWith(boundary)
    // The longest matching prefix names the route.
    if (isMatch && (best === undefined || prefix.length > best.length))
      best = prefix
  }
  return best
}

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

  /** The port the run's dev server listens on; unset until {@link ApiRequestTracker.bindDevServerPort}. */
  private devServerPort?: number
  /** Declared prefixes of a proxy-aware tracker; `undefined` for an Expo tracker. */
  private readonly proxyPaths?: readonly string[]
  private readonly limit: number

  /**
   * @param port - The declared `apiServer.port`; requests to `localhost`, `127.0.0.1` and `[::1]` on it are tracked.
   * @param limitOrProxy - A number is the most requests kept (the oldest finished ones go first). `{ proxyPaths }` makes the tracker proxy-aware, even with an empty list.
   * @param limit - Most requests kept when the proxy options are given.
   */
  constructor(
    private readonly port: number,
    limitOrProxy?: number | ApiProxyOptions,
    limit?: number,
  ) {
    if (typeof limitOrProxy === 'object')
      this.proxyPaths = limitOrProxy.proxyPaths
    this.limit =
      (typeof limitOrProxy === 'number' ? limitOrProxy : limit) ??
      ROUTE_HANDLER_REQUEST_LIMIT
  }

  /**
   * Tells the tracker which port the dev server listens on; called once, right after the server started and before the browser opens.
   *
   * A dev-server request seen before this call is never a candidate. Has no effect on an Expo tracker.
   */
  bindDevServerPort(port: number): void {
    this.devServerPort = port
  }

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
    const classification = this.classify(event.request.url)
    if (!classification) {
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
      route: classification.route,
      proxyPath: classification.proxyPath,
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
    let decision: ApiRequestDecision
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
      decision = {
        state: 'attributed',
        method,
        path,
        route: only.route,
        proxyPath: only.proxyPath,
      }
    } else {
      // A lone candidate that cannot be named, or whose neighbours may have been dropped, is not a unique match.
      const count =
        only && mayHaveLostCandidate
          ? API_REQUEST_SEVERAL_MIN_COUNT
          : candidates.length === 1
            ? 0
            : candidates.length
      decision = {
        state: 'unattributed',
        reason: count === 0 ? 'none' : 'several',
        count,
      }
    }
    return apiRequestFactOf(decision, {
      operation: pause.operation,
      title: pause.title,
      watched: this.watched(),
    })
  }

  /** What a proxy-aware tracker watches; `undefined` for an Expo tracker. */
  private watched(): ApiRequestWatched | undefined {
    if (!this.proxyPaths) return undefined
    const hasPrefixes = this.proxyPaths.length > 0
    return {
      apiPort: this.port,
      ...(hasPrefixes && this.devServerPort !== undefined
        ? { devServerPort: this.devServerPort }
        : {}),
      proxyPaths: [...this.proxyPaths],
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

  /**
   * Decides whether a request URL is a candidate and which route it took.
   *
   * API origin first; then, in a proxy-aware tracker with a bound dev-server port, the dev-server origin under the longest declared prefix at a `/` boundary.
   * @returns The route, or `undefined` for a request outside both.
   */
  private classify(text: string): RequestClassification | undefined {
    const url = loopbackHttpUrlOf(text)
    if (!url) return undefined
    const port = url.port || '80'
    if (port === String(this.port)) return { route: 'api-origin' }
    if (this.devServerPort === undefined || port !== String(this.devServerPort))
      return undefined
    const proxyPath = matchedPrefixOf(url.pathname, this.proxyPaths ?? [])
    return proxyPath === undefined
      ? undefined
      : { route: 'dev-server-proxy', proxyPath }
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
