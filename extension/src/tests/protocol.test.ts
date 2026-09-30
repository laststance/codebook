import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import { request } from 'node:http'
import { connect as connectSocket } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { httpStatus } from './utils/httpStatus'
import { startServer, type ConnectionDescriptor } from '../server'
import {
  REPOSITORY_BROWSER_PROFILE as PROFILE_ID,
  SESSION_IDLE_TIMEOUT_MS,
} from '../constants'
import { createHarness } from './helpers'
import { snapshotSourceHashes } from '../utils/snapshotSourceHashes'
import { NodeTestHistoryStore } from '../nodeTestHistoryStore'
import { nodeTestHistoryHeader } from './utils/nodeTestHistoryFixture'
import { sha256 } from '../runtimeSupport/utils/sha256'

/** Connects the actual SDK client rather than emulating JSON-RPC in tests. @example const connected = await connect(endpoint.descriptor) */
async function connect(descriptor: ConnectionDescriptor) {
  const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
    requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
  })
  const client = new Client({ name: 'codebook-protocol-test', version: '1.0' })
  try {
    await client.connect(transport)
  } catch (error) {
    await client.close()
    throw error
  }
  return {
    client,
    transport,
    async close() {
      try {
        await transport.terminateSession()
      } finally {
        await client.close()
      }
    },
  }
}
const receiptSchema = z.object({
  instanceId: z.string(),
  runId: z.string(),
  runUri: z.string(),
})

test('MCP discovery declares application execution effects without broadening source reader or storage annotations', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    // Act
    const discovery = await connection.client.listTools()
    // Assert
    for (const name of [
      'codebook_start',
      'codebook_action',
      'codebook_continue',
    ]) {
      const annotations = discovery.tools.find(
        (tool) => tool.name === name,
      )!.annotations
      assert.equal(annotations?.readOnlyHint, false)
      assert.equal(annotations?.destructiveHint, true)
      assert.equal(annotations?.openWorldHint, true)
    }
    assert.equal(
      discovery.tools.find((tool) => tool.name === 'codebook_source')!
        .annotations?.readOnlyHint,
      true,
    )
    assert.equal(
      discovery.tools.find((tool) => tool.name === 'codebook_read_resource')!
        .annotations?.readOnlyHint,
      true,
    )
    assert.equal(
      discovery.tools.find((tool) => tool.name === 'codebook_publish_book')!
        .annotations?.openWorldHint,
      false,
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})

test('status identifies extension build changes without claiming that the target workspace changed', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    // Act
    const discovery = await connection.client.listTools()
    const result = await connection.client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    const status = z
      .object({
        data: z.object({
          build: z.object({ dirty: z.boolean(), scope: z.string() }),
          workspaceGitStatus: z.string(),
        }),
      })
      .parse(result.structuredContent).data
    // Assert
    assert.match(
      discovery.tools.find((tool) => tool.name === 'codebook_status')!
        .description!,
      /packaged Codebook extension source, not the target repository/,
    )
    assert.equal(status.build.dirty, true)
    assert.equal(status.build.scope, 'codebook-extension-source')
    assert.equal(status.workspaceGitStatus, 'not-inspected')
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})

