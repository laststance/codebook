import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'

import { SESSION_IDLE_TIMEOUT_MS } from '../constants'
import { runCursorMcpBridge } from '../cursorMcpBridge'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'
import { readBridgeDescriptor } from '../utils/readBridgeDescriptor'

import { createHarness } from './helpers'
import { bridgeStopMarksPreload } from './utils/bridgeStopMarksPreload'
import { handMovedInputClock } from './utils/handMovedInputClock'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

test('Cursor stdio bridge exposes the current authenticated Codebook instance without a credential in its command', async (context) => {
  // Arrange
  let now = 0
  const harness = await createHarness(),
    endpoint = await startServer(harness.service, () => now),
    directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-bridge-'))
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await removeTestFolder(directory)
  })
  const descriptorPath = join(directory, 'current.connection.json')
  await writeFile(descriptorPath, JSON.stringify(endpoint.descriptor), {
    mode: 0o600,
  })
  const arguments_ = [
    join(__dirname, '../cursorMcpBridgeEntry.js'),
    descriptorPath,
  ]
  assert.doesNotMatch(
    JSON.stringify(arguments_),
    new RegExp(endpoint.descriptor.token),
  )
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: arguments_,
    stderr: 'pipe',
  })
  const client = new Client({
    name: 'cursor-stdio-bridge-test',
    version: '1.0',
  })
  try {
    // Act
    await client.connect(transport, { timeout: 5_000 })
    const tools = await client.listTools(),
      templates = await client.listResourceTemplates()
    const result = await client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    const status = z
      .object({
        ok: z.literal(true),
        data: z.object({ instanceId: z.string(), workspace: z.string() }),
      })
      .parse(result.structuredContent).data
    now = SESSION_IDLE_TIMEOUT_MS + 1
    await endpoint.expire()
    const afterIdle = await client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    const resumed = z
      .object({
        ok: z.literal(true),
        data: z.object({ instanceId: z.string(), workspace: z.string() }),
      })
      .parse(afterIdle.structuredContent).data
    // Assert
    assert.equal(status.instanceId, endpoint.descriptor.instanceId)
    assert.equal(status.workspace, harness.directory)
    assert.deepEqual(resumed, status)
    assert.ok(tools.tools.some((tool) => tool.name === 'codebook_status'))
    assert.equal(templates.resourceTemplates.length, 22)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await client.close()
  }
})

test('closing Cursor MCP bridges releases server session slots before the next setup', async (context) => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-bridge-close-'))
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await removeTestFolder(directory)
  })
  const descriptorPath = join(directory, 'current.connection.json')
  await writeFile(descriptorPath, JSON.stringify(endpoint.descriptor), {
    mode: 0o600,
  })
  // Act / Assert
  for (let index = 0; index < 9; index += 1) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(__dirname, '../cursorMcpBridgeEntry.js'), descriptorPath],
      stderr: 'pipe',
    })
    const client = new Client({ name: 'cursor-restart-test', version: '1.0' })
    let childError = ''
    transport.stderr?.on('data', (chunk) => {
      childError += String(chunk)
    })
    try {
      await client.connect(transport, { timeout: 5_000 })
      assert.ok(
        (await client.listTools()).tools.some(
          (tool) => tool.name === 'codebook_status',
        ),
      )
    } catch (error) {
      throw new Error(
        `Bridge restart ${index + 1} failed: ${String(error)} ${childError}`,
        { cause: error },
      )
    } finally {
      await client.close()
    }
  }
})

test('a malformed private descriptor cannot leak credential fragments through Cursor bridge stderr', async (context) => {
  // Arrange
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-bridge-secret-'),
  )
  context.after(() => removeTestFolder(directory))
  const descriptorPath = join(directory, 'broken.connection.json'),
    secretMarker = 'PRIVATE_TOKEN_FRAGMENT'
  await writeFile(
    descriptorPath,
    `{"url":"http://127.0.0.1","token":${secretMarker}}`,
    { mode: 0o600 },
  )
  // Act
  const child = spawn(
    process.execPath,
    [join(__dirname, '../cursorMcpBridgeEntry.js'), descriptorPath],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const [exitCode] = await once(child, 'exit')
  // Assert
  assert.equal(exitCode, 1)
  assert.match(stderr, /Codebook Cursor MCP bridge could not connect/)
  assert.doesNotMatch(stderr, /PRIVATE_TOKEN_FRAGMENT/)
})

