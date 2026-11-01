import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { WebSocketFlatCdp } from '../runtimeSupport/flatCdpConnection'
import { createPipeCdpTransport } from '../runtimeSupport/pipeCdpTransport'

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
