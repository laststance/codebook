import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Cdp } from '../runtimeSupport/cdp'

/** Models reordered wire responses for the transport tests, without claiming a real browser result. @example socket.reply(2, { data: 'png' }) */
class TestSocket extends EventTarget {
  readonly messages: { id: number; method: string }[] = []
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.messages.push(JSON.parse(String(value)))
  }
  close(): void {
    this.dispatchEvent(new Event('close'))
  }
  reply(id: number, result: unknown): void {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ id, result }) }),
    )
  }
}

test('a screenshot is sent and resolved while the input request has no response', async () => {
  // Arrange
  const socket = new TestSocket()
  const cdp = new Cdp(socket, () => undefined)
  const input = cdp.request('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 1,
    y: 1,
  })
  // Act
  const capture = cdp.request('Page.captureScreenshot', { format: 'png' })
  socket.reply(2, { data: 'captured' })
  // Assert
  assert.deepEqual(socket.messages, [
    {
      id: 1,
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseReleased', x: 1, y: 1 },
    },
    { id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } },
  ])
  assert.deepEqual(await capture, { data: 'captured' })
  socket.reply(1, {})
  await input
  cdp.close()
})

test('a timed-out screenshot response cannot resolve a newer screenshot', async () => {
  // Arrange
  const socket = new TestSocket()
  const events: string[] = []
  const cdp = new Cdp(socket, (type) => events.push(type))
  // Act
  await assert.rejects(
    cdp.request('Page.captureScreenshot', {}, 5),
    /timed out/,
  )
  const next = cdp.request('Page.captureScreenshot', {})
  socket.reply(1, { data: 'stale' })
  socket.reply(2, { data: 'current' })
  // Assert
  assert.deepEqual(await next, { data: 'current' })
  assert.equal(
    events.filter((type) => type === 'cdp.late-response-ignored').length,
    1,
  )
  cdp.close()
})

test('disconnect rejects every outstanding request without sending another input', async () => {
  // Arrange
  const socket = new TestSocket()
  const cdp = new Cdp(socket, () => undefined)
  const input = cdp.request('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 1,
    y: 1,
  })
  const capture = cdp.request('Page.captureScreenshot', {})
  // Act
  socket.close()
  // Assert
  await assert.rejects(input, /disconnected/)
  await assert.rejects(capture, /disconnected/)
  assert.equal(socket.messages.length, 2)
})

test('overlapping event subscribers wait for one wire subscription per event without duplicating pause notifications', async () => {
  // Arrange: js-debug adds one forwarder for every supplied name, including duplicate names.
  const socket = new TestSocket(),
    cdp = new Cdp(socket, () => undefined)
  const first = cdp.subscribe(['Debugger.paused', 'Debugger.resumed'])
  let overlappingReady = false
  const overlapping = cdp
    .subscribe([
      'Debugger.paused',
      'Page.screencastFrame',
      'Page.screencastFrame',
    ])
    .then(() => {
      overlappingReady = true
    })
  const settled = Promise.allSettled([first, overlapping])
  try {
    // Act: the new event can subscribe first, but the shared pause subscription is still pending.
    socket.reply(2, {})
    await Promise.resolve()
    await Promise.resolve()
    // Assert
    assert.equal(overlappingReady, false)
    assert.deepEqual(socket.messages, [
      {
        id: 1,
        method: 'JsDebug.subscribe',
        params: { events: ['Debugger.paused', 'Debugger.resumed'] },
      },
      {
        id: 2,
        method: 'JsDebug.subscribe',
        params: { events: ['Page.screencastFrame'] },
      },
    ])
    socket.reply(1, {})
    await first
    await overlapping
    await cdp.subscribe(['Debugger.paused'])
    assert.equal(socket.messages.length, 2)
    assert.equal(overlappingReady, true)
  } finally {
    cdp.close()
    await settled
  }
})

test('an uncertain event subscription closes the proxy and rejects shared consumers without resubscribing', async () => {
  // Arrange
  const socket = new TestSocket(),
    cdp = new Cdp(socket, () => undefined)
  const first = cdp.subscribe(['Debugger.paused']),
    second = cdp.subscribe(['Debugger.paused'])
  const outcomes = Promise.allSettled([first, second])
  // Act
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        id: 1,
        error: { message: 'subscription response failed' },
      }),
    }),
  )
  // Assert
  const results = await outcomes
  assert.equal(results[0]?.status, 'rejected')
  assert.equal(results[1]?.status, 'rejected')
  assert.equal(cdp.closed, true)
  assert.equal(socket.messages.length, 1)
  await assert.rejects(cdp.subscribe(['Debugger.paused']), /CDP disconnected/)
  assert.equal(socket.messages.length, 1)
})

test('recording telemetry summarizes frame acknowledgements without hiding input responses or failed acknowledgements', async () => {
  // Arrange
  const socket = new TestSocket(),
    events: { type: string; detail: unknown }[] = []
  const cdp = new Cdp(socket, (type, detail) => events.push({ type, detail }))
  cdp.aggregateScreencastTelemetry(() => 100)
  // Act
  for (let index = 0; index < 100; index++) {
    const acknowledged = cdp.request('Page.screencastFrameAck', {
      sessionId: index,
    })
    socket.reply(index + 1, {})
    await acknowledged
  }
  const input = cdp.request('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 1,
    y: 1,
  })
  socket.reply(101, {})
  await input
  const failed = cdp.request('Page.screencastFrameAck', { sessionId: 102 })
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        id: 102,
        error: { message: 'deliberate ACK error' },
      }),
    }),
  )
  await assert.rejects(failed, /deliberate ACK error/)
  cdp.close()
  // Assert
  assert.equal(socket.messages.length, 102)
  assert.equal(events.length, 4)
  assert.deepEqual(events[0], {
    type: 'cdp.sent',
    detail: { id: 101, method: 'Input.dispatchMouseEvent' },
  })
  assert.deepEqual(events[2], {
    type: 'cdp.response',
    detail: { id: 102, method: 'Page.screencastFrameAck', failed: true },
  })
  assert.deepEqual(events[3], {
    type: 'cdp.screencast-summary',
    detail: { sinceMs: 100, untilMs: 100, sent: 101, responses: 100 },
  })
})