// Value: protects=the descriptor's bearer token staying on Codebook's own loopback /mcp endpoint in Cursor's bridge too; fails_when=the bridge connects to the url any descriptor names, so a planted descriptor receives the token; why_new=the Devin Desktop bridge shares this transport (Cycle 0143 B1); seam=a loopback listener that counts requests
// Windows reports 0o666 for every file, so the private-file check refuses before the url check this test reaches.
test(
  'Cursor stdio bridge sends no request to a descriptor url that is not the loopback /mcp endpoint',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(
      join(tmpdir(), 'codebook-cursor-bridge-url-'),
    )
    let requests = 0
    const listener = createServer((_request, response) => {
      requests += 1
      response.end()
    })
    await new Promise<void>((resolve) =>
      listener.listen(0, '127.0.0.1', resolve),
    )
    context.after(async () => {
      listener.closeAllConnections()
      await new Promise<void>((resolve) => listener.close(() => resolve()))
      await removeTestFolder(directory)
    })
    const descriptorPath = join(directory, 'planted.connection.json')
    await writeFile(
      descriptorPath,
      JSON.stringify({
        url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/other`,
        token: 'test-token',
        instanceId: '11111111-1111-4111-8111-111111111111',
        workspace: directory,
        apiVersion: '1.0',
      }),
      { mode: 0o600 },
    )
    // Act
    const outcome = runCursorMcpBridge(descriptorPath, 2_000)
    // Assert
    await assert.rejects(outcome, /not a loopback endpoint/)
    assert.equal(requests, 0)
  },
)

for (const [shape, content] of [
  ['broken JSON', '{"url":"http://127.0.0.1","token":PRIVATE_TOKEN_FRAGMENT}'],
  ['a wrong-shaped object', '{"url":5,"token":"PRIVATE_TOKEN_FRAGMENT"}'],
] as const) {
  // Value: protects=the bearer token in a descriptor never reaching an error, stderr line or message of the bridge; fails_when=the parser's own error (which quotes part of the input) is thrown instead of one fixed sentence; why_new=Node's JSON.parse and schema errors echo input (Cycle 0143 /ship pass 2 E2); seam=runCursorMcpBridge on a private descriptor file holding a token-like literal
  // Windows reports 0o666 for every file, so the private-file check refuses before the parse this test reaches.
  test(
    `a descriptor of ${shape} never puts its content into the bridge error`,
    { skip: process.platform === 'win32' },
    async (context) => {
      // Arrange
      const directory = await mkdtemp(
        join(tmpdir(), 'codebook-cursor-bridge-parse-'),
      )
      context.after(() => removeTestFolder(directory))
      const descriptorPath = join(directory, 'broken.connection.json')
      await writeFile(descriptorPath, content, { mode: 0o600 })
      // Act
      const outcome = runCursorMcpBridge(descriptorPath, 2_000)
      // Assert
      await assert.rejects(outcome, (error: Error) => {
        assert.equal(
          error.message,
          'Codebook connection descriptor could not be read.',
        )
        assert.equal(error.cause, undefined)
        assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TOKEN_FRAGMENT/)
        return true
      })
    },
  )
}

// Value: protects=the Devin bridge's startup deadline against a server that answers initialize and then holds the initialized notification; fails_when=only the initialize request is bounded (the SDK passes its timeout to initialize alone) so the connect waits past the budget, or the transport is left open when the timer fires; why_new=a half-answering server (Cycle 0143 /ship pass 2 E3); seam=a loopback listener that answers initialize, holds the notification and records when its connection closes
// Windows reports 0o666 for every file, so the private-file check refuses before the connect this test reaches.
test(
  'the bridge gives up on a server that answers initialize and holds the initialized notification, and closes its transport',
  { skip: process.platform === 'win32', timeout: 15_000 },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(
      join(tmpdir(), 'codebook-cursor-bridge-held-'),
    )
    // Methods of the held requests that reached the server, and of those whose connection closed afterwards.
    const arrivedMethods: string[] = [],
      closedMethods: string[] = []
    let markHeldRequestClosed = (): void => undefined
    const heldRequestClosed = new Promise<void>((resolve) => {
      markHeldRequestClosed = resolve
    })
    const listener = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        if (incoming.method === 'DELETE') {
          outgoing.writeHead(200)
          outgoing.end()
          return
        }
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (message.method !== 'initialize') {
          // The initialized notification is held on purpose.
          arrivedMethods.push(message.method)
          outgoing.on('close', () => {
            closedMethods.push(message.method)
            markHeldRequestClosed()
          })
          return
        }
        outgoing.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'test-session',
        })
        outgoing.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: message.params.protocolVersion,
              capabilities: {},
              serverInfo: { name: 'held', version: '1' },
            },
          }),
        )
      })
    })
    await new Promise<void>((resolve) =>
      listener.listen(0, '127.0.0.1', resolve),
    )
    context.after(async () => {
      listener.closeAllConnections()
      await new Promise<void>((resolve) => listener.close(() => resolve()))
      await removeTestFolder(directory)
    })
    const descriptorPath = join(directory, 'held.connection.json')
    await writeFile(
      descriptorPath,
      JSON.stringify({
        url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`,
        token: 'test-token',
        instanceId: '11111111-1111-4111-8111-111111111111',
        workspace: directory,
        apiVersion: '1.0',
      }),
      { mode: 0o600 },
    )
    // Act
    const outcome = runCursorMcpBridge(descriptorPath, 700)
    // Assert
    await assert.rejects(outcome, /did not finish in time/)
    // The notification reached the server, so the wait below is for a close and not for an arrival that never happened.
    assert.deepEqual(arrivedMethods, ['notifications/initialized'])
    await heldRequestClosed
    assert.deepEqual(closedMethods, ['notifications/initialized'])
  },
)

// Value: protects=the startup deadline of the descriptor check against a workspace whose file system never answers the real-path lookup; fails_when=the lookup runs after the read's timer was cleared, so the connection waits on it forever; why_new=Cycle 0143 /ship cycle 3 N1 lookup outside the deadline; seam=readBridgeDescriptor with a workspace resolver that never settles
// Windows reports 0o666 for every file, so the private-file check refuses before the lookup this test reaches.
test(
  'the descriptor check ends within its startup deadline when the workspace lookup never answers',
  { skip: process.platform === 'win32', timeout: 15_000 },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(
      join(tmpdir(), 'codebook-cursor-bridge-lookup-'),
    )
    context.after(() => removeTestFolder(directory))
    const descriptorPath = join(directory, 'lookup.connection.json')
    const instanceId = '11111111-1111-4111-8111-111111111111'
    await writeFile(
      descriptorPath,
      JSON.stringify({
        url: ['http', '://127.0.0.1:1/mcp'].join(''),
        token: 'test-token',
        instanceId,
        workspace: directory,
        apiVersion: '1.0',
        pid: process.pid,
        devinChat: true,
      }),
      { mode: 0o600 },
    )
    const resolvedPaths: string[] = []
    // Act
    const outcome = readBridgeDescriptor(
      descriptorPath,
      { instanceId, pid: process.pid, workspace: directory, devinChat: true },
      300,
      (path) => {
        resolvedPaths.push(path)
        return new Promise<string>(() => undefined)
      },
    )
    // Assert
    await assert.rejects(outcome, /did not finish in time/)
    // The resolver was reached, so a slow read alone cannot pass this test.
    assert.deepEqual(resolvedPaths, [directory])
  },
)