test('tool-only editor chats receive public help and current run data in structured results', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    // Act
    const helpUri = 'codebook://help/repository-browser'
    const helpTool = await connection.client.callTool({
      name: 'codebook_read_resource',
      arguments: { uri: helpUri },
    })
    const helpResource = await connection.client.readResource({ uri: helpUri })
    const started = await connection.client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId: endpoint.descriptor.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: 'resource-tool',
      },
    })
    const receipt = z
      .object({ data: receiptSchema })
      .parse(started.structuredContent).data
    await harness.service.record(receipt).preparation
    const runTool = await connection.client.callTool({
      name: 'codebook_read_resource',
      arguments: { uri: receipt.runUri },
    })
    const runResource = await connection.client.readResource({
      uri: receipt.runUri,
    })
    const foreign = await connection.client.callTool({
      name: 'codebook_read_resource',
      arguments: {
        uri: 'codebook://not-this-instance/runs/00000000-0000-4000-8000-000000000000',
      },
    })
    // Assert
    const textContent = z.object({ type: z.literal('text'), text: z.string() })
    const structuredResource = z.object({
      ok: z.literal(true),
      uri: z.string(),
      mimeType: z.literal('application/json'),
      data: z.unknown(),
    })
    const helpContent = helpResource.contents[0],
      runContent = runResource.contents[0]
    assert.ok(helpContent && 'text' in helpContent)
    assert.ok(runContent && 'text' in runContent)
    assert.equal(
      structuredResource.parse(helpTool.structuredContent).uri,
      helpUri,
    )
    assert.equal(
      structuredResource.parse(runTool.structuredContent).uri,
      receipt.runUri,
    )
    assert.deepEqual(
      structuredResource.parse(helpTool.structuredContent).data,
      JSON.parse(helpContent.text),
    )
    assert.deepEqual(
      structuredResource.parse(runTool.structuredContent).data,
      JSON.parse(runContent.text),
    )
    assert.match(
      helpContent.text,
      /Copy studyId from the terminal run resource and observationId/,
    )
    assert.equal(
      z.array(textContent).parse(helpTool.content)[0]?.text,
      helpContent.text,
    )
    assert.equal(
      z.array(textContent).parse(runTool.content)[0]?.text,
      runContent.text,
    )
    assert.equal(foreign.isError, true)
    assert.match(JSON.stringify(foreign.structuredContent), /STALE_INSTANCE/)
    assert.equal(harness.runtimes.length, 1)
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})

test('real MCP discovery, action and reconnect retain one runtime and one click after GET 405', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    first = await connect(endpoint.descriptor)
  let second: Awaited<ReturnType<typeof connect>> | undefined
  try {
    // Act
    const discovery = await first.client.listTools()
    const templates = await first.client.listResourceTemplates()
    const started = await first.client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId: endpoint.descriptor.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: 'study',
      },
    })
    const receipt = z
      .object({ data: receiptSchema })
      .parse(started.structuredContent).data
    await harness.service.record(receipt).preparation
    const arguments_ = {
      instanceId: receipt.instanceId,
      runId: receipt.runId,
      key: 'click',
      action: 'repository-click',
    }
    const accepted = await first.client.callTool({
      name: 'codebook_action',
      arguments: arguments_,
    })
    await first.client.close()
    second = await connect(endpoint.descriptor)
    const repeated = await second.client.callTool({
      name: 'codebook_action',
      arguments: arguments_,
    })
    const state = await second.client.readResource({ uri: receipt.runUri })
    // Assert
    assert.deepEqual(discovery.tools.map((tool) => tool.name).sort(), [
      'codebook_action',
      'codebook_continue',
      'codebook_explain',
      'codebook_explain_node_history',
      'codebook_open_book',
      'codebook_playback',
      'codebook_presentation',
      'codebook_publish_book',
      'codebook_read_resource',
      'codebook_return_current',
      'codebook_reveal',
      'codebook_source',
      'codebook_sources',
      'codebook_start',
      'codebook_status',
      'codebook_stop',
    ])
    assert.equal(templates.resourceTemplates.length, 17)
    assert.equal(accepted.isError, undefined)
    assert.deepEqual(repeated.structuredContent, accepted.structuredContent)
    assert.equal(harness.runtimes[0]?.dispatches, 1)
    assert.match(JSON.stringify(state), /paused-browser/)
    const get = await fetch(endpoint.descriptor.url, {
      headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
    })
    assert.equal(get.status, 405)
    const stopped = await second.client.callTool({
      name: 'codebook_stop',
      arguments: { instanceId: receipt.instanceId, runId: receipt.runId },
    })
    assert.equal(stopped.isError, undefined)
    const history = await second.client.readResource({ uri: receipt.runUri })
    assert.match(JSON.stringify(history), /stopped/)
  } finally {
    await first.client.close()
    await second?.close()
    await endpoint.close()
    await harness.close()
  }
})

