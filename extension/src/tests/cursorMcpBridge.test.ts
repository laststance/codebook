import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'

import { SESSION_IDLE_TIMEOUT_MS } from '../constants'
import { runCursorMcpBridge } from '../cursorMcpBridge'
import { startServer } from '../server'
import { readBridgeDescriptor } from '../utils/readBridgeDescriptor'

import { createHarness } from './helpers'
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
    // Act
    const outcome = readBridgeDescriptor(
      descriptorPath,
      { instanceId, pid: process.pid, workspace: directory, devinChat: true },
      300,
      () => new Promise<string>(() => undefined),
    )
    // Assert
    await assert.rejects(outcome, /did not finish in time/)
  },
)
