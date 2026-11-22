import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test, type TestContext } from 'node:test'

import {
  DEVIN_BRIDGE_HEADER_NAME,
  DEVIN_BRIDGE_HEADER_VALUE,
  MAX_SESSIONS,
} from '../constants'
import { DEVIN_BRIDGE_NOT_SET_UP_SENTENCE } from '../devinWindowSentences'
import { startServer } from '../server'

import { createHarness } from './helpers'

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'gate-test', version: '1.0' },
  },
})
const LIST_TOOLS = JSON.stringify({
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
})

/** Starts a Codebook server whose Devin mark is the returned switch; both are closed when the test ends. */
async function startGatedServer(context: TestContext, isMarked: boolean) {
  const harness = await createHarness()
  const mark = { isOn: isMarked }
  const endpoint = await startServer(harness.service, Date.now, () => mark.isOn)
  context.after(async () => {
    await endpoint.close()
    await harness.close()
  })
  return { endpoint, mark }
}

/**
 * Posts one JSON-RPC message to the server with its bearer token.
 * @param endpoint - The started server.
 * @param body - The JSON-RPC text.
 * @param headers - Extra request headers (the session id, the Devin bridge header).
 * @returns The HTTP status and the `mcp-session-id` header the answer carried.
 */
async function post(
  endpoint: Awaited<ReturnType<typeof startServer>>,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; sessionId: string | undefined }> {
  const answer = await fetch(endpoint.descriptor.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${endpoint.descriptor.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  })
  return {
    status: answer.status,
    text: await answer.text(),
    sessionId: answer.headers.get('mcp-session-id') ?? undefined,
  }
}

const DEVIN_HEADERS = { [DEVIN_BRIDGE_HEADER_NAME]: DEVIN_BRIDGE_HEADER_VALUE }

test('a Devin bridge that connected to a marked server is refused after the mark is turned off, while a request without the header is still served', async (context) => {
  // protects=a bridge connected during a failed setup stops being served after the rollback unmarks the window (Cycle 0144 task 4); fails_when=the next request of the connected bridge is served; no_claim=other requests than the Devin bridge's
  // Arrange
  const { endpoint, mark } = await startGatedServer(context, true)
  const initialized = await post(endpoint, INITIALIZE, DEVIN_HEADERS)
  assert.equal(initialized.status, 200)
  const sessionId = initialized.sessionId ?? ''

  // Act
  mark.isOn = false
  const refused = await post(endpoint, LIST_TOOLS, {
    ...DEVIN_HEADERS,
    'mcp-session-id': sessionId,
  })
  const withoutHeader = await post(endpoint, LIST_TOOLS, {
    'mcp-session-id': sessionId,
  })

  // Assert
  assert.equal(refused.status, 403)
  assert.match(refused.text, new RegExp(DEVIN_BRIDGE_NOT_SET_UP_SENTENCE))
  assert.equal(withoutHeader.status, 200)
})

test('a Devin bridge request whose body is held open across the unmark is refused', async (context) => {
  // protects=the mark is checked after the body was read, right before dispatch; fails_when=the check runs only after authorization, so a held body is served after the unmark; no_claim=a request that is already dispatched
  // Arrange
  const { endpoint, mark } = await startGatedServer(context, true)
  const initialized = await post(endpoint, INITIALIZE, DEVIN_HEADERS)
  const sessionId = initialized.sessionId ?? ''
  const url = new URL(endpoint.descriptor.url)
  const status = new Promise<number>((resolve, reject) => {
    const held = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          authorization: `Bearer ${endpoint.descriptor.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId,
          'content-length': Buffer.byteLength(LIST_TOOLS),
          ...DEVIN_HEADERS,
        },
      },
      (answer) => {
        answer.resume()
        resolve(answer.statusCode ?? 0)
      },
    )
    held.on('error', reject)
    // The first half of the body goes out; the unmark lands; then the rest.
    held.write(LIST_TOOLS.slice(0, 10))
    setTimeout(() => {
      mark.isOn = false
      held.end(LIST_TOOLS.slice(10))
    }, 50)
  })

  // Act
  const result = await status

  // Assert
  assert.equal(result, 403)
})

test('refused Devin initializations give back the session slots they reserved', async (context) => {
  // protects=a refused initialization does not use up the server's session slots; fails_when=each refused initialize keeps its reserved slot, so later clients get 429 after MAX_SESSIONS refusals; no_claim=sessions of clients that are served
  // Arrange
  const { endpoint, mark } = await startGatedServer(context, false)

  // Act
  const refusals: number[] = []
  for (let attempt = 0; attempt <= MAX_SESSIONS; attempt += 1)
    refusals.push((await post(endpoint, INITIALIZE, DEVIN_HEADERS)).status)
  mark.isOn = true
  const afterwards = await post(endpoint, INITIALIZE, DEVIN_HEADERS)

  // Assert
  assert.deepEqual(refusals, Array(MAX_SESSIONS + 1).fill(403))
  assert.equal(afterwards.status, 200)
})

test('a request without the Devin bridge header is served while the mark is off', async (context) => {
  // protects=Cursor and every other client are served whatever the Devin mark says; fails_when=the gate refuses requests without the header; no_claim=none
  // Arrange
  const { endpoint } = await startGatedServer(context, false)

  // Act
  const initialized = await post(endpoint, INITIALIZE, {})

  // Assert
  assert.equal(initialized.status, 200)
})
