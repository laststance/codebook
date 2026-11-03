import type { Protocol } from 'devtools-protocol'

import { PAGES_OUTSTANDING_REQUEST_LIMIT } from '../constants'

import {
  pagesRequestPathOf,
  type OutstandingPageRequest,
} from './pagesRequestPathOf'

/**
 * Keeps the page requests the browser has sent and not yet received an answer for, so the Pages verdict can name the page a server hit renders when its stack cannot.
 *
 * Why it exists: Codebook sends no request of its own after the readiness one, so the browser's `Network` events are the only record of which page the server is working for. Only document requests and Next's `/_next/data/…json` requests are kept; images, scripts and API calls are no page request. Created once per run by {@link ConfiguredBrowserRun}, fed by the browser participant's `Network.requestWillBeSent` and the three events that end a request.
 * @example
 * const requests = new OutstandingPageRequests()
 * requests.start({ requestId: '7', request: { url: 'http://localhost:3000/' }, type: 'Document' })
 * requests.list() // => [{ url: 'http://localhost:3000/', resourceType: 'Document' }]
 */
export class OutstandingPageRequests {
  private readonly requests = new Map<string, OutstandingPageRequest>()

  /**
   * Notes a request the browser sent; a redirect of the same request replaces its address.
   * @param event - The `Network.requestWillBeSent` event (only the id, the URL and the resource type are read).
   * @example requests.start({ requestId: '7', request: { url: 'http://localhost:3000/_next/data/b/index.json?page=2' }, type: 'Fetch' })
   */
  start(event: {
    requestId: string
    request: { url: string }
    type?: Protocol.Network.ResourceType
  }): void {
    const request: OutstandingPageRequest = {
      url: event.request.url,
      resourceType: event.type ?? 'Other',
    }
    // A request that is no page request is not kept, so a busy page cannot fill the list.
    if (pagesRequestPathOf(request) === undefined) {
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
}