// protects=Cursor's bridge staying as it was when the server answers a request 403: that request fails, it is sent once, and the bridge keeps serving (Cycle 0145 task 12 gave the refusal hook to the Devin bridge only); fails_when=Cursor's bridge ends or replays a request after a 401 or 403; no_claim=the Devin bridge's check (devinMcpBridge tests)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge fails only a request the server answers 403 and sends each request once',
  { skip: process.platform === 'win32', timeout: 20_000 },
  async (context) => {
    // Arrange
    const directory = await mkdtemp(
      join(tmpdir(), 'codebook-cursor-bridge-refused-'),
    )
    let toolsListRequests = 0
    const listener = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        if (incoming.method !== 'POST') {
          outgoing.writeHead(200)
          outgoing.end()
          return
        }
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (message.method === 'initialize') {
          outgoing.writeHead(200, {
            'content-type': 'application/json',
            'mcp-session-id': 'test-session',
          })
          outgoing.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'refusing', version: '1' },
              },
            }),
          )
          return
        }
        if (message.method === 'tools/list') toolsListRequests += 1
        // The notification is accepted; every request after it is refused.
        outgoing.writeHead(message.id === undefined ? 202 : 403)
        outgoing.end()
      })
    })
    await new Promise<void>((resolve) =>
      listener.listen(0, '127.0.0.1', resolve),
    )
    context.after(async () => {
      listener.closeAllConnections()
      await new Promise<void>((resolve) => listener.close(() => resolve()))
      await removeTestFolder(directory)
    })
    const descriptorPath = join(directory, 'refused.connection.json')
    await writeFile(
      descriptorPath,
      JSON.stringify({
        url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`,
        token: 'test-token',
        instanceId: '11111111-1111-4111-8111-111111111111',
        workspace: directory,
        apiVersion: '1.0',
      }),
      { mode: 0o600 },
    )
    const client = new Client({
      name: 'cursor-stdio-bridge-test',
      version: '1.0',
    })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(__dirname, '../cursorMcpBridgeEntry.js'), descriptorPath],
      stderr: 'pipe',
    })
    try {
      await client.connect(transport, { timeout: 5_000 })
      // Act
      const first = await client.listTools().then(
        () => 'answered',
        () => 'failed',
      )
      const receivedAfterFirst = toolsListRequests
      const second = await client.listTools().then(
        () => 'answered',
        () => 'failed',
      )
      // Assert
      assert.equal(first, 'failed')
      assert.equal(second, 'failed')
      // Each request reached the server once, so the bridge did not end and did not replay.
      assert.equal(receivedAfterFirst, 1)
      assert.equal(toolsListRequests, 2)
    } finally {
      await client.close()
    }
  },
)

/** One request {@link startScriptedEndpoint} received, read whole. */
interface ScriptedRequest {
  httpMethod: string
  /** The `mcp-session-id` header; none on an initialize. */
  sessionId: string | undefined
  /** The JSON-RPC method of a POST; none for a DELETE or a GET. */
  method: string | undefined
  /** The response, for a test that answers or holds the request itself. */
  outgoing: ServerResponse
  /** True once the bridge closed this request's connection before it was answered. */
  isClientGone: () => boolean
  /** Answers the request the way the endpoint answers a request it is not told to take over, for a test that held it first. */
  answerAsUsual: () => void
}

/** A loopback endpoint {@link startScriptedEndpoint} started. */
interface ScriptedEndpoint {
  descriptorPath: string
  /** Every request received so far, in arrival order. */
  received: ScriptedRequest[]
  /** Registers a step the endpoint's cleanup awaits, in registration order, before it closes its connections and removes its folder: a bridge child is ended there, before the folder holding its preload and its descriptor goes. */
  beforeClose: (step: () => Promise<void>) => void
}

/** Answers a request 404 with the sentence Codebook's server gives a session it no longer knows. */
function answerUnknownSession(outgoing: ServerResponse): void {
  outgoing.writeHead(404, { 'content-type': 'application/json' })
  outgoing.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unknown MCP session' },
      id: null,
    }),
  )
}

/** The JSON-RPC fields {@link startScriptedEndpoint} reads from a request body. */
const scriptedMessageSchema = z.looseObject({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.looseObject({ protocolVersion: z.string().optional() }).optional(),
})

/**
 * Answers one request the way {@link startScriptedEndpoint} answers every request no test takes over: a GET 405 (no standalone notification stream, as Codebook's server answers), a notification 202, a DELETE 200, an initialize with `session-<sessionNumber>` and `tools/list` with no tools.
 * @param outgoing - The response.
 * @param httpMethod - The request's HTTP method.
 * @param message - The request's JSON-RPC body; none for a DELETE or a GET.
 * @param sessionNumber - The count of initializes received up to this request, which names the session an initialize opens.
 */
function answerAsScripted(
  outgoing: ServerResponse,
  httpMethod: string,
  message: z.infer<typeof scriptedMessageSchema> | undefined,
  sessionNumber: number,
): void {
  if (httpMethod === 'GET') {
    outgoing.writeHead(405, { allow: 'POST, DELETE' })
    outgoing.end()
    return
  }
  // A DELETE and a notification carry no id: neither gets a JSON-RPC answer.
  if (httpMethod === 'DELETE' || message?.id === undefined) {
    outgoing.writeHead(httpMethod === 'DELETE' ? 200 : 202)
    outgoing.end()
    return
  }
  const isInitialize = message.method === 'initialize'
  outgoing.writeHead(200, {
    'content-type': 'application/json',
    ...(isInitialize && { 'mcp-session-id': `session-${sessionNumber}` }),
  })
  outgoing.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: isInitialize
        ? {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'scripted', version: '1' },
          }
        : { tools: [] },
    }),
  )
}

/**
 * Starts a loopback MCP endpoint for Cursor's bridge that answers like Codebook's server unless the test takes a request over, and writes the private descriptor naming it; the arrange step of the stop-path tests.
 * Sessions are named `session-1`, `session-2`, … in initialize order; every request the test does not take over is answered by {@link answerAsScripted}.
 * @param context - The test context; its cleanup runs the steps registered with `beforeClose`, then closes the endpoint with its connections and removes the folder.
 * @param takeOver - Called with every request after it was recorded; returns `true` when the test answers or holds the request itself.
 * @returns The endpoint's descriptor path, its received requests and its `beforeClose` ({@link ScriptedEndpoint}).
 */
async function startScriptedEndpoint(
  context: { after: (callback: () => Promise<void>) => void },
  takeOver: (request: ScriptedRequest) => boolean,
): Promise<ScriptedEndpoint> {
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-bridge-stop-'),
  )
  const received: ScriptedRequest[] = [],
    stepsBeforeClose: Array<() => Promise<void>> = []
  let initializes = 0
  const listener = createServer((incoming, outgoing) => {
    let isGone = false
    outgoing.once('close', () => {
      isGone = !outgoing.writableFinished
    })
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const message =
        body === '' ? undefined : scriptedMessageSchema.parse(JSON.parse(body))
      if (message?.method === 'initialize') initializes += 1
      const sessionNumber = initializes,
        httpMethod = incoming.method ?? '',
        sessionHeader = incoming.headers['mcp-session-id']
      const request: ScriptedRequest = {
        httpMethod,
        sessionId:
          typeof sessionHeader === 'string' ? sessionHeader : undefined,
        method: message?.method,
        outgoing,
        isClientGone: () => isGone,
        answerAsUsual: () =>
          answerAsScripted(outgoing, httpMethod, message, sessionNumber),
      }
      received.push(request)
      if (!takeOver(request)) request.answerAsUsual()
    })
  })
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  // One hook, so the order is explicit: node:test runs after-hooks in registration order, and a bridge child registered later must end before this folder goes.
  context.after(async () => {
    for (const step of stepsBeforeClose) await step()
    listener.closeAllConnections()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await removeTestFolder(directory)
  })
  const descriptorPath = join(directory, 'scripted.connection.json')
  await writeFile(
    descriptorPath,
    JSON.stringify({
      url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`,
      token: 'test-token',
      instanceId: '11111111-1111-4111-8111-111111111111',
      workspace: directory,
      apiVersion: '1.0',
    }),
    { mode: 0o600 },
  )
  return {
    descriptorPath,
    received,
    beforeClose: (step): void => {
      stepsBeforeClose.push(step)
    },
  }
}

