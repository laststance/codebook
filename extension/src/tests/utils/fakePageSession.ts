import type { Protocol } from 'devtools-protocol'

import { Cdp } from '../../runtimeSupport/cdp'

/** One command the code under test sent over the fake page session. */
export type SentCommand = { method: string; params: unknown }

/**
 * A page session whose commands are recorded and answered with an empty result, and whose events a test emits.
 *
 * Why it exists: the CDN redirect speaks to js-debug's page proxy through {@link Cdp}; the fake stands in for that socket, so a test sees the exact commands and order the redirect sends and feeds it recorded `Fetch.requestPaused` events.
 * @example
 * const session = new FakePageSession()
 * const redirect = new CdnImportRedirect({ cdp: session.cdp, … })
 */
export class FakePageSession extends EventTarget {
  readonly commands: SentCommand[] = []
  readonly cdp = new Cdp(this, () => undefined)

  /** Answers a command with an empty result, as the proxy does. */
  send(data: string): void {
    const message: { id: number; method: string; params?: unknown } =
      JSON.parse(data)
    this.commands.push({ method: message.method, params: message.params })
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ id: message.id, result: {} }),
      }),
    )
  }

  /** Closes the session, as a page that went away does. */
  close(): void {
    this.dispatchEvent(new Event('close'))
  }

  /** Delivers one event of the page's debugger or network layer. */
  emit(method: string, params: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ method, params }) }),
    )
  }

  /**
   * Delivers a paused request for an address, the form `Fetch.requestPaused` has at the request stage.
   * @param url - The requested address.
   * @param requestId - The request's id.
   * @param method - The request's method.
   */
  pause(url: string, requestId: string, method = 'GET'): void {
    const event: Protocol.Fetch.RequestPausedEvent = {
      requestId,
      request: {
        url,
        method,
        headers: {},
        initialPriority: 'High',
        referrerPolicy: 'no-referrer',
      },
      frameId: 'frame-1',
      resourceType: 'Script',
    }
    this.emit('Fetch.requestPaused', event)
  }

  /** Waits until the commands satisfy a condition, so an asynchronous answer to an event can be asserted. */
  async until(
    condition: (commands: readonly SentCommand[]) => boolean,
  ): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (condition(this.commands)) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(
      `The commands never satisfied the condition: ${this.commands.map((command) => command.method).join(', ')}`,
    )
  }
}
