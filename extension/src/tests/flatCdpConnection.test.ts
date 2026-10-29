import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FlatCdpCommandError,
  isMethodNotFound,
  WebSocketFlatCdp,
  type FlatCdpTransport,
} from '../runtimeSupport/flatCdpConnection'

/** A transport whose frames a test reads and answers. */
function fakeTransport() {
  const sent: Record<string, unknown>[] = []
  const handlers: Record<string, ((event: { data: string }) => void)[]> = {}
  const transport: FlatCdpTransport = {
    addEventListener: (type: string, handler: unknown) => {
      if (typeof handler === 'function')
        (handlers[type] ??= []).push(
          handler as (event: { data: string }) => void,
        )
    },
    send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      sent.push(JSON.parse(String(data)))
    },
    close: () => {
      for (const handler of handlers.close ?? []) handler({ data: '' })
    },
  }
  const receive = (message: object): void => {
    for (const handler of handlers.message ?? [])
      handler({ data: JSON.stringify(message) })
  }
  return { transport, sent, receive }
}

// Value: protects=TZ1/SR18 session routing; fails_when=sessionId is dropped from a request or a command is answered by another id; no_claim=a real socket
test('a request with a session id is sent with it and is settled by the answer of its own id', async () => {
  // Arrange
  const { transport, sent, receive } = fakeTransport()
  const cdp = new WebSocketFlatCdp(transport)
  // Act
  const first = cdp.request('Page.enable', {}, 'S1')
  const second = cdp.request('Browser.getVersion', {})
  receive({ id: 2, result: { product: 'Chrome/156' } })
  receive({ id: 1, result: { ok: true }, sessionId: 'S1' })
  // Assert
  assert.deepEqual(sent, [
    { id: 1, method: 'Page.enable', params: {}, sessionId: 'S1' },
    { id: 2, method: 'Browser.getVersion', params: {} },
  ])
  assert.deepEqual(await first, { ok: true })
  assert.deepEqual(await second, { product: 'Chrome/156' })
})

test('an event reaches its listener with the session it came from, and not after the listener is removed', () => {
  // Arrange
  const { transport, receive } = fakeTransport()
  const cdp = new WebSocketFlatCdp(transport)
  const seen: unknown[] = []
  const remove = cdp.on('Target.attachedToTarget', (params, sessionId) => {
    seen.push([params, sessionId])
  })
  // Act
  receive({
    method: 'Target.attachedToTarget',
    params: { a: 1 },
    sessionId: 'S9',
  })
  remove()
  receive({ method: 'Target.attachedToTarget', params: { a: 2 } })
  // Assert
  assert.deepEqual(seen, [[{ a: 1 }, 'S9']])
})

test('a missing method is recognised from CDP’s code, from "wasn’t found" and from js-debug’s answer, and no other failure is', async () => {
  // Arrange
  const { transport, receive } = fakeTransport()
  const cdp = new WebSocketFlatCdp(transport)
  const byCode = cdp.request('A.b', {})
  receive({ id: 1, error: { code: -32601, message: 'x' } })
  const byText = cdp.request('A.c', {})
  receive({ id: 2, error: { code: -32000, message: "'A.c' wasn't found" } })
  const byProxy = cdp.request('A.d', {})
  receive({ id: 3, error: { code: -32000, message: 'Method not available.' } })
  const other = cdp.request('A.e', {})
  receive({
    id: 4,
    error: { code: -32600, message: 'File path cannot be resolved.' },
  })
  // Act
  const errors = await Promise.all(
    [byCode, byText, byProxy, other].map((request) =>
      request.then(
        () => undefined,
        (error: unknown) => error,
      ),
    ),
  )
  // Assert
  assert.deepEqual(errors.map(isMethodNotFound), [true, true, true, false])
  assert.ok(errors[3] instanceof FlatCdpCommandError)
  assert.equal(errors[3].message, 'A.e: File path cannot be resolved.')
})

test('a command that is not answered in its own time fails with a timeout, and an outstanding command fails when the connection closes', async () => {
  // Arrange
  const { transport } = fakeTransport()
  const cdp = new WebSocketFlatCdp(transport)
  // Act
  const slow = cdp.request('A.slow', {}, undefined, 5)
  const outstanding = cdp.request('A.open', {}, undefined, 10_000)
  const slowError = await slow.then(
    () => undefined,
    (error: unknown) => error,
  )
  cdp.close()
  const outstandingError = await outstanding.then(
    () => undefined,
    (error: unknown) => error,
  )
  // Assert
  assert.equal(String(slowError), 'Error: A.slow: timed out')
  assert.equal(String(outstandingError), 'Error: A.open: CDP disconnected')
  await assert.rejects(cdp.request('A.late', {}), /CDP disconnected/)
})