/** Cursor's request 0 of a handshake, as Cursor sends it first. */
const CURSOR_INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'cursor-bridge-stop-test', version: '1.0' },
  },
}

/** One JSON-RPC message the bridge wrote to stdout: an answer carries `result` or `error`. */
const bridgeMessageSchema = z.looseObject({
  id: z.number().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
})

/** Cursor's bridge entry running as a child process, as {@link startCursorBridgeChild} starts it. */
interface CursorBridgeChild {
  /** Resolves with the exit code once the process ended and its output was read to the end; `null` when a signal ended it. */
  exited: Promise<number | null>
  readStderr: () => string
  /** The JSON-RPC messages the bridge wrote to stdout so far. */
  readMessages: () => Array<z.infer<typeof bridgeMessageSchema>>
  /** Sends Cursor's request 0 `initialize` alone, without waiting for its answer. */
  sendInitialize: () => void
  /** Writes `text` to the bridge's stdin as it is, so a test can split a message across writes. */
  write: (text: string) => void
  /** Does the MCP handshake a client makes (request 0 `initialize`, then `initialized`), once the bridge answered request 0. */
  handshake: () => Promise<void>
  /** Asks `tools/list` as request `id`. */
  askToolsList: (id: number) => void
  /** Closes the bridge's stdin, the way Cursor ends a bridge. */
  closeStdin: () => void
  signal: (name: NodeJS.Signals) => void
}

/**
 * Starts Cursor's bridge entry on the endpoint's descriptor as Cursor does, with a preload; the environment is inherited, so a coverage run measures the child too.
 * @param endpoint - The scripted endpoint the bridge connects to; its cleanup ends a process that is still running before it closes.
 * @param preloadSource - Source of a preload run in the bridge process.
 * @returns The running bridge with the controls of {@link CursorBridgeChild}.
 */
async function startCursorBridgeChild(
  endpoint: ScriptedEndpoint,
  preloadSource: string,
): Promise<CursorBridgeChild> {
  const preloadPath = join(dirname(endpoint.descriptorPath), 'preload.js')
  await writeFile(preloadPath, preloadSource)
  const child = spawn(
    process.execPath,
    [
      '--require',
      preloadPath,
      join(__dirname, '../cursorMcpBridgeEntry.js'),
      endpoint.descriptorPath,
    ],
    {
      // A process that is still alive here is the failure; it is ended so the test does not hang.
      timeout: 25_000,
      killSignal: 'SIGKILL',
    },
  )
  // Run by the endpoint's cleanup before it closes and removes the folder that holds the preload and the descriptor.
  endpoint.beforeClose(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const ended = new Promise((done) => child.once('exit', done))
    child.kill('SIGKILL')
    await ended
  })
  let stderr = '',
    stdout = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  const exited = new Promise<number | null>((done) => {
    // Waits for close, not exit: stderr's last chunk can arrive after exit.
    child.on('close', (code) => done(code))
  })
  const send = (message: object): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }
  const readMessages = (): Array<z.infer<typeof bridgeMessageSchema>> =>
    stdout
      // Only lines that ended with a newline are whole messages.
      .split('\n')
      .slice(0, -1)
      .filter((line) => line.startsWith('{'))
      .map((line) => bridgeMessageSchema.parse(JSON.parse(line)))
  return {
    exited,
    readStderr: () => stderr,
    readMessages,
    sendInitialize: (): void => send(CURSOR_INITIALIZE_REQUEST),
    write: (text): void => {
      child.stdin.write(text)
    },
    handshake: async (): Promise<void> => {
      send(CURSOR_INITIALIZE_REQUEST)
      await waitUntil(
        () => readMessages().find((message) => message.id === 0),
        "the bridge's answer to initialize",
        10_000,
        undefined,
        10,
      )
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    },
    askToolsList: (id): void => {
      send({ jsonrpc: '2.0', id, method: 'tools/list', params: {} })
    },
    closeStdin: (): void => {
      child.stdin.end()
    },
    signal: (name): void => {
      child.kill(name)
    },
  }
}

/** The requests of `method` (a JSON-RPC method, or `DELETE`) the endpoint received for `sessionId`, or for every session when it is left out. */
function requestsOf(
  received: ScriptedRequest[],
  method: string,
  sessionId?: string,
): ScriptedRequest[] {
  return received.filter(
    (request) =>
      (request.method === method || request.httpMethod === method) &&
      (sessionId === undefined || request.sessionId === sessionId),
  )
}

// Value: protects=no replay reaching Cursor's server after Cursor ended the bridge, for requests that got 404 while the bridge released the session it replaced (Cycle 0146 task 7); fails_when=a request that waited for the reconnect is sent again on the new session after stdin closed; no_claim=a replay before the stop (still sent), the Devin bridge's refusal check (devinMcpBridge tests)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge replays nothing on its new session for requests that got 404 while it released the old session, once stdin closed',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    const heldToolsLists: ScriptedRequest[] = []
    let heldRelease: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.sessionId !== 'session-1') return false
      if (request.method === 'tools/list') heldToolsLists.push(request)
      else if (request.httpMethod === 'DELETE') heldRelease = request
      else return false
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    await bridge.handshake()
    bridge.askToolsList(1)
    bridge.askToolsList(2)
    await waitUntil(
      () => heldToolsLists.length === 2,
      'both requests held on session-1',
      10_000,
      undefined,
      5,
    )
    // Act
    // The first 404 opens session-2; its reconnect then waits at the release of session-1.
    answerUnknownSession(heldToolsLists[0]!.outgoing)
    const release = await waitUntil(
      () => heldRelease,
      'the release of session-1',
      10_000,
      undefined,
      5,
    )
    // The second 404 arrives while session-1 is released, so its request waits for the reconnect.
    answerUnknownSession(heldToolsLists[1]!.outgoing)
    await waitUntil(
      () => bridge.readStderr().includes('UNKNOWN_SESSION_REJECTED 2\n'),
      'the second request waiting for the reconnect',
      10_000,
      undefined,
      5,
    )
    bridge.closeStdin()
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_END_SEEN\n'),
      'the bridge seeing the end of its input',
      10_000,
      undefined,
      5,
    )
    const wasReleasePending = !release.isClientGone()
    release.outgoing.writeHead(200)
    release.outgoing.end()
    const exitCode = await within(bridge.exited, 10_000)
    // Assert
    // The endpoint had not seen the bridge drop the release of the old session when the bridge saw the end of its input; the flag says nothing more about where the two requests were waiting.
    assert.equal(wasReleasePending, true)
    assert.equal(exitCode, 0)
    assert.equal(
      requestsOf(endpoint.received, 'tools/list', 'session-2').length,
      0,
    )
    assert.equal(requestsOf(endpoint.received, 'initialize').length, 2)
  },
)

