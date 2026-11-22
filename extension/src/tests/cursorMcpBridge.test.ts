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
import { removeTestFolder } from './utils/removeTestFolder'

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

/**
 * Starts a loopback MCP endpoint for Cursor's bridge that answers like Codebook's server unless the test takes a request over, and writes the private descriptor naming it; the arrange step of the stop-path tests.
 * Sessions are named `session-1`, `session-2`, … in initialize order; a GET is answered 405 (no standalone notification stream, as Codebook's server answers), a notification 202, a DELETE 200 and `tools/list` with no tools.
 * @param context - The test context; its cleanup closes the endpoint with its connections and removes the folder.
 * @param takeOver - Called with every request after it was recorded; returns `true` when the test answers or holds the request itself.
 * @returns The descriptor's path and every request received so far, in arrival order.
 */
async function startScriptedEndpoint(
  context: { after: (callback: () => Promise<void>) => void },
  takeOver: (request: ScriptedRequest) => boolean,
): Promise<{ descriptorPath: string; received: ScriptedRequest[] }> {
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-cursor-bridge-stop-'),
  )
  const received: ScriptedRequest[] = []
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
        body === ''
          ? undefined
          : z
              .looseObject({
                id: z.number().optional(),
                method: z.string().optional(),
                params: z
                  .looseObject({ protocolVersion: z.string().optional() })
                  .optional(),
              })
              .parse(JSON.parse(body))
      const sessionHeader = incoming.headers['mcp-session-id']
      const request: ScriptedRequest = {
        httpMethod: incoming.method ?? '',
        sessionId:
          typeof sessionHeader === 'string' ? sessionHeader : undefined,
        method: message?.method,
        outgoing,
        isClientGone: () => isGone,
      }
      received.push(request)
      if (message?.method === 'initialize') initializes += 1
      if (takeOver(request)) return
      if (request.httpMethod === 'GET') {
        outgoing.writeHead(405, { allow: 'POST, DELETE' })
        outgoing.end()
        return
      }
      // A DELETE and a notification carry no id: neither gets a JSON-RPC answer.
      if (request.httpMethod === 'DELETE' || message?.id === undefined) {
        outgoing.writeHead(request.httpMethod === 'DELETE' ? 200 : 202)
        outgoing.end()
        return
      }
      const isInitialize = message.method === 'initialize'
      outgoing.writeHead(200, {
        'content-type': 'application/json',
        ...(isInitialize && { 'mcp-session-id': `session-${initializes}` }),
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
    })
  })
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  context.after(async () => {
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
  return { descriptorPath, received }
}

/** Cursor's bridge entry running as a child process, as {@link startCursorBridgeChild} starts it. */
interface CursorBridgeChild {
  /** Resolves with the exit code once the process ended and its output was read to the end. */
  exited: Promise<number | null>
  readStderr: () => string
  /** The JSON-RPC messages the bridge wrote to stdout so far. */
  readMessages: () => Array<{ id?: number }>
  /** Does the MCP handshake a client makes (request 0 `initialize`, then `initialized`), once the bridge answered request 0. */
  handshake: () => Promise<void>
  /** Asks `tools/list` as request `id`. */
  askToolsList: (id: number) => void
  /** Closes the bridge's stdin, the way Cursor ends a bridge. */
  closeStdin: () => void
  signal: (name: NodeJS.Signals) => void
}

/**
 * Starts Cursor's bridge entry on a descriptor as Cursor does, with a preload; the environment is inherited, so a coverage run measures the child too.
 * @param context - The test context; its cleanup kills a process that is still running.
 * @param descriptorPath - The private descriptor the bridge connects with.
 * @param preloadSource - Source of a preload run in the bridge process.
 * @returns The running bridge with the controls of {@link CursorBridgeChild}.
 */
async function startCursorBridgeChild(
  context: { after: (callback: () => Promise<void>) => void },
  descriptorPath: string,
  preloadSource: string,
): Promise<CursorBridgeChild> {
  const preloadPath = join(dirname(descriptorPath), 'preload.js')
  await writeFile(preloadPath, preloadSource)
  const child = spawn(
    process.execPath,
    [
      '--require',
      preloadPath,
      join(__dirname, '../cursorMcpBridgeEntry.js'),
      descriptorPath,
    ],
    {
      // A process that is still alive here is the failure; it is ended so the test does not hang.
      timeout: 25_000,
      killSignal: 'SIGKILL',
    },
  )
  // Registered after the endpoint's cleanup, so it runs first: the bridge ends before its endpoint closes.
  context.after(async () => {
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
  const readMessages = (): Array<{ id?: number }> =>
    stdout
      // Only lines that ended with a newline are whole messages.
      .split('\n')
      .slice(0, -1)
      .filter((line) => line.startsWith('{'))
      .map((line) =>
        z.looseObject({ id: z.number().optional() }).parse(JSON.parse(line)),
      )
  return {
    exited,
    readStderr: () => stderr,
    readMessages,
    handshake: async (): Promise<void> => {
      send({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'cursor-bridge-stop-test', version: '1.0' },
        },
      })
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

/** Resolves with the exit code when the bridge ended within `budgetMs`, else with `still running`. */
function exitWithin(
  exited: Promise<number | null>,
  budgetMs: number,
): Promise<number | null | 'still running'> {
  return Promise.race([
    exited,
    new Promise<'still running'>((done) => {
      setTimeout(() => done('still running'), budgetMs).unref()
    }),
  ])
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
      context,
      endpoint.descriptorPath,
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
    const exitCode = await exitWithin(bridge.exited, 10_000)
    // Assert
    // The release was still pending after stdin closed, so both requests were still waiting for the reconnect then.
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
        context,
        endpoint.descriptorPath,
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
      const exitCode = await exitWithin(bridge.exited, 5_000)
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
      context,
      endpoint.descriptorPath,
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
    const exitCode = await exitWithin(bridge.exited, 5_000)
    // Assert
    assert.equal(exitCode, 0)
    assert.equal(notification.isClientGone(), true)
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

// Value: protects=no initialized notification reaching Cursor's server after Cursor ended the bridge, for a replacement session whose initialize answer was still arriving (Cycle 0146 task 7, Codex review of v3); fails_when=the cut handshake's client stays open while its session is released, so an answer that finishes meanwhile lets the SDK send the notification after the stop; no_claim=an initialize the server never answered (no session to release, the tests above)
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
        // The release is held until the test has finished the initialize answer.
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
      context,
      endpoint.descriptorPath,
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
    // The answer finishes after the stop, while the release of session-2 is held; a bridge that already closed that connection reads none of it.
    if (!initialize.isClientGone())
      initialize.outgoing.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'scripted', version: '1' },
          },
        }),
      )
    const release = await waitUntil(
      () => heldRelease,
      'the release of session-2',
      5_000,
      undefined,
      5,
    )
    release.outgoing.writeHead(200)
    release.outgoing.end()
    const exitCode = await exitWithin(bridge.exited, 5_000)
    // Assert
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
      context,
      endpoint.descriptorPath,
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
    const exitCode = await exitWithin(bridge.exited, 5_000)
    // Assert
    assert.equal('error' in answer, true)
    assert.equal(requestsOf(endpoint.received, 'tools/list').length, 0)
    assert.equal(exitCode, 0)
  },
)
