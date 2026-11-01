import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { SIGN_IN_BROWSER_FRAME_LIMIT_BYTES } from '../constants'
import { WebSocketFlatCdp } from '../runtimeSupport/flatCdpConnection'
import { createPipeCdpTransport } from '../runtimeSupport/pipeCdpTransport'

/** One mebibyte of `a`, written again and again: the stream keeps references to it, so a frame of the full limit costs no memory of its own. */
const MEBIBYTE_WITHOUT_NUL = Buffer.alloc(1024 * 1024, 0x61)

/**
 * Writes chunks as the browser's end of the pipe, then waits until the transport has read every one of them.
 * @param fromBrowser - The browser's end.
 * @param chunks - What the browser sends, in order.
 */
async function sendFromBrowser(
  fromBrowser: PassThrough,
  chunks: readonly (Buffer | string)[],
): Promise<void> {
  for (const chunk of chunks.slice(0, -1)) fromBrowser.write(chunk)
  await new Promise<void>((resolve) => {
    fromBrowser.write(chunks.at(-1) ?? '', () => resolve())
  })
  await new Promise((resolve) => setImmediate(resolve))
}

/** The chunks of one frame of exactly the limit, still without its NUL. */
function frameOfTheLimitWithoutNul(): Buffer[] {
  return Array.from(
    { length: SIGN_IN_BROWSER_FRAME_LIMIT_BYTES / MEBIBYTE_WITHOUT_NUL.length },
    () => MEBIBYTE_WITHOUT_NUL,
  )
}

/** A transport on two in-memory pipes whose events are noted in order. */
function observedTransport(): {
  toBrowser: PassThrough
  fromBrowser: PassThrough
  events: string[]
} {
  const toBrowser = new PassThrough()
  const fromBrowser = new PassThrough()
  const transport = createPipeCdpTransport(toBrowser, fromBrowser)
  const events: string[] = []
  transport.addEventListener('message', (event: { data: string }) => {
    events.push(`message of ${event.data.length} bytes`)
  })
  // The transport's error event carries its reason as `data`, which a WebSocket's error event lacks.
  transport.addEventListener('error', (event: Event) => {
    events.push(`error: ${String(Reflect.get(event, 'data'))}`)
  })
  transport.addEventListener('close', () => {
    events.push('close')
  })
  return { toBrowser, fromBrowser, events }
}

// protects=CEO-R3 pipe transport; fails_when=split or joined chunks are misframed, a request is not NUL-terminated, or its answer does not settle it; no_claim=Chrome's own pipe implementation
test('CDP messages cross the pipe framed by NUL bytes, also when a frame arrives in pieces', async () => {
  // Arrange
  const toBrowser = new PassThrough()
  const fromBrowser = new PassThrough()
  const written: string[] = []
  toBrowser.on('data', (chunk: Buffer) => written.push(chunk.toString()))
  const cdp = new WebSocketFlatCdp(
    createPipeCdpTransport(toBrowser, fromBrowser),
  )
  const events: string[] = []
  cdp.on('Test.one', () => events.push('one'))
  cdp.on('Test.two', () => events.push('two'))
  // Act
  const answer = cdp.request('Browser.getVersion', {})
  const reply = '{"id":1,"result":{"product":"Chrome/154.0.1.2"}}\0'
  fromBrowser.write(reply.slice(0, 10))
  fromBrowser.write(reply.slice(10, 30))
  fromBrowser.write(
    `${reply.slice(30)}{"method":"Test.one","params":{}}\0{"method":"Test.two","params":{}}\0`,
  )
  const result = await answer
  await new Promise((resolve) => setImmediate(resolve))
  // Assert
  assert.deepEqual(written, [
    '{"id":1,"method":"Browser.getVersion","params":{}}\0',
  ])
  assert.deepEqual(result, { product: 'Chrome/154.0.1.2' })
  assert.deepEqual(events, ['one', 'two'])
})

// protects=Codex 4 (a lost pipe is noticed); fails_when=an ended browser pipe leaves requests pending; no_claim=Chrome crash behaviour
test('a browser pipe that ends rejects the pending request and closes the connection once', async () => {
  // Arrange
  const toBrowser = new PassThrough()
  const fromBrowser = new PassThrough()
  const cdp = new WebSocketFlatCdp(
    createPipeCdpTransport(toBrowser, fromBrowser),
  )
  let closes = 0
  cdp.onClose(() => {
    closes += 1
  })
  const answer = cdp.request('Browser.getVersion', {})
  // Act
  fromBrowser.end()
  // Assert
  await assert.rejects(answer, /CDP disconnected/)
  assert.equal(closes, 1)
})

// protects=Codex 5 (cookie values reduced inside the response handler); fails_when=the raw answer reaches the caller or an error; no_claim=which cookies Chrome returns
test('a reduced request hands the caller only the reduction, and a failing reduction rejects without the answer', async () => {
  // Arrange
  const toBrowser = new PassThrough()
  const fromBrowser = new PassThrough()
  const cdp = new WebSocketFlatCdp(
    createPipeCdpTransport(toBrowser, fromBrowser),
  )
  const raw = '{"id":1,"result":{"cookies":[{"value":"tok-SECRET-123"}]}}\0'
  const second = '{"id":2,"result":{"cookies":[{"value":"tok-SECRET-456"}]}}\0'
  // Act
  const reduced = cdp.requestReduced('Storage.getCookies', {}, (result) =>
    Array.isArray(result.cookies) ? result.cookies.length : 0,
  )
  fromBrowser.write(raw)
  const failing = cdp.requestReduced('Storage.getCookies', {}, () => {
    throw new Error('tok-SECRET-456')
  })
  fromBrowser.write(second)
  // Assert
  assert.equal(await reduced, 1)
  const failure = await failing.catch((error: unknown) => String(error))
  assert.equal(failure.includes('SECRET'), false)
})

// protects=native 8 (the pipe's pending frame is bounded); fails_when=a browser that never sends a NUL grows the buffer past the limit without an error, the limit itself is refused, or the pipe stays open; no_claim=Chrome's own framing
test('a browser frame that grows past the limit without its NUL closes the pipe with an error that names the limit', async () => {
  // Arrange
  const { toBrowser, fromBrowser, events } = observedTransport()
  // Act
  await sendFromBrowser(fromBrowser, frameOfTheLimitWithoutNul())
  const eventsAtTheLimit = [...events]
  await sendFromBrowser(fromBrowser, ['a'])
  // Assert
  assert.deepEqual(eventsAtTheLimit, [])
  assert.deepEqual(events, [
    'error: The browser sent a CDP frame longer than 134217728 bytes; Codebook closed its debugging pipe.',
    'close',
  ])
  assert.equal(fromBrowser.destroyed, true)
  assert.equal(toBrowser.writableEnded, true)
})

// protects=native 8 (a frame past the limit is never assembled); fails_when=a frame one byte past the limit is handed on because its NUL arrived in the same chunk; no_claim=frames below the limit (the framing test above)
test('a browser frame one byte past the limit is refused even when its NUL arrives with its last byte', async () => {
  // Arrange
  const { fromBrowser, events } = observedTransport()
  // Act
  await sendFromBrowser(fromBrowser, [...frameOfTheLimitWithoutNul(), 'a\0'])
  // Assert
  assert.deepEqual(events, [
    'error: The browser sent a CDP frame longer than 134217728 bytes; Codebook closed its debugging pipe.',
    'close',
  ])
})