for (const stop of ['stdin closes', 'it gets SIGTERM'] as const) {
  // Value: protects=a prompt end of Cursor's bridge once Cursor ended it, also while a replacement session's initialize is unanswered (Cycle 0146 task 7); fails_when=the stop waits for the replacement handshake (Cursor's bridge gives it no budget, so the SDK's own 60 s initialize timeout holds the end); no_claim=the release of a replacement session the server named (the tests below)
  // Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
  test(
    `Cursor stdio bridge ends within 5 seconds when ${stop} while its replacement initialize is unanswered`,
    { skip: process.platform === 'win32', timeout: 30_000 },
    async (context) => {
      // Arrange
      let isInitializeHeld = false,
        initializes = 0
      const endpoint = await startScriptedEndpoint(context, (request) => {
        if (request.method === 'tools/list') {
          answerUnknownSession(request.outgoing)
          return true
        }
        if (request.method !== 'initialize') return false
        initializes += 1
        // The replacement's initialize is never answered.
        isInitializeHeld = initializes === 2
        return isInitializeHeld
      })
      const bridge = await startCursorBridgeChild(
        endpoint,
        bridgeStopMarksPreload(),
      )
      await bridge.handshake()
      bridge.askToolsList(1)
      await waitUntil(
        () => isInitializeHeld,
        'the replacement initialize held',
        10_000,
        undefined,
        5,
      )
      // Act
      if (stop === 'stdin closes') bridge.closeStdin()
      else bridge.signal('SIGTERM')
      const exitCode = await within(bridge.exited, 5_000)
      // Assert
      assert.equal(exitCode, 0)
      assert.equal(
        requestsOf(endpoint.received, 'DELETE', 'session-1').length,
        1,
      )
    },
  )
}

// Value: protects=Cursor's bridge ending promptly and releasing the replacement session the server already named, when stdin closes while the server holds its initialized notification (Cycle 0146 task 7); fails_when=the stop waits for the notification, which has no timeout in Cursor's bridge, or leaves the replacement session open; no_claim=a notification the server fails (the in-process test below)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge releases its replacement session and ends within 5 seconds when stdin closes while the initialized notification is unanswered',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldNotification: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (
        request.method === 'tools/list' &&
        request.sessionId === 'session-1'
      ) {
        answerUnknownSession(request.outgoing)
        return true
      }
      if (
        request.method !== 'notifications/initialized' ||
        request.sessionId !== 'session-2'
      )
        return false
      // Held through the bridge's exit: never answered.
      heldNotification = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    await bridge.handshake()
    bridge.askToolsList(1)
    const notification = await waitUntil(
      () => heldNotification,
      'the initialized notification of session-2 held',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 5_000)
    // The child's exit does not wait for the endpoint to see that connection close, so that is observed on its own, within a bound.
    const isNotificationGone = await waitUntil(
      () => notification.isClientGone(),
      'the endpoint seeing the held notification closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(isNotificationGone, true)
    assert.deepEqual(
      requestsOf(endpoint.received, 'DELETE')
        .map((request) => request.sessionId)
        .sort(),
      ['session-1', 'session-2'],
    )
  },
)

// Value: protects=the session an initialize opened being released when the server fails the initialized notification after it (Cycle 0146 task 7, Codex review of v2 F3); fails_when=the release goes through the handshake's own transport, which the SDK aborted when the handshake failed, so the DELETE is never sent and the session stays until it expires; no_claim=a stop during the handshake (the child-process tests around this one)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'a bridge whose server fails the initialized notification still releases the session that initialize opened',
  { skip: process.platform === 'win32', timeout: 15_000 },
  async (context) => {
    // Arrange
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'notifications/initialized') return false
      request.outgoing.writeHead(500)
      request.outgoing.end()
      return true
    })
    // Act
    const outcome = runCursorMcpBridge(endpoint.descriptorPath, 2_000)
    // Assert
    await assert.rejects(outcome, /Error POSTing to endpoint/)
    assert.deepEqual(
      requestsOf(endpoint.received, 'DELETE').map(
        (request) => request.sessionId,
      ),
      ['session-1'],
    )
  },
)

// Value: protects=no initialized notification reaching Cursor's server after Cursor ended the bridge, for a replacement session whose initialize answer was still arriving, because the cut handshake's connection closes before its session's release completes (Cycle 0146 task 7, Codex review of v3; Cycle 0146 review round, CodeRabbit cursorMcpBridge.test.ts:1003-1023); fails_when=the cut handshake's client stays open while its session is released (the initialize connection is still open while the endpoint holds the DELETE), so an answer that finishes meanwhile lets the SDK send the notification after the stop; no_claim=an initialize the server never answered (no session to release, the tests above), an answer whose body arrived before the stop
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge sends no initialized notification for a replacement session whose initialize answer was still arriving when stdin closed, and releases that session',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldInitialize: ScriptedRequest | undefined,
      heldRelease: ScriptedRequest | undefined,
      initializes = 0
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (
        request.method === 'tools/list' &&
        request.sessionId === 'session-1'
      ) {
        answerUnknownSession(request.outgoing)
        return true
      }
      if (
        request.httpMethod === 'DELETE' &&
        request.sessionId === 'session-2'
      ) {
        // The release is held until the test has seen the initialize connection close.
        heldRelease = request
        return true
      }
      if (request.method !== 'initialize') return false
      initializes += 1
      if (initializes !== 2) return false
      // The headers name session-2 at once; the body waits.
      request.outgoing.writeHead(200, {
        'content-type': 'application/json',
        'mcp-session-id': 'session-2',
      })
      request.outgoing.flushHeaders()
      heldInitialize = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    await bridge.handshake()
    bridge.askToolsList(1)
    const initialize = await waitUntil(
      () =>
        bridge.readStderr().includes('SESSION_ASSIGNED session-2\n')
          ? heldInitialize
          : undefined,
      'the bridge holding the headers of the second initialize answer',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_END_SEEN\n'),
      'the bridge seeing the end of its input',
      10_000,
      undefined,
      5,
    )
    const release = await waitUntil(
      () => heldRelease,
      'the release of session-2',
      5_000,
      undefined,
      5,
    )
    // The bridge gives a held release up after its own bound; the initialize connection must close before that, while the bridge still waits for the release, so its answer can never finish into an initialized notification.
    await waitUntil(
      () => initialize.isClientGone() || release.isClientGone(),
      'the initialize connection closing, or the bridge giving the release of session-2 up',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    const wasInitializeGoneWhileReleaseHeld =
      initialize.isClientGone() && !release.isClientGone()
    release.outgoing.writeHead(200)
    release.outgoing.end()
    const exitCode = await within(bridge.exited, 5_000)
    // Assert
    assert.equal(wasInitializeGoneWhileReleaseHeld, true)
    assert.equal(exitCode, 0)
    assert.equal(
      requestsOf(endpoint.received, 'notifications/initialized', 'session-2')
        .length,
      0,
    )
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-2').length, 1)
  },
)

