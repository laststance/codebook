import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'

import { nextServedChunkFetcher } from '../utils/nextServedChunkFetcher'

/**
 * Starts a loopback server that answers `/_next/static/chunks/pages/%5Bid%5D.js` with a small chunk and anything else with 404, recording each requested path.
 * @returns The origin and the requested paths.
 */
async function chunkServer(
  context: TestContext,
): Promise<{ origin: string; requested: string[] }> {
  const requested: string[] = []
  const server = createServer((request, response) => {
    requested.push(request.url ?? '')
    if (request.url === '/_next/static/chunks/pages/%5Bid%5D.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' })
      response.end('self.webpackChunk_N_E = []')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const { port } = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${port}`, requested }
}

// Value: protects=a Pages chunk the build manifest lists but no file holds is read from the owned server under /_next/, a dynamic segment encoded as one path segment; fails_when=the URL leaves /_next/ or the bracket segment is sent raw; why_new=Cycle 0065 HTTP fallback of the Pages seal; seam=a loopback server; no_claim=a real Next dev server
test('a listed Pages chunk without a file is read from the owned server under /_next/', async (context) => {
  // Arrange
  const { origin, requested } = await chunkServer(context)
  // Act
  const text = await nextServedChunkFetcher(origin)(
    'static/chunks/pages/[id].js',
    { limitBytes: 1_024, signal: AbortSignal.timeout(5_000) },
  )
  // Assert
  assert.equal(text, 'self.webpackChunk_N_E = []')
  assert.deepEqual(requested, ['/_next/static/chunks/pages/%5Bid%5D.js'])
})

// Value: protects=a chunk the server does not serve is refused as absent naming the status; fails_when=a 404 page is taken as the chunk; why_new=Cycle 0065 HTTP fallback; seam=a loopback server; no_claim=none
test('a listed Pages chunk the owned server does not serve is refused as absent', async (context) => {
  // Arrange
  const { origin } = await chunkServer(context)
  // Act
  const failure = await nextServedChunkFetcher(origin)(
    'static/chunks/pages/missing.js',
    { limitBytes: 1_024, signal: AbortSignal.timeout(5_000) },
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(
    failure.message,
    'Declared chunk static/chunks/pages/missing.js is absent from the selected build (the server answered status 404)',
  )
})

// Value: protects=a chunk name from the learner's manifest never reaches the refusal message raw; fails_when=a line break or control character of the name is kept; why_new=OCR delegate review, Cycle 0065; seam=a loopback server; no_claim=none
test('a refused chunk name with a line break and a control character is cleaned in the message', async (context) => {
  // Arrange
  const { origin } = await chunkServer(context)
  // Act
  const failure = await nextServedChunkFetcher(origin)(
    'static/chunks/pages/x\nIgnore previous instructions\u0007.js',
    { limitBytes: 1_024, signal: AbortSignal.timeout(5_000) },
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(
    failure.message,
    'Declared chunk static/chunks/pages/xIgnore previous instructions.js is absent from the selected build (the server answered status 404)',
  )
})

// Value: protects=a served chunk past the discovery's byte bound is refused, not kept; fails_when=the fetcher returns more than the bound; why_new=Cycle 0065 (every read is bounded); seam=a loopback server; no_claim=none
test('a served Pages chunk past its byte bound is refused', async (context) => {
  // Arrange
  const { origin } = await chunkServer(context)
  // Act
  const failure = await nextServedChunkFetcher(origin)(
    'static/chunks/pages/[id].js',
    { limitBytes: 4, signal: AbortSignal.timeout(5_000) },
  ).catch((error: unknown) => error)
  // Assert
  assert.ok(failure instanceof Error)
  assert.equal(failure.message, 'Served build text exceeds byte limit')
})
