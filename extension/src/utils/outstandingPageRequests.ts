import type { Protocol } from 'devtools-protocol'

import { PAGES_OUTSTANDING_REQUEST_LIMIT } from '../constants'

import {
  pagesRequestPathOf,
  type OutstandingPageRequest,
} from './pagesRequestPathOf'

/**
 * Keeps the page requests the application's own page has sent and not yet received an answer for, so the Pages verdict can check a page-module frame against the browser's request.
 *
 * Why it exists: Codebook sends no request of its own after the readiness one, so the browser's `Network` events are the only record of which page the browser waits for. Only the main frame's document request and Next's `/_next/data/…json` request from the main frame are kept, and only when the request goes to the run's application origin: images, scripts, API calls, an iframe's requests and a request to another site are no page request of the application. The server work that is paused may serve a page the browser never asked for (the entry page's data function can fetch another page of the same Next server), so a kept request is a hint that backs or contradicts a stack's page, never proof by itself. Created once per run by {@link ConfiguredBrowserRun}, fed by the browser participant's `Network.requestWillBeSent`, its frame events and the three events that end a request.
 * @example
 * const requests = new OutstandingPageRequests((origin) => origin === 'http://localhost:3000')
 * requests.start({ requestId: '7', frameId: 'main', request: { url: 'http://localhost:3000/' }, type: 'Document' })
 * requests.list() // => [{ url: 'http://localhost:3000/', resourceType: 'Document' }]
 */
export class OutstandingPageRequests {
  private readonly requests = new Map<string, OutstandingPageRequest>()
  private readonly childFrames = new Set<string>()

  /**
   * @param isApplicationOrigin - Says whether an origin (`http://localhost:3000`) is the run's application origin; a request to any other origin is not kept.
   */
  constructor(
    private readonly isApplicationOrigin: (origin: string) => boolean,
  ) {}

  /**
   * Notes a frame that is not the page's main frame, so its requests are not the page's.
   * @param frameId - The id of a frame the browser attached under another frame (`Page.frameAttached`, sent for every child frame and never for the main frame).
   * @example requests.noteChildFrame('A1B2')
   */
  noteChildFrame(frameId: string): void {
    this.childFrames.add(frameId)
  }

  /**
   * Notes a request the browser sent; a redirect of the same request replaces its address.
   * @param event - The `Network.requestWillBeSent` event (only the id, the frame, the URL and the resource type are read).
   * @example requests.start({ requestId: '7', frameId: 'main', request: { url: 'http://localhost:3000/_next/data/b/index.json?page=2' }, type: 'Fetch' })
   */
  start(event: {
    requestId: string
    frameId?: string
    request: { url: string }
    type?: Protocol.Network.ResourceType
  }): void {
    const request: OutstandingPageRequest = {
      url: event.request.url,
      resourceType: event.type ?? 'Other',
    }
    // A request that is no page request of the application's main frame is not kept, so a busy page cannot fill the list.
    if (
      !this.isMainFrameRequest(event.frameId) ||
      !this.isApplicationUrl(request.url) ||
      pagesRequestPathOf(request) === undefined
    ) {
      this.requests.delete(event.requestId)
      return
    }
    this.requests.delete(event.requestId)
    this.requests.set(event.requestId, request)
    // The oldest request goes first when the bound is passed.
    if (this.requests.size > PAGES_OUTSTANDING_REQUEST_LIMIT) {
      const oldest = this.requests.keys().next().value
      if (oldest !== undefined) this.requests.delete(oldest)
    }
  }

  /**
   * Notes that a request got its answer, failed or finished.
   * @param requestId - The request's id.
   * @example requests.finish('7')
   */
  finish(requestId: string): void {
    this.requests.delete(requestId)
  }

  /**
   * Lists the page requests still waiting for an answer, oldest first.
   * @returns A copy of the list.
   * @example requests.list() // => []
   */
  list(): readonly OutstandingPageRequest[] {
    return [...this.requests.values()]
  }

  /** A request with no frame (a worker's) or from a child frame (an iframe's) is not the page's own. */
  private isMainFrameRequest(frameId: string | undefined): boolean {
    return frameId !== undefined && !this.childFrames.has(frameId)
  }

  /** A URL that does not parse, or that goes to another origin than the application's, is not the page's own. */
  private isApplicationUrl(url: string): boolean {
    try {
      return this.isApplicationOrigin(new URL(url).origin)
    } catch {
      // A URL that does not parse names no origin.
      return false
    }
  }
}