// Value: protects=nothing reaching Cursor's server for a request that arrives after the bridge got SIGTERM, while it still releases its session (Cycle 0146 task 7, Codex review of v3); fails_when=only a replay is guarded, so a fresh request is forwarded on the session being released; no_claim=a request that arrived before the signal (still forwarded)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge sends no request upstream that arrives after SIGTERM while it releases its session',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldRelease: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.httpMethod !== 'DELETE') return false
      heldRelease = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    await bridge.handshake()
    // Act
    bridge.signal('SIGTERM')
    const release = await waitUntil(
      () => heldRelease,
      'the release of session-1',
      10_000,
      undefined,
      5,
    )
    bridge.askToolsList(1)
    const answer = await waitUntil(
      () => bridge.readMessages().find((message) => message.id === 1),
      'the answer to the request sent after the signal',
      5_000,
      undefined,
      5,
    )
    release.outgoing.writeHead(200)
    release.outgoing.end()
    const exitCode = await within(bridge.exited, 5_000)
    // Assert
    assert.equal('error' in answer, true)
    assert.equal(requestsOf(endpoint.received, 'tools/list').length, 0)
    assert.equal(exitCode, 0)
  },
)

/** Source of a preload that marks every SIGTERM the bridge process gets (`SIGTERM_SEEN <n>`) and keeps the default action for a process without a SIGTERM handler of its own: it then removes itself and sends the signal again, so the process ends by the signal. Appended to {@link bridgeStopMarksPreload}. */
const SIGTERM_MARKS_PRELOAD = `let sigtermsSeen = 0
process.on('SIGTERM', function markSigterm() {
  sigtermsSeen += 1
  require('node:fs').writeSync(2, 'SIGTERM_SEEN ' + sigtermsSeen + '\\n')
  // Another listener is the bridge's own handler; without one the signal gets its default action.
  if (process.listenerCount('SIGTERM') > 1) return
  process.off('SIGTERM', markSigterm)
  process.kill(process.pid, 'SIGTERM')
})
`

/** Source of a preload that, on SIGUSR2, destroys the bridge's stdin with a read error and no end, as a broken pipe can, and marks `STDIN_ERROR_SENT`. Appended to {@link bridgeStopMarksPreload}. */
const STDIN_ERROR_PRELOAD = `process.on('SIGUSR2', () => {
  process.stdin.destroy(Object.assign(new Error('read EIO'), { code: 'EIO' }))
  require('node:fs').writeSync(2, 'STDIN_ERROR_SENT\\n')
})
`

/** Ends a bridge child the way a stop-path test names the stop. */
function stopBridgeChild(
  bridge: CursorBridgeChild,
  stop: 'stdin closes' | 'it gets SIGTERM' | 'it gets SIGINT',
): void {
  if (stop === 'stdin closes') bridge.closeStdin()
  else bridge.signal(stop === 'it gets SIGTERM' ? 'SIGTERM' : 'SIGINT')
}

for (const stop of [
  'stdin closes',
  'it gets SIGTERM',
  'it gets SIGINT',
] as const) {
  // Value: protects=a prompt end of Cursor's bridge, with a DELETE for the session its first initialize named, when Cursor ends it during the first handshake while the server holds the initialized notification (Cycle 0146 /ship pass 1, outside-voice 9); fails_when=the stop listeners start only after the first handshake, so the bridge waits for a notification Cursor's bridge gives no deadline, or a signal ends the process by default before it releases the session; no_claim=that the server reclaims the session (the release is a best-effort DELETE for the id the bridge knows), a stop once the bridge serves (the tests above)
  // Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
  test(
    `Cursor stdio bridge releases the session its first initialize opened and ends within 5 seconds when ${stop} while the server holds its first initialized notification`,
    { skip: process.platform === 'win32', timeout: 30_000 },
    async (context) => {
      // Arrange
      let heldNotification: ScriptedRequest | undefined
      const endpoint = await startScriptedEndpoint(context, (request) => {
        if (request.method !== 'notifications/initialized') return false
        // Held through the bridge's exit: never answered.
        heldNotification = request
        return true
      })
      const bridge = await startCursorBridgeChild(
        endpoint,
        bridgeStopMarksPreload(),
      )
      bridge.sendInitialize()
      const notification = await waitUntil(
        () => heldNotification,
        'the first initialized notification held',
        10_000,
        undefined,
        5,
      )
      // Act
      stopBridgeChild(bridge, stop)
      const exitCode = await within(bridge.exited, 5_000)
      // The child's exit does not wait for the endpoint to see that connection close, so that is observed on its own, within a bound.
      const isNotificationGone = await waitUntil(
        () => notification.isClientGone(),
        'the endpoint seeing the held notification closed',
        5_000,
        undefined,
        5,
      ).catch(() => false)
      // Assert
      assert.equal(exitCode, 0)
      assert.equal(isNotificationGone, true)
      assert.equal(
        requestsOf(endpoint.received, 'DELETE', 'session-1').length,
        1,
      )
      assert.equal(bridge.readStderr().includes('could not connect'), false)
    },
  )
}

