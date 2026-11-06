import {
  MILLISECONDS_PER_SECOND,
  ROUTE_HANDLER_REQUEST_LIMIT,
} from '../constants'

import { routeHandlerPathMatches } from './routeHandlerPathMatches'

/** One kept request: what the correlation needs and never a header or body. */
export type TrackedRouteHandlerRequest = {
  id: string
  method: string
  pathname: string
  /** The pathname plus the query string, as the browser sent it: how an API-route pause names its request (E-2). */
  target: string
  window: number
  startedAtMs: number
  /** Wall time of the request's start in epoch milliseconds: the browser's own `wallTime` when the event carried one, else the wall time Codebook received the event. */
  wallTimeMs: number
}

/**
 * Keeps the app-origin API requests the page sent whose pathname matches a declared route pattern, with the operation window each started in.
 *
 * Why it exists: a route-handler pause is the learner's only when the browser sent a request for it after the stop's operation, and the browser's own `Network` events are the only record of that. Created once per run by {@link ConfiguredBrowserRun}, fed by the browser participant's `Network.requestWillBeSent`; it keeps at most {@link ROUTE_HANDLER_REQUEST_LIMIT} requests, oldest dropped.
 * @example
 * const tracker = new RouteHandlerRequests(['/api/todos'])
 * tracker.start({ requestId: '7', method: 'POST', url: 'http://localhost:3000/api/todos' }, 2, 100)
 * tracker.list() // => [{ id: '7', method: 'POST', pathname: '/api/todos', target: '/api/todos', window: 2, startedAtMs: 100, wallTimeMs: … }]
 */
export class RouteHandlerRequests {
  private readonly requests = new Map<string, TrackedRouteHandlerRequest>()
  /** The wall time, in epoch milliseconds, at which Codebook sent each operation's input, by operation order (index 0 is operation 1). */
  private readonly dispatchedAtMs: number[] = []

  /**
   * @param routes - The route patterns the run's route-handler stops declare.
   * @param isApplicationOrigin - Says whether an origin is the run's application origin; other origins are not kept.
   */
  constructor(
    private readonly routes: readonly string[],
    private readonly isApplicationOrigin: (origin: string) => boolean = () =>
      true,
  ) {}

  /**
   * Records the wall time at which Codebook sent an operation's input, so a request is placed in a window by when the page sent it and not by when its event arrived (E-3).
   * @param operation - The operation (1-based) whose input is being sent.
   * @param wallMs - The wall clock in epoch milliseconds.
   * @example tracker.noteDispatch(1, 1_700_000_000_000)
   */
  noteDispatch(operation: number, wallMs: number): void {
    this.dispatchedAtMs[operation - 1] = wallMs
  }

  /**
   * Gives the window a request belongs to: the operations whose input was sent no later than the request's own start, never more than the operations dispatched when its event arrived.
   * @param receiptWindow - The operations dispatched when the event arrived.
   * @param wallTimeMs - The request's own start in epoch milliseconds; `undefined` when the event carried none.
   * @returns The window; `receiptWindow` when no wall time or no dispatch time is known, since an operation whose send time was never noted counts by receipt order.
   * @example tracker.windowOf(1, undefined) // => 1
   */
  private windowOf(
    receiptWindow: number,
    wallTimeMs: number | undefined,
  ): number {
    if (wallTimeMs === undefined) return receiptWindow
    let window = 0
    // Operations are sent in order, so the first one known to be sent after the request ends the count; one without a noted time was dispatched before the event arrived.
    for (let index = 0; index < receiptWindow; index++) {
      const sentAtMs = this.dispatchedAtMs[index]
      if (sentAtMs !== undefined && sentAtMs > wallTimeMs) break
      window = index + 1
    }
    return window
  }

  /**
   * Notes a request the browser sent when its pathname matches a declared route; a redirect hop to another declared route or with another method is kept as its own entry (id `<requestId> <METHOD> <pathname>`).
   * @param event - The method and URL of `Network.requestWillBeSent`, and its `wallTime` in seconds since the epoch when the event has one.
   * @param window - The number of operations dispatched so far, when the event arrived.
   * @param nowMs - The run's clock reading.
   * @example tracker.start({ requestId: '7', method: 'GET', url: 'http://localhost:3000/api/todos' }, 0, 5)
   */
  start(
    event: {
      requestId: string
      method: string
      url: string
      wallTime?: number
    },
    window: number,
    nowMs: number,
  ): void {
    let parsed: URL
    try {
      parsed = new URL(event.url)
    } catch {
      // A URL that does not parse names no route.
      return
    }
    if (
      !this.isApplicationOrigin(parsed.origin) ||
      !this.routes.some((route) =>
        routeHandlerPathMatches(route, parsed.pathname),
      )
    )
      return
    const method = event.method.toUpperCase()
    const first = this.requests.get(event.requestId)
    // Chrome reports each redirect hop under the request's id: the same method and path is the same hop, another one is a hop of its own.
    if (first?.method === method && first.pathname === parsed.pathname) return
    const id = first
      ? `${event.requestId} ${method} ${parsed.pathname}`
      : event.requestId
    if (this.requests.has(id)) return
    const wallTimeMs =
      event.wallTime === undefined
        ? undefined
        : event.wallTime * MILLISECONDS_PER_SECOND
    this.requests.set(id, {
      id,
      method,
      pathname: parsed.pathname,
      target: `${parsed.pathname}${parsed.search}`,
      window: this.windowOf(window, wallTimeMs),
      startedAtMs: nowMs,
      wallTimeMs: wallTimeMs ?? Date.now(),
    })
    // The oldest request goes first when the bound is passed.
    if (this.requests.size > ROUTE_HANDLER_REQUEST_LIMIT) {
      const oldest = this.requests.keys().next().value
      if (oldest !== undefined) this.requests.delete(oldest)
    }
  }

  /**
   * Lists the kept requests, oldest first.
   * @returns A copy of the list.
   * @example tracker.list().length // => 0
   */
  list(): readonly TrackedRouteHandlerRequest[] {
    return [...this.requests.values()]
  }
}