test('authentication and Host Origin body boundaries reject requests even with a valid transport session', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    const authorization = `Bearer ${endpoint.descriptor.token}`,
      sessionId = connection.transport.sessionId!
    const headers = {
      Authorization: authorization,
      'mcp-session-id': sessionId,
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    // Act / Assert
    assert.equal(
      (
        await fetch(endpoint.descriptor.url, {
          method: 'POST',
          body: '{}',
          headers: { ...headers, Authorization: 'Bearer incorrect' },
        })
      ).status,
      401,
    )
    assert.equal(
      await httpStatus(
        endpoint.descriptor.url,
        { ...headers, Host: 'evil.example' },
        '{}',
      ),
      403,
    )
    assert.equal(
      (
        await fetch(endpoint.descriptor.url, {
          method: 'POST',
          body: '{}',
          headers: { ...headers, Origin: 'https://evil.example' },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await fetch(endpoint.descriptor.url, {
          method: 'POST',
          body: 'x'.repeat(1_114_113),
          headers,
        })
      ).status,
      413,
    )
    assert.equal(harness.runtimes.length, 0)
    const status = await connection.client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    assert.equal(
      z.object({ ok: z.boolean() }).parse(status.structuredContent).ok,
      true,
    )
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})

test('foreign instance and run errors are structured domain failures and invalid tool arguments dispatch nothing', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    // Act
    const foreign = await connection.client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId: 'eeb4a708-853e-4f38-8eac-ddf6d1415f14',
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: 'wrong',
      },
    })
    const invalid = await connection.client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId: endpoint.descriptor.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: '',
        arbitrary: 'eval',
      },
    })
    // Assert
    assert.equal(foreign.isError, true)
    assert.match(JSON.stringify(foreign.structuredContent), /STALE_INSTANCE/)
    assert.equal(invalid.isError, true)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})

test('eight idle MCP clients exhaust capacity but expiry releases their slots without stopping a paused run', async () => {
  // Arrange
  let now = 0
  const harness = await createHarness(),
    endpoint = await startServer(harness.service, () => now)
  const connections: Awaited<ReturnType<typeof connect>>[] = []
  try {
    for (let index = 0; index < 8; index += 1)
      connections.push(await connect(endpoint.descriptor))
    const receipt = harness.service.start({
      instanceId: harness.service.instanceId,
      profile: PROFILE_ID,
      configuration: harness.configuration,
      key: 'retained',
    })
    await harness.service.record(receipt).preparation
    harness.service.action({
      ...receipt,
      key: 'click',
      action: 'repository-click',
    })
    // Act / Assert
    await assert.rejects(
      connect(endpoint.descriptor),
      /MCP session limit exceeded/,
    )
    now = SESSION_IDLE_TIMEOUT_MS + 1
    endpoint.expire()
    const recovered = await connect(endpoint.descriptor)
    connections.push(recovered)
    assert.equal(harness.runtimes[0]?.stopped, false)
    assert.equal(harness.runtimes[0]?.dispatches, 1)
    const result = await recovered.client.readResource({ uri: receipt.runUri })
    assert.match(JSON.stringify(result), /paused-browser/)
  } finally {
    await Promise.allSettled(
      connections.map((connection) => connection.client.close()),
    )
    await endpoint.close()
    await harness.close()
  }
})

