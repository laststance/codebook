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
test('Cursor stdio bridge sends no request to a descriptor url that is not the loopback /mcp endpoint', async (context) => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-bridge-url-'))
  let requests = 0
  const listener = createServer((_request, response) => {
    requests += 1
    response.end()
  })
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
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
})
