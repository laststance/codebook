import assert from 'node:assert/strict'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, type TestContext } from 'node:test'

import { fetchOwnedServer } from '../utils/fetchOwnedServer'

/** Starts a loopback server whose handler the test supplies; closed when the test ends. */
async function serve(
  context: TestContext,
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; server: Server }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const { port } = server.address() as AddressInfo
  return { origin: `http://127.0.0.1:${port}`, server }
}

// Value: protects=the Host header a profile asks for reaches the server; fails_when=Host is the connection address; why_new=undici ignores Host; seam=real loopback server; no_claim=other headers
test('sends the requested Host header while connecting to the owned address', async (context) => {
  // Arrange
  const { origin } = await serve(context, (request, response) =>
    response.end(String(request.headers.host)),
  )
  // Act
  const response = await fetchOwnedServer(
    `${origin}/x`,
    'localhost:4101',
    new AbortController().signal,
  )
  // Assert
  assert.equal(await response.text(), 'localhost:4101')
})

// Value: protects=a redirect stays unfollowed; fails_when=a 3xx is followed to another address; why_new=redirect manual contract; seam=real loopback server; no_claim=none
test('returns a redirect answer as is without following it', async (context) => {
  // Arrange
  const { origin } = await serve(context, (_request, response) => {
    response.statusCode = 302
    response.setHeader('location', 'http://example.invalid/')
    response.end()
  })
  // Act
  const response = await fetchOwnedServer(
    `${origin}/`,
    'localhost:1',
    new AbortController().signal,
  )
  // Assert
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'http://example.invalid/')
})

// Value: protects=a cancelled run ends the request; fails_when=abort leaves the request pending; why_new=signal wiring of node:http; seam=real loopback server that never answers; no_claim=none
test('rejects when the signal aborts before the server answers', async (context) => {
  // Arrange
  const { origin } = await serve(context, () => undefined)
  const controller = new AbortController()
  // Act
  const pending = fetchOwnedServer(
    `${origin}/`,
    'localhost:1',
    controller.signal,
  )
  controller.abort()
  // Assert
  await assert.rejects(pending)
})

// Value: protects=status, headers and a streamed body arrive through Response so callers' caps work; fails_when=body is not readable by reader; why_new=Response built from IncomingMessage; seam=real loopback server; no_claim=large bodies
test('streams the body and status through a standard Response', async (context) => {
  // Arrange
  const { origin } = await serve(context, (_request, response) => {
    response.statusCode = 500
    response.setHeader('x-kind', 'metro')
    response.write('hello ')
    response.end('world')
  })
  // Act
  const response = await fetchOwnedServer(
    `${origin}/`,
    'localhost:1',
    new AbortController().signal,
  )
  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  // Assert
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('x-kind'), 'metro')
  assert.equal(Buffer.concat(chunks).toString(), 'hello world')
})

// Value: protects=an answer whose status a Response cannot hold (600-999) rejects the read at once; fails_when=the RangeError is thrown inside the response listener and the promise never settles; why_new=Cycle 0089 ship review (adversarial, red team); seam=real loopback server answering 999; no_claim=statuses below 200
test('rejects at once when the server answers a status a Response cannot hold', async (context) => {
  // Arrange
  const { origin } = await serve(context, (_request, response) => {
    response.statusCode = 999
    response.end('odd')
  })
  let timer: NodeJS.Timeout | undefined
  const unsettled = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('unsettled'), 2_000)
  })
  // Act
  const outcome = await Promise.race([
    fetchOwnedServer(
      `${origin}/x`,
      'localhost:4101',
      new AbortController().signal,
    ).then(
      () => 'resolved',
      (error: unknown) => (error instanceof RangeError ? 'rejected' : 'other'),
    ),
    unsettled,
  ])
  clearTimeout(timer)
  // Assert
  assert.equal(outcome, 'rejected')
})