// Value: protects=Cursor's bridge ending as a stop, with one bounded DELETE attempted for the session id it knows, when Cursor closes it after writing past the startup input limit during the first handshake (Cycle 0147 task 8); fails_when=the end that came past the limit is never seen (stdin is paused with unread input, so Node emits no end) and the bridge waits for undici's 300 s, then exits 1 with could-not-connect; no_claim=that the server reclaims the session, the wait's exact length, a client still connected (the Devin bridge test and the hold's unit tests)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge whose stdin closes after more than 1 MiB of input during its first handshake ends with exit code 0 and asks the server to end the session it named',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldNotification: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'notifications/initialized') return false
      // Held through the bridge's exit: never answered.
      heldNotification = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    bridge.sendInitialize()
    const notification = await waitUntil(
      () => heldNotification,
      'the first initialized notification held',
      10_000,
      undefined,
      5,
    )
    bridge.write('x'.repeat(1_048_576))
    // The first pause of stdin is the hold's at the startup input limit: nothing pauses it before.
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge stopping its read at the startup input limit',
      10_000,
      undefined,
      5,
    )
    // Stays unread on any OS, so the end below comes past the limit.
    bridge.write('y')
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 15_000)
    // The child's exit does not wait for the endpoint to see that connection close, so that is observed on its own, within a bound.
    const isNotificationGone = await waitUntil(
      () => notification.isClientGone(),
      'the endpoint seeing the held notification closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(isNotificationGone, true)
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-1').length, 1)
    assert.equal(bridge.readStderr().includes('could not connect'), false)
  },
)

// Value: protects=a first handshake that really failed before the wait at the startup input limit ended keeping Cursor's diagnostic and exit code 1 when that wait's end comes while its session is still being released, and the process ending with Cursor's stdin still open (Cycle 0147 task 8, Codex review F8.1 and D14); fails_when=the wait stays armed through the release and turns the failure into a silent stop with exit code 0, or stdin, which Node reads on into its buffer after a pause at the limit, keeps the failed bridge alive until Cursor closes it; no_claim=a failure after the wait ended (the hold's unit tests), the real clock's timing (the child's input clock is moved by hand)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge still says it could not connect, with exit code 1, when its server fails the first handshake before the wait at its startup input limit ends and that wait ends while the session is being released',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldNotification: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      // Every release is held, never answered: the bridge's own 1 s bound ends it.
      if (request.httpMethod === 'DELETE') return true
      if (request.method !== 'notifications/initialized') return false
      heldNotification = request
      return true
    })
    const inputClock = await handMovedInputClock(context)
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload() + inputClock.preloadSource,
    )
    bridge.sendInitialize()
    const notification = await waitUntil(
      () => heldNotification,
      'the first initialized notification held',
      10_000,
      undefined,
      5,
    )
    bridge.write('x'.repeat(1_048_576))
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge stopping its read at the startup input limit',
      10_000,
      undefined,
      5,
    )
    // Act
    notification.outgoing.writeHead(500)
    notification.outgoing.end()
    await waitUntil(
      () => requestsOf(endpoint.received, 'DELETE', 'session-1').length === 1,
      'the release of session-1 held',
      10_000,
      undefined,
      5,
    )
    // The wait at the limit ends while that release is still held.
    await inputClock.advance(bridge, 12_000)
    const exitCode = await within(bridge.exited, 10_000)
    // Assert
    const stderr = bridge.readStderr()
    assert.equal(exitCode, 1)
    assert.equal(
      stderr.includes(
        'Codebook Cursor MCP bridge could not connect. Run Codebook: Set Up AI Chat in this Cursor window.\n',
      ),
      true,
    )
    // The child marked the clock's advance before it gave the connection up, so the wait's end came during the release, not after it.
    assert.equal(
      stderr.indexOf('INPUT_CLOCK_ADVANCED 1\n') <
        stderr.indexOf('Codebook Cursor MCP bridge could not connect.'),
      true,
    )
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-1').length, 1)
  },
)

// Value: protects=Cursor's bridge ending as a stop with exit code 0, its first session released, when its first handshake is still not up 5 s after its stdin reached the startup input limit while Cursor is still connected (Cycle 0147 task 8, acceptance criterion 10); fails_when=the bridge waits for an end of stdin it cannot see, or it releases the session but stdin, which Node reads on into its buffer after a pause at the limit, keeps the process alive until Cursor closes it; no_claim=the real clock's timing (the child's input clock is moved by hand; the stdin-close test above runs on the real clock)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge whose first handshake is still not up 5 seconds after its stdin reached the startup input limit ends with exit code 0 and asks the server to end the session it named, while Cursor is still connected',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldNotification: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'notifications/initialized') return false
      // Held through the bridge's exit: never answered.
      heldNotification = request
      return true
    })
    const inputClock = await handMovedInputClock(context)
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload() + inputClock.preloadSource,
    )
    bridge.sendInitialize()
    const notification = await waitUntil(
      () => heldNotification,
      'the first initialized notification held',
      10_000,
      undefined,
      5,
    )
    bridge.write('x'.repeat(1_048_576))
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_PAUSED\n'),
      'the bridge stopping its read at the startup input limit',
      10_000,
      undefined,
      5,
    )
    // Act
    await inputClock.advance(bridge, 5_000)
    const exitCode = await within(bridge.exited, 5_000)
    // The child's exit does not wait for the endpoint to see that connection close, so that is observed on its own, within a bound.
    const isNotificationGone = await waitUntil(
      () => notification.isClientGone(),
      'the endpoint seeing the held notification closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(isNotificationGone, true)
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-1').length, 1)
    assert.equal(bridge.readStderr().includes('could not connect'), false)
  },
)

// Value: protects=a prompt end of Cursor's bridge, without an initialized notification, when Cursor closes it while the server has not answered its first initialize at all (Cycle 0146 /ship pass 1, outside-voice 9); fails_when=the bridge waits for the SDK's 60 s initialize timeout, then prints that it could not connect; no_claim=a session the server may have opened for that initialize (no answer named one, so the bridge has no id to release; the server closes idle sessions itself)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge ends within 5 seconds and sends no initialized notification when stdin closes while its first initialize is unanswered',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldInitialize: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'initialize') return false
      // Held through the bridge's exit: never answered.
      heldInitialize = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    bridge.sendInitialize()
    const initialize = await waitUntil(
      () => heldInitialize,
      'the first initialize held',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 5_000)
    const isInitializeGone = await waitUntil(
      () => initialize.isClientGone(),
      'the endpoint seeing the held initialize closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(isInitializeGone, true)
    assert.equal(requestsOf(endpoint.received, 'DELETE').length, 0)
    assert.equal(
      requestsOf(endpoint.received, 'notifications/initialized').length,
      0,
    )
  },
)

