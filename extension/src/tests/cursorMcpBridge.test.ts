import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import { startServer } from '../server'
import { createHarness } from './helpers'
import { SESSION_IDLE_TIMEOUT_MS } from '../constants'

test('Cursor stdio bridge exposes the current authenticated Codebook instance without a credential in its command', async (context) => {
  // Arrange
  let now = 0
  const harness = await createHarness(),
    endpoint = await startServer(harness.service, () => now),
    directory = await mkdtemp(join(tmpdir(), 'codebook-cursor-bridge-'))
  context.after(async () => {
    await endpoint.close()
    await harness.close()
    await rm(directory, { recursive: true, force: true })
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
    assert.equal(templates.resourceTemplates.length, 17)
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
    await rm(directory, { recursive: true, force: true })
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
  context.after(() => rm(directory, { recursive: true, force: true }))
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