test('a stalled authenticated body reaches its read deadline without dispatching a tool', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service)
  try {
    // Act: send a partial JSON body and deliberately never end it.
    const status = await new Promise<number>((resolve, reject) => {
      const pending = request(
        endpoint.descriptor.url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.descriptor.token}`,
            'content-type': 'application/json',
          },
        },
        (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode ?? 0))
          response.once('error', reject)
        },
      )
      pending.once('error', reject)
      pending.write('{')
    })
    // Assert
    assert.equal(status, 408)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await endpoint.close()
    await harness.close()
  }
})

test('an incomplete HTTP header is rejected near the five-second read deadline before authentication', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    address = new URL(endpoint.descriptor.url)
  const socket = connectSocket(Number(address.port), address.hostname)
  let response = '',
    closed = false
  socket.on('data', (bytes) => {
    response += bytes.toString()
  })
  socket.on('close', () => {
    closed = true
  })
  socket.on('error', () => {})
  try {
    // Act
    socket.write('POST /mcp HTTP/1.1\r\n')
    await waitUntil(() => closed, 'incomplete header expires', 6_000)
    // Assert
    assert.match(response, /^HTTP\/1\.1 408 Request Timeout/)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    socket.destroy()
    await endpoint.close()
    await harness.close()
  }
})

test('deleting an in-flight MCP session settles its HTTP response and preserves capacity and the paused study', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service)
  const receipt = harness.service.start({
    instanceId: harness.service.instanceId,
    profile: PROFILE_ID,
    configuration: harness.configuration,
    key: 'study',
  })
  await harness.service.record(receipt).preparation
  harness.service.action({
    ...receipt,
    key: 'click',
    action: 'repository-click',
  })
  try {
    // Act: exceed the global thirty-two-request capacity through normal session deletion.
    for (let index = 0; index < 36; index += 1) {
      let entered = false,
        settled = false,
        release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      harness.service.environment.prerequisites = async () => {
        entered = true
        await barrier
        return { ready: true, missing: [] }
      }
      const connection = await connect(endpoint.descriptor)
      const pending = connection.client
        .callTool({ name: 'codebook_status', arguments: {} })
        .then(
          () => 'unexpected success',
          () => 'closed',
        )
        .finally(() => {
          settled = true
        })
      try {
        await waitUntil(() => entered, 'held status', 1_000)
        await connection.transport.terminateSession()
        await waitUntil(
          () => settled,
          'deleted response settles before handler completes',
          1_000,
        )
        assert.equal(await pending, 'closed')
      } finally {
        release()
        await connection.client.close()
      }
    }
    // Assert
    const recovered = await connect(endpoint.descriptor)
    try {
      assert.equal((await recovered.client.listTools()).tools.length, 16)
    } finally {
      await recovered.close()
    }
    assert.equal(harness.runtimes[0]?.dispatches, 1)
    assert.equal(harness.runtimes[0]?.stopped, false)
  } finally {
    await endpoint.close()
    await harness.close()
  }
})

test('cancelled MCP calls release HTTP capacity without closing their shared session', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    // Act: cancellation suppresses handler responses, so transport cleanup must settle each POST.
    for (let index = 0; index < 36; index += 1) {
      let entered = false,
        release!: () => void
      const barrier = new Promise<void>((resolve) => {
        release = resolve
      })
      harness.service.environment.prerequisites = async () => {
        entered = true
        await barrier
        return { ready: true, missing: [] }
      }
      const abort = new AbortController()
      const pending = assert.rejects(
        connection.client.callTool(
          { name: 'codebook_status', arguments: {} },
          undefined,
          { signal: abort.signal },
        ),
      )
      try {
        await waitUntil(() => entered, 'held cancellable status', 1_000)
        abort.abort()
        await pending
      } finally {
        release()
      }
      assert.equal((await connection.client.listTools()).tools.length, 16)
    }
    // Assert
    assert.equal(
      (await connection.client.listResourceTemplates()).resourceTemplates
        .length,
      17,
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})

test('Node learning material is exposed through MCP with exact workspace history identity and revisions', async () => {
  // Arrange
  const harness = await createHarness(),
    directory = await mkdtemp(
      join(tmpdir(), 'codebook-node-learning-protocol-'),
    )
  const header = nodeTestHistoryHeader(
    sha256('node-learning-protocol-workspace'),
  )
  const historyStore = new NodeTestHistoryStore(directory, header.workspaceKey)
  const writer = await historyStore.start(header)
  await writer.appendOutput({
    sequence: 1,
    elapsedMs: 2,
    channel: 'stdout',
    text: 'partial test output',
  })
  await writer.finish('partial', 'Protocol storage test.')
  harness.service.nodeHistoryStore = historyStore
  const endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    const discovery = await connection.client.listTools()
    const historyResource = await connection.client.readResource({
      uri: 'codebook://node-history',
    })
    const historyContent = historyResource.contents[0]
    assert.ok(historyContent && 'text' in historyContent)
    const catalogPage = z
      .object({ content: z.string(), complete: z.boolean() })
      .parse(JSON.parse(historyContent.text))
    assert.equal(catalogPage.complete, true)
    const [entry] = JSON.parse(catalogPage.content) as Array<{
      studyId: string
      learningMaterialUri: string
    }>
    assert.ok(entry)
    const materialUri = entry.learningMaterialUri
    const content = {
      question: 'What happened in this interrupted test?',
      title: 'Interrupted test',
      summary:
        'Output was recorded, but no verified stop or result is available.',
      participants: [{ id: 'test', label: 'Vitest test' }],
      steps: [
        {
          id: 'interrupted',
          from: 'test',
          to: 'test',
          label: 'Test output',
          explanation:
            'The journal contains output only; execution behavior remains unknown.',
          evidence: 'unknown',
        },
      ],
    }

    // Act: save and retrieve the bounded agent-authored material.
    const saved = await connection.client.callTool({
      name: 'codebook_explain_node_history',
      arguments: { studyId: entry.studyId, expectedRevision: 0, content },
    })
    const material = await connection.client.callTool({
      name: 'codebook_read_resource',
      arguments: { uri: materialUri },
    })
    const stale = await connection.client.callTool({
      name: 'codebook_explain_node_history',
      arguments: { studyId: entry.studyId, expectedRevision: 0, content },
    })

    // Assert
    assert.ok(
      discovery.tools.some(
        (tool) => tool.name === 'codebook_explain_node_history',
      ),
    )
    assert.equal(
      z
        .object({ data: z.object({ revision: z.number() }) })
        .parse(saved.structuredContent).data.revision,
      1,
    )
    const materialPage = z
      .object({
        data: z.object({ content: z.string(), complete: z.boolean() }),
      })
      .parse(material.structuredContent).data
    assert.equal(materialPage.complete, true)
    const materialData = z
      .object({ revision: z.number(), content: z.unknown() })
      .parse(JSON.parse(materialPage.content))
    assert.equal(materialData.revision, 1)
    assert.deepEqual(materialData.content, content)
    assert.equal(stale.isError, true)
    assert.match(
      JSON.stringify(stale.structuredContent),
      /IDEMPOTENCY_CONFLICT/,
    )
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('standard MCP explanation calls persist learning material and reject foreign sequence references', async () => {
  // Arrange
  const harness = await createHarness(),
    endpoint = await startServer(harness.service),
    connection = await connect(endpoint.descriptor)
  try {
    const started = await connection.client.callTool({
      name: 'codebook_start',
      arguments: {
        instanceId: harness.service.instanceId,
        profile: PROFILE_ID,
        configuration: harness.configuration,
        key: 'learning',
      },
    })
    const receipt = z
      .object({ data: receiptSchema })
      .parse(started.structuredContent).data
    const record = harness.service.record(receipt)
    await record.preparation
    await connection.client.callTool({
      name: 'codebook_action',
      arguments: {
        instanceId: receipt.instanceId,
        runId: receipt.runId,
        key: 'select',
        action: 'repository-click',
      },
    })
    const snapshotUri =
        harness.service.state(record).participants.browser.snapshotUri!,
      sourceHash = snapshotSourceHashes(
        harness.service.snapshot(record, snapshotUri),
      ).typescript
    const learningSummary = {
      question: 'Which theme was selected?',
      title: 'Selection',
      summary: 'The recorded value is dark.',
      participants: [{ id: 'source', label: 'Source' }],
      steps: [
        {
          id: '__proto__',
          from: 'source',
          to: 'source',
          label: 'Selection',
          explanation: 'nextTheme is dark at this stop.',
          evidence: 'observed',
          reference: { snapshotUri, sourceHash },
        },
      ],
    }
    const input = {
      instanceId: receipt.instanceId,
      runId: receipt.runId,
      key: 'summary',
      snapshotUri,
      sourceHash,
      valuePaths: ['value:nextTheme'],
      interpretation: 'The selected theme is dark.',
      learningSummary,
    }
    // Act
    const explained = await connection.client.callTool({
      name: 'codebook_explain',
      arguments: input,
    })
    const explanationUri = z
      .object({ data: z.object({ explanationUri: z.string() }) })
      .parse(explained.structuredContent).data.explanationUri
    const resource = await connection.client.readResource({
      uri: explanationUri,
    })
    const invalid = await connection.client.callTool({
      name: 'codebook_explain',
      arguments: {
        ...input,
        key: 'foreign',
        learningSummary: {
          ...learningSummary,
          steps: [
            {
              ...learningSummary.steps[0],
              reference: { snapshotUri: snapshotUri + '/foreign', sourceHash },
            },
          ],
        },
      },
    })
    // Assert
    assert.equal(explained.isError, undefined)
    const content = resource.contents[0]
    assert.ok(content && 'text' in content)
    assert.deepEqual(JSON.parse(content.text).learningSummary, learningSummary)
    assert.equal(invalid.isError, true)
    assert.match(JSON.stringify(invalid), /INVALID_REFERENCE/)
    assert.equal(record.explanations.size, 1)
  } finally {
    await connection.close()
    await endpoint.close()
    await harness.close()
  }
})