// Value: protects=the session the server named for the bridge's first initialize being released, with no initialized notification, when Cursor closes the bridge while that answer's body is still arriving (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=the stop waits for the answer (the SDK's 60 s), the cut handshake's connection stays open so the answer can finish into a notification, or the id the headers named gets no DELETE; no_claim=an answer whose body arrived before the stop (the held-notification tests above)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge releases the session its first initialize named and sends no initialized notification when stdin closes while that answer is still arriving',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldInitialize: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'initialize') return false
      // The headers name session-1 at once; the body waits.
      request.outgoing.writeHead(200, {
        'content-type': 'application/json',
        'mcp-session-id': 'session-1',
      })
      request.outgoing.flushHeaders()
      heldInitialize = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    bridge.sendInitialize()
    const initialize = await waitUntil(
      () =>
        bridge.readStderr().includes('SESSION_ASSIGNED session-1\n')
          ? heldInitialize
          : undefined,
      'the bridge holding the headers of its first initialize answer',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 5_000)
    const isInitializeGone = await waitUntil(
      () => initialize.isClientGone(),
      'the endpoint seeing the initialize connection closed',
      5_000,
      undefined,
      5,
    ).catch(() => false)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(isInitializeGone, true)
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-1').length, 1)
    assert.equal(
      requestsOf(endpoint.received, 'notifications/initialized').length,
      0,
    )
  },
)

// Value: protects=Cursor's bridge ending as a stop, with its first session released, when its stdin fails with an error and no end during the first handshake (Cycle 0146 /ship pass 1, Codex review of the FB design, Q4); fails_when=the stdin error has no listener and crashes the process (exit 1, the error on stderr), or the bridge keeps waiting for the handshake; no_claim=a stdin error while the bridge serves (the SDK's transport reports it, as before)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge releases its first session and ends with exit code 0 when its stdin fails without an end during the first handshake',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldNotification: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'notifications/initialized') return false
      heldNotification = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload() + STDIN_ERROR_PRELOAD,
    )
    bridge.sendInitialize()
    await waitUntil(
      () => heldNotification,
      'the first initialized notification held',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.signal('SIGUSR2')
    const exitCode = await within(bridge.exited, 5_000)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(bridge.readStderr().includes('STDIN_ERROR_SENT\n'), true)
    assert.equal(bridge.readStderr().includes('read EIO'), false)
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-1').length, 1)
  },
)

// Value: protects=the release Cursor's bridge started for its first session finishing, and the bridge ending with exit code 0, when a second SIGTERM comes while that release is unanswered (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=a signal ends the process by default before the release completes: the first one because no handler watches the first handshake, or the second one because the handler went after the first (process.once); no_claim=a second signal while the bridge serves (handled once, as before)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge still releases its first session once and ends with exit code 0 when a second SIGTERM comes during that release',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldNotification: ScriptedRequest | undefined,
      heldRelease: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method === 'notifications/initialized')
        heldNotification = request
      else if (request.httpMethod === 'DELETE') heldRelease = request
      else return false
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload() + SIGTERM_MARKS_PRELOAD,
    )
    bridge.sendInitialize()
    await waitUntil(
      () => heldNotification,
      'the first initialized notification held',
      10_000,
      undefined,
      5,
    )
    // Act
    bridge.signal('SIGTERM')
    const release = await waitUntil(
      () => heldRelease,
      'the release of session-1',
      5_000,
      undefined,
      5,
    )
    bridge.signal('SIGTERM')
    await waitUntil(
      () => bridge.readStderr().includes('SIGTERM_SEEN 2\n'),
      'the bridge process seeing the second SIGTERM',
      5_000,
      undefined,
      5,
    )
    release.outgoing.writeHead(200)
    release.outgoing.end()
    const exitCode = await within(bridge.exited, 5_000)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(requestsOf(endpoint.received, 'DELETE', 'session-1').length, 1)
  },
)

// Value: protects=every message Cursor sent while the bridge's first upstream initialize was unanswered reaching the bridge's MCP server once and in order, a message split across two reads included (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=the input the bridge reads during its first handshake (to see its end) is lost, duplicated or reordered on its way to the stdio transport, or an answer is an error; no_claim=the Devin bridge's retry after a busy answer (devinMcpBridge tests), the order of the initialize answer among the pings (each handler answers when it finishes)
// Windows reports 0o666 for every file, so the private-file check refuses before the connection this test reaches.
test(
  'Cursor stdio bridge answers once each, in order, the messages Cursor sent while its first upstream initialize was unanswered',
  { skip: process.platform === 'win32', timeout: 30_000 },
  async (context) => {
    // Arrange
    let heldInitialize: ScriptedRequest | undefined
    const endpoint = await startScriptedEndpoint(context, (request) => {
      if (request.method !== 'initialize') return false
      heldInitialize = request
      return true
    })
    const bridge = await startCursorBridgeChild(
      endpoint,
      bridgeStopMarksPreload(),
    )
    const initialize = await waitUntil(
      () => heldInitialize,
      'the first upstream initialize held',
      10_000,
      undefined,
      5,
    )
    const input = [
      CURSOR_INITIALIZE_REQUEST,
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
      { jsonrpc: '2.0', id: 3, method: 'ping' },
    ]
      .map((message) => `${JSON.stringify(message)}\n`)
      .join('')
    // The second ping is split across the two writes, and each write is read before the next one.
    const splitAt = input.indexOf('"id":2') + 3
    bridge.write(input.slice(0, splitAt))
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_DATA_READ 1\n'),
      'the bridge reading the first part of the input',
      10_000,
      undefined,
      5,
    )
    bridge.write(input.slice(splitAt))
    await waitUntil(
      () => bridge.readStderr().includes('STDIN_DATA_READ 2\n'),
      'the bridge reading the second part of the input',
      10_000,
      undefined,
      5,
    )
    // Act
    initialize.answerAsUsual()
    await waitUntil(
      () => bridge.readMessages().length >= 4,
      'the answers to the four requests',
      10_000,
      undefined,
      5,
    )
    bridge.closeStdin()
    const exitCode = await within(bridge.exited, 5_000)
    // Assert
    const answers = bridge.readMessages()
    assert.equal(exitCode, 0)
    assert.deepEqual(answers.map((answer) => answer.id).sort(), [0, 1, 2, 3])
    assert.deepEqual(
      answers.filter((answer) => answer.id !== 0).map((answer) => answer.id),
      [1, 2, 3],
    )
    assert.deepEqual(
      answers.filter((answer) => answer.error !== undefined),
      [],
    )
    assert.equal(
      answers.every((answer) => answer.result !== undefined),
      true,
    )
    assert.equal(requestsOf(endpoint.received, 'initialize').length, 1)
  },
)
