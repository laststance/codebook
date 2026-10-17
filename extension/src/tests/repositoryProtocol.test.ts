import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'

import { StudyError } from '../errors'
import { LearningLibrary } from '../learningLibrary'
import { RepositoryBookStore } from '../repositoryBook'
import { type BookDocument } from '../repositorySchemas'
import { RepositorySourceService } from '../repositorySource'
import { readResource } from '../resources'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startServer } from '../server'

import { createHarness } from './helpers'

const executeFile = promisify(execFile),
  sourceHash =
    '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b'

/** Connects actual MCP/HTTP/SDK boundaries to real tracked files while leaving all runtime prerequisites absent. @example const harness = await repositoryProtocolHarness() */
async function repositoryProtocolHarness() {
  const harness = await createHarness({
    prerequisites: async () => ({
      ready: false,
      missing: ['Chrome and debugger are unavailable.'],
    }),
  })
  await executeFile('git', ['init', '--quiet', harness.directory])
  await writeFile(
    join(harness.directory, 'module.ts'),
    'export const price = 24;\n',
  )
  await executeFile('git', ['add', '--', 'module.ts'], {
    cwd: harness.directory,
  })
  const library = new LearningLibrary(
    join(harness.directory, 'learning'),
    sha256(harness.directory),
  )
  harness.service.repository = new RepositoryBookStore(
    new RepositorySourceService(harness.directory),
    library,
  )
  const endpoint = await startServer(harness.service),
    transport = new StreamableHTTPClientTransport(
      new URL(endpoint.descriptor.url),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${endpoint.descriptor.token}` },
        },
      },
    )
  const client = new Client({
    name: 'repository-protocol-test',
    version: '1.0',
  })
  await client.connect(transport)
  return {
    ...harness,
    library,
    endpoint,
    client,
    transport,
    async close(): Promise<void> {
      try {
        await transport.terminateSession()
      } finally {
        await client.close()
        await endpoint.close()
        await harness.close()
      }
    },
  }
}

/** Constructs a schema-valid ASCII document of an exact byte size to exercise transport and document limits separately. @example sizedDocument(1048576) */
function sizedDocument(bytes: number): BookDocument {
  const document: BookDocument = {
    title: 'Repository source',
    summary: 'Source interpretation',
    nodes: Array.from({ length: 10 }, (_, index) => ({
      id: `node-${index}`,
      title: `Node ${index}`,
      sections: Array.from({ length: 10 }, (_, section) => ({
        title: `Section ${section}`,
        text: 'x',
      })),
      anchors: [
        { path: 'module.ts', hash: sourceHash, startLine: 1, endLine: 2 },
      ],
      observations: [],
    })),
    edges: [],
  }
  for (const node of document.nodes)
    for (const section of node.sections) {
      const remaining = bytes - Buffer.byteLength(JSON.stringify(document))
      if (remaining <= 0) return document
      section.text += 'x'.repeat(Math.min(11_999, remaining))
    }
  return document
}

test('installed SDK advertises object-shaped repository tools and source-only authoring works without runtime prerequisites', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    const instanceId = harness.service.instanceId,
      discovery = await harness.client.listTools()
    // Act
    const status = await harness.client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    const catalog = await harness.client.callTool({
      name: 'codebook_sources',
      arguments: { instanceId },
    })
    const source = await harness.client.callTool({
      name: 'codebook_source',
      arguments: { instanceId, path: 'module.ts' },
    })
    // Assert
    for (const name of [
      'codebook_sources',
      'codebook_source',
      'codebook_publish_book',
      'codebook_open_book',
    ])
      assert.equal(
        discovery.tools.find((tool) => tool.name === name)?.inputSchema.type,
        'object',
      )
    const state = z
      .object({
        data: z.object({
          prerequisites: z.object({ ready: z.boolean() }),
          repository: z.object({
            ready: z.boolean(),
            limits: z.object({ booksPerWorkspace: z.number() }),
          }),
        }),
      })
      .parse(status.structuredContent).data
    assert.equal(state.prerequisites.ready, false)
    assert.equal(state.repository.ready, true)
    assert.equal(
      state.repository.limits.booksPerWorkspace,
      64,
      'agents can distinguish 16 retained books from the current admission limit',
    )
    assert.equal(catalog.isError, undefined)
    assert.match(JSON.stringify(catalog), /module.ts/)
    assert.match(JSON.stringify(source), /5e707638ceba927d6f/)
    assert.equal(harness.runtimes.length, 0)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
  } finally {
    await harness.close()
  }
})

test('the exact one-MiB document plus JSON-RPC envelope reaches publication while document and transport overflow retain old bytes', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    const instanceId = harness.service.instanceId,
      document = sizedDocument(1_048_576),
      arguments_ = {
        instanceId,
        bookId: 'real-source',
        key: 'large',
        expectedRevision: 0,
        document,
      }
    assert.equal(Buffer.byteLength(JSON.stringify(document)), 1_048_576)
    // Act
    const published = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: arguments_,
    })
    assert.equal(published.isError, undefined, JSON.stringify(published))
    const before = await readFile(
      join(harness.library.directory, 'real-source.book.v2.json'),
    )
    const rejected = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: {
        ...arguments_,
        key: 'overflow',
        expectedRevision: 1,
        document: sizedDocument(1_048_577),
      },
    })
    const response = await fetch(harness.endpoint.descriptor.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${harness.endpoint.descriptor.token}`,
        'mcp-session-id': harness.transport.sessionId!,
        'content-type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: 'x'.repeat(1_114_113),
    })
    // Assert
    assert.equal(rejected.isError, true)
    assert.match(JSON.stringify(rejected), /LIMIT_EXCEEDED/)
    assert.equal(response.status, 413)
    assert.deepEqual(
      await readFile(
        join(harness.library.directory, 'real-source.book.v2.json'),
      ),
      before,
    )
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('explicit MCP cancellation during preparation prevents a new publication while leaving the connection and retained bytes usable', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness(),
    store = harness.service.repository!
  let release = (): void => {},
    enter = (): void => {},
    signal: AbortSignal | undefined
  const held = new Promise<void>((resolve) => {
      release = resolve
    }),
    entered = new Promise<void>((resolve) => {
      enter = resolve
    })
  try {
    const input = {
      instanceId: harness.service.instanceId,
      bookId: 'source',
      key: 'first',
      expectedRevision: 0,
      document: sizedDocument(72_000),
    }
    await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: input,
    })
    const before = await readFile(
      join(harness.library.directory, 'source.book.v2.json'),
    )
    const prepare = store.sources.prepare.bind(store.sources)
    store.sources.prepare = async (
      ...arguments_: Parameters<typeof prepare>
    ) => {
      const result = await prepare(...arguments_)
      signal = arguments_[1]?.signal
      enter()
      await held
      return result
    }
    const cancellation = new AbortController()
    // Act
    const pending = harness.client.callTool(
      {
        name: 'codebook_publish_book',
        arguments: { ...input, key: 'cancelled', expectedRevision: 1 },
      },
      undefined,
      { signal: cancellation.signal },
    )
    const rejected = assert.rejects(pending, /Abort|cancel/i)
    await entered
    cancellation.abort()
    await rejected
    await waitUntil(
      () => signal?.aborted,
      'request cancellation reached preparation',
      2_000,
    )
    release()
    await store.flush()
    // Assert
    assert.deepEqual(
      await readFile(join(harness.library.directory, 'source.book.v2.json')),
      before,
    )
    assert.equal((await harness.client.listTools()).tools.length, 16)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    release()
    await harness.close()
  }
})

test('public retry and immutable source resources survive a lost response followed by source deletion', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    const input = {
      instanceId: harness.service.instanceId,
      bookId: 'source',
      key: 'one',
      expectedRevision: 0,
      document: sizedDocument(72_000),
    }
    const published = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: input,
    })
    const receipt = z
      .object({ data: z.object({ uri: z.string(), revision: z.number() }) })
      .parse(published.structuredContent).data
    // Act
    await rm(join(harness.directory, 'module.ts'))
    const repeated = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: input,
    })
    const book = await harness.client.readResource({ uri: receipt.uri })
    const captured = await harness.client.readResource({
      uri: `${receipt.uri}/sources/0`,
    })
    // Assert
    assert.deepEqual(repeated.structuredContent, published.structuredContent)
    assert.equal(receipt.revision, 1)
    assert.match(JSON.stringify(book), /Source-derived/)
    assert.match(JSON.stringify(captured), /export const price = 24/)
    assert.equal((await harness.library.readProgress()).decisions.length, 0)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

test('MCP cancellation reaches an accepted article open before pending reader work can reveal source', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  let release = (): void => {},
    enter = (): void => {},
    signal: AbortSignal | undefined,
    opened = false
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve
    })
  harness.service.repositoryReader = async (input, cancellation) => {
    signal = cancellation
    enter()
    await waiting
    cancellation.throwIfAborted()
    opened = true
    return { ...input, anchorIndex: 0, sourceUri: 'captured-source' }
  }
  try {
    const cancellation = new AbortController()
    // Act
    const pending = harness.client.callTool(
      {
        name: 'codebook_open_book',
        arguments: {
          instanceId: harness.service.instanceId,
          bookId: 'source',
          revision: 1,
          nodeId: 'node-0',
        },
      },
      undefined,
      { signal: cancellation.signal },
    )
    const rejected = assert.rejects(pending, /Abort|cancel/i)
    await entered
    cancellation.abort()
    await rejected
    await waitUntil(
      () => signal?.aborted,
      'MCP cancellation reaches article reader',
      2_000,
    )
    release()
    // Assert
    assert.equal((await harness.client.listTools()).tools.length, 16)
    assert.equal(opened, false)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    release()
    await harness.close()
  }
})

test('Stop Agent Server cancels and drains pending article navigation before retirement completes', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  let release = (): void => {},
    enter = (): void => {},
    signal: AbortSignal | undefined
  const entered = new Promise<void>((resolve) => {
      enter = resolve
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    effects: string[] = []
  harness.service.repositoryReader = async (input, cancellation) => {
    signal = cancellation
    enter()
    await waiting
    effects.push('reader-settled')
    cancellation.throwIfAborted()
    effects.push('source-opened')
    return { ...input, anchorIndex: 0, sourceUri: 'captured-source' }
  }
  try {
    // Act
    const pending = harness.service.openBook({
      instanceId: harness.service.instanceId,
      bookId: 'source',
      revision: 1,
      nodeId: 'node-0',
    })
    const rejected = assert.rejects(pending, /Abort/)
    await entered
    const shutdown = harness.service.shutdown().then(() => {
      effects.push('shutdown-completed')
    })
    await Promise.resolve()
    assert.equal(signal?.aborted, true)
    assert.deepEqual(effects, [])
    release()
    await rejected
    await shutdown
    // Assert
    assert.deepEqual(effects, ['reader-settled', 'shutdown-completed'])
    assert.equal(harness.runtimes.length, 0)
  } finally {
    release()
    await harness.close()
  }
})

test('foreign identities, changed workspace ownership and malformed repository URIs cannot read or write another target', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    const instanceId = harness.service.instanceId
    // Act / Assert
    const foreign = await harness.client.callTool({
      name: 'codebook_sources',
      arguments: { instanceId: '11111111-1111-4111-8111-111111111111' },
    })
    assert.equal(foreign.isError, true)
    assert.match(JSON.stringify(foreign), /STALE_INSTANCE/)
    for (const suffix of [
      'books/source/01',
      'books/source/1/sources/-1',
      'books/source/1?current=true',
      'books/source/1/sources/9007199254740992',
    ])
      await assert.rejects(
        readResource(harness.service, `codebook://${instanceId}/${suffix}`),
      )
    harness.service.environment.assertWorkspace = () => {
      throw new StudyError('STALE_INSTANCE', 'Workspace changed.')
    }
    const changed = await harness.client.callTool({
      name: 'codebook_source',
      arguments: { instanceId, path: 'module.ts' },
    })
    assert.equal(changed.isError, true)
    assert.match(JSON.stringify(changed), /STALE_INSTANCE/)
    assert.equal(harness.runtimes.length, 0)
  } finally {
    await harness.close()
  }
})

/** One article node that cites the tracked file of {@link repositoryProtocolHarness}; an agent's smallest valid node. @example citedNode('entry') */
const citedNode = (id: string) => ({
  id,
  title: 'Price',
  sections: [{ title: 'Value', text: 'The module exports the price.' }],
  anchors: [{ path: 'module.ts', hash: sourceHash, startLine: 1, endLine: 1 }],
  observations: [],
})

/** The text of a tool result an MCP client received, as an agent reads it. @example toolText(await harness.client.callTool({ name: 'codebook_publish_book', arguments })) */
const toolText = (result: unknown): string =>
  z
    .object({ content: z.array(z.object({ text: z.string() })).min(1) })
    .parse(result).content[0]!.text

// Value: protects=an agent's first publish of an article that describes no relationships; fails_when=a document without the member edges is refused by the input validation, after which the VS Code agent of the second native round ran on an article it had not written; why_new=Cycle 0045 finding R2-F1 (DX-1 a); seam=none
test('a document published without edges is published as one without relationships', async () => {
  // Arrange: a complete document that has no member edges.
  const harness = await repositoryProtocolHarness()
  try {
    const publication = {
      instanceId: harness.service.instanceId,
      bookId: 'price',
      key: 'first',
      expectedRevision: 0,
      document: {
        title: 'Price',
        summary: 'Where the price comes from.',
        nodes: [citedNode('entry')],
      },
    }

    // Act
    const published = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: publication,
    })
    const repeatedWithEmptyList = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: {
        ...publication,
        document: { ...publication.document, edges: [] },
      },
    })

    // Assert: the revision is saved with an empty list, and the same publication with the list written out is the same one.
    assert.equal(published.isError, undefined, JSON.stringify(published))
    const saved = z
      .object({
        revisions: z.array(
          z.object({
            revision: z.number(),
            document: z.object({ edges: z.array(z.unknown()) }),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(
            join(harness.library.directory, 'price.book.v2.json'),
            'utf8',
          ),
        ),
      )
    assert.deepEqual(saved.revisions, [
      { revision: 1, document: { edges: [] } },
    ])
    assert.deepEqual(
      repeatedWithEmptyList.structuredContent,
      published.structuredContent,
    )
    assert.deepEqual(
      (await harness.service.repository!.readDefinition('price', 1)).revision
        .document.edges,
      [],
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the refusal of a relationship that names no node of its document, which a default for edges must not loosen; fails_when=such a document is published, or the refusal stops naming the relationship; why_new=Cycle 0045 finding R2-F1 (the guard of its tolerance); seam=none
test('a document with a relationship whose endpoint names no node is still refused naming that relationship', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const refused = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: {
        instanceId: harness.service.instanceId,
        bookId: 'price',
        key: 'first',
        expectedRevision: 0,
        document: {
          title: 'Price',
          summary: 'Where the price comes from.',
          nodes: [citedNode('entry')],
          edges: [
            {
              from: 'entry',
              to: 'missing',
              relationship: 'calls',
              explanation:
                'The entry calls a node this document does not have.',
            },
          ],
        },
      },
    })

    // Assert
    assert.equal(refused.isError, true)
    assert.equal(
      toolText(refused),
      'MCP error -32602: Input validation error: Invalid arguments for tool codebook_publish_book: Both relationship endpoints must name nodes in this document. at document.edges[0]',
    )
    await assert.rejects(
      readFile(join(harness.library.directory, 'price.book.v2.json')),
      /ENOENT/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent reading, where it reads last before it publishes, which members a document has and that edges may be left out; fails_when=the document of the publish tool's input schema carries no description, or still lists edges as required; why_new=Cycle 0045 finding R2-F1 (DX-1 b); seam=none
test('the input schema of codebook_publish_book names the members of a document and does not require edges', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const tools = await harness.client.listTools()

    // Assert
    const document = z
      .object({
        properties: z.object({
          document: z.object({
            description: z.string(),
            required: z.array(z.string()),
          }),
        }),
      })
      .parse(
        tools.tools.find((tool) => tool.name === 'codebook_publish_book')
          ?.inputSchema,
      ).properties.document
    assert.equal(
      document.description,
      'A document has the members title, summary, nodes (at least one) and edges, the relationships between its nodes; a document without relationships may leave edges out or give an empty list.',
    )
    assert.deepEqual(document.required, ['title', 'summary', 'nodes'])
  } finally {
    await harness.close()
  }
})

/** Tracks one more file in the Git root of {@link repositoryProtocolHarness}, so a test can read a source of its own shape through the tools. @example await trackSource(harness.directory, 'form.ts', 'const a = 1\n') */
async function trackSource(
  directory: string,
  path: string,
  text: string,
): Promise<void> {
  await writeFile(join(directory, path), text)
  await executeFile('git', ['add', '--', path], { cwd: directory })
}

// Value: protects=an agent taking the line of a citation or a stop from the source answer instead of counting by hand, in a chat that gives its model only the content (Cursor) and in one that gives it only the structured result (VS Code, Claude Code); fails_when=either channel of codebook_source answers no numbered copy, numbers a blank line or the last line without a line end wrongly, or carries an unnumbered copy of the lines beside it; why_new=Cycle 0045 N14c-13 (DX-1 b): the VS Code agent counted lines by hand and declared every stop one line too high, one of them on a blank line, which refused its start; Cycle 0046 row 6: the unnumbered copy doubled the answer; seam=none
test('codebook_source answers each line once, after its one-based number, in the content and in the structured result, a blank line and a last line without a line end included', async () => {
  // Arrange: line 2 is blank and line 3 has no line end.
  const harness = await repositoryProtocolHarness()
  try {
    await trackSource(
      harness.directory,
      'form.ts',
      'const email = read()\n\nexport const user = find(email)',
    )

    // Act
    const answer = await harness.client.callTool({
      name: 'codebook_source',
      arguments: { instanceId: harness.service.instanceId, path: 'form.ts' },
    })

    // Assert
    const structured = z
      .object({
        data: z.strictObject({
          instanceId: z.string(),
          path: z.string(),
          hash: z.string(),
          lineCount: z.number(),
          numberedText: z.string(),
        }),
      })
      .parse(answer.structuredContent).data
    assert.deepEqual(
      {
        lineCount: structured.lineCount,
        numberedText: structured.numberedText,
      },
      {
        lineCount: 3,
        numberedText:
          '1\tconst email = read()\n2\t\n3\texport const user = find(email)',
      },
    )
    assert.deepEqual(JSON.parse(toolText(answer)), structured)
  } finally {
    await harness.close()
  }
})

// Value: protects=the room an agent's context has for a source answer: the numbered lines may cost their numbers, not a second copy of every line; fails_when=codebook_source answers the lines twice in a channel (the unnumbered text beside numberedText), which made a source answer about twice as long; why_new=Cycle 0045 delegated review of the last changes, finding 7 (row 6 of Cycle 0046); seam=none
test('a codebook_source answer for a file of 300 lines of 80 columns is at most 1.3 times the size of the answer that gave the same lines unnumbered as text', async () => {
  // Arrange: 300 lines, each exactly 80 characters long.
  const harness = await repositoryProtocolHarness()
  try {
    const lines = Array.from({ length: 300 }, (_, index) => {
      const head = `const line${String(index + 1).padStart(3, '0')} = '`
      return `${head}${'x'.repeat(80 - head.length - 1)}'`
    })
    const sourceText = `${lines.join('\n')}\n`
    await trackSource(harness.directory, 'wide.ts', sourceText)

    // Act
    const answer = await harness.client.callTool({
      name: 'codebook_source',
      arguments: { instanceId: harness.service.instanceId, path: 'wide.ts' },
    })

    // Assert: the comparison answer carries the exact text where the answer carries numberedText, in both channels, as codebook_source answered before numberedText.
    const data = z
      .object({
        data: z.object({
          instanceId: z.string(),
          path: z.string(),
          hash: z.string(),
          lineCount: z.number(),
        }),
      })
      .parse(answer.structuredContent).data
    const unnumberedData = {
      instanceId: data.instanceId,
      path: data.path,
      hash: data.hash,
      text: sourceText,
      lineCount: data.lineCount,
    }
    const answerBytes = Buffer.byteLength(
      JSON.stringify({
        content: answer.content,
        structuredContent: answer.structuredContent,
      }),
    )
    const unnumberedBytes = Buffer.byteLength(
      JSON.stringify({
        content: [{ type: 'text', text: JSON.stringify(unnumberedData) }],
        structuredContent: { ok: true, data: unnumberedData },
      }),
    )
    assert.equal(lines[0], `const line001 = '${'x'.repeat(62)}'`)
    assert.equal(lines[0].length, 80)
    assert.equal(data.lineCount, 301)
    assert.deepEqual(
      { answerBytes, unnumberedBytes },
      { answerBytes: 53_048, unnumberedBytes: 49_937 },
    )
    assert.equal(answerBytes <= unnumberedBytes * 1.3, true)
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent reading, in the tool it calls for source, that the numbered copy is where lines come from; fails_when=the description of codebook_source does not name numberedText or the rule; why_new=Cycle 0045 N14c-13 (DX-1 b); seam=none
test('the description of codebook_source tells an agent to take every citation and stop line from the numbered copy', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const tools = await harness.client.listTools()

    // Assert
    assert.equal(
      tools.tools.find((tool) => tool.name === 'codebook_source')?.description,
      "Read a tracked UTF-8 source with its full-byte hash and line count. numberedText gives the source's lines once, each after its one-based number and a tab: take the line of every citation and every stop from it instead of counting lines. Use that path/hash and inclusive line ranges as article citations. Does not execute or navigate.",
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that reads the help before it cites lines or declares a stop learning to take lines from the numbered copy; fails_when=the source-only help or the repository-browser help no longer says it; why_new=Cycle 0045 N14c-13 (DX-1 b); seam=none
test('the source-only help and the repository-browser help tell an agent to take every citation and stop line from the numbered copy of codebook_source', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const repositoryHelp = await harness.client.callTool({
      name: 'codebook_read_resource',
      arguments: { uri: 'codebook://help/repository' },
    })
    const browserHelp = await harness.client.callTool({
      name: 'codebook_read_resource',
      arguments: { uri: 'codebook://help/repository-browser' },
    })

    // Assert
    const repositoryEntry = z
      .object({ data: z.object({ entry: z.string() }) })
      .parse(repositoryHelp.structuredContent).data.entry
    const sourceBinding = z
      .object({ data: z.object({ sourceBinding: z.string() }) })
      .parse(browserHelp.structuredContent).data.sourceBinding
    assert.equal(
      repositoryEntry.startsWith(
        "Read codebook_status.repository, then codebook_sources and exact codebook_source paths. numberedText gives the source's lines once, each after its one-based number and a tab: take the line of every citation and every stop from it instead of counting lines. Since API 1.7 codebook_source, and codebook_read_resource for a book's cited source, answer the source's lines as numberedText and no longer as text; an MCP resources/read of a cited source's URI still answers its exact text. Author structured plain-text sections,",
      ),
      true,
    )
    assert.equal(
      sourceBinding.startsWith(
        "codebook_source answers the source; numberedText gives the source's lines once, each after its one-based number and a tab: take the line of every citation and every stop from it instead of counting lines. Choose a one-based source line/column for an executable statement",
      ),
      true,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=a client written for API 1.6, which read text from a source answer, learning from the server it connects to that the lines are in numberedText now; fails_when=the server reports another API version than 1.7 while its source answer has no text, or its instructions no longer say what 1.7 changed; why_new=Cycle 0046 row 54: row 6 took text out of both source answers while the server still reported API 1.6, the version that promised both members; seam=none
test('the server reports API 1.7 and its instructions say that codebook_source and a book’s cited source answer numberedText and no longer text', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const instructions = harness.client.getInstructions() ?? ''
    const status = await harness.client.callTool({
      name: 'codebook_status',
      arguments: {},
    })
    const source = await harness.client.callTool({
      name: 'codebook_source',
      arguments: { instanceId: harness.service.instanceId, path: 'module.ts' },
    })

    // Assert: the version, the sentence, and the answer the sentence describes.
    assert.equal(
      z
        .object({ data: z.object({ apiVersion: z.string() }) })
        .parse(status.structuredContent).data.apiVersion,
      '1.7',
    )
    assert.equal(harness.endpoint.descriptor.apiVersion, '1.7')
    assert.equal(
      instructions.startsWith(
        "API 1.7. Call codebook_status first. To learn repository source, discover sources, read exact files, publish structured cited articles and open the retained book; no runtime is required. Since API 1.7 codebook_source, and codebook_read_resource for a book's cited source, answer the source's lines as numberedText and no longer as text; an MCP resources/read of a cited source's URI still answers its exact text. Authored relations are source interpretation.",
      ),
      true,
    )
    assert.deepEqual(
      Object.keys(
        z
          .object({ data: z.record(z.string(), z.unknown()) })
          .parse(source.structuredContent).data,
      ).sort(),
      ['hash', 'instanceId', 'lineCount', 'numberedText', 'path'],
    )
  } finally {
    await harness.close()
  }
})

/**
 * Takes the client example out of the packaged README, so the test below runs the code a reader copies and the README cannot drift from what is tested.
 * A checkout whose Git settings give text files CRLF line ends (the default on Windows) holds the same README with other line ends, so the example is found under either and returned with line feeds.
 * @param readme - The packaged README's text, with LF or CRLF line ends.
 * @returns The JavaScript between the example's `node --input-type=module <<'NODE'` line and its closing `NODE` line, with LF line ends.
 * @throws When the README holds no such example.
 * @example
 * readmeClientExample("```sh\nnode --input-type=module <<'NODE'\nconsole.log(1);\nNODE\n```") // => 'console.log(1);\n'
 * readmeClientExample("```sh\r\nnode --input-type=module <<'NODE'\r\nconsole.log(1);\r\nNODE\r\n```") // => 'console.log(1);\n'
 */
function readmeClientExample(readme: string): string {
  const example =
    /^node --input-type=module <<'NODE'\r?\n([\s\S]*?\r?\n)NODE\r?$/m.exec(
      readme,
    )
  if (!example?.[1]) throw new Error('The README holds no client example.')
  return example[1].replaceAll('\r\n', '\n')
}

// Cycle 0046 (row 164): red while the example was found with a pattern of line feeds alone: in a checkout whose Git settings give the README CRLF line ends, the default on Windows, the test below threw "The README holds no client example."
test('the README’s client example is found and read alike in a checkout with LF and with CRLF line ends', () => {
  // Arrange: one README excerpt, once with the line ends of each kind of checkout.
  const withLineFeeds =
    "Run it:\n\n```sh\nnode --input-type=module <<'NODE'\nconst price = 24;\nconsole.log(price);\nNODE\n```\n"
  const withCarriageReturns = withLineFeeds.replaceAll('\n', '\r\n')
  // Act
  const examples = [
    readmeClientExample(withLineFeeds),
    readmeClientExample(withCarriageReturns),
  ]
  // Assert
  assert.deepEqual(examples, [
    'const price = 24;\nconsole.log(price);\n',
    'const price = 24;\nconsole.log(price);\n',
  ])
})

// Value: protects=a developer who copies the README's source-reading example getting the source instead of a schema error; fails_when=the example's schema no longer matches the codebook_source answer (it threw "Unrecognized key: numberedText" for every source since API 1.6, and expected a text member the answer lost in API 1.7), or the example no longer runs; why_new=Cycle 0046 row 49 (package STA, found while working); seam=none
test('the README’s client example, run as the README says against a tracked file, prints that file’s identity and numbered lines', async () => {
  // Arrange: the example as the packaged README prints it, and the connection descriptor of a running server.
  const harness = await repositoryProtocolHarness()
  const extensionRoot = join(__dirname, '..', '..')
  const connectionPath = join(harness.directory, 'connection.json')
  try {
    const example = readmeClientExample(
      await readFile(join(extensionRoot, 'README.md'), 'utf8'),
    )
    await writeFile(connectionPath, JSON.stringify(harness.endpoint.descriptor))

    // Act: `node --input-type=module` from `extension/`, the example on standard input.
    const run = executeFile(process.execPath, ['--input-type=module'], {
      cwd: extensionRoot,
      env: {
        ...process.env,
        CODEBOOK_CONNECTION: connectionPath,
        CODEBOOK_SOURCE: 'module.ts',
      },
    })
    run.child.stdin?.end(example)
    const { stdout } = await run

    // Assert
    assert.deepEqual(JSON.parse(stdout), {
      instanceId: harness.service.instanceId,
      path: 'module.ts',
      hash: '5e707638ceba927d6f9dbef0ee9935ebc85198b1f6bc55531c8dc64a1e13846b',
      lineCount: 2,
      numberedText: '1\texport const price = 24;\n2\t',
    })
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that reads a book's retained source before it declares a stop on that revision getting the same numbered copy; fails_when=the cited source answers no numbered copy through codebook_read_resource, answers the unnumbered text beside it (the lines twice in each channel), or a plain MCP resource read stops answering the exact bytes alone; why_new=Cycle 0045 N14c-13 (DX-1 b), the other place an agent reads source text before it declares; seam=none
test('a book’s cited source read through codebook_read_resource answers its numbered lines once in place of the exact text, and a resource read keeps the exact bytes alone', async () => {
  // Arrange: a published revision cites a file whose line 2 is blank.
  const harness = await repositoryProtocolHarness()
  try {
    await trackSource(
      harness.directory,
      'form.ts',
      'const email = read()\n\nexport const user = find(email)',
    )
    const source = z.object({ data: z.object({ hash: z.string() }) }).parse(
      (
        await harness.client.callTool({
          name: 'codebook_source',
          arguments: {
            instanceId: harness.service.instanceId,
            path: 'form.ts',
          },
        })
      ).structuredContent,
    ).data
    const published = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: {
        instanceId: harness.service.instanceId,
        bookId: 'form',
        key: 'first',
        expectedRevision: 0,
        document: {
          title: 'Form',
          summary: 'Where the user comes from.',
          nodes: [
            {
              id: 'lookup',
              title: 'Lookup',
              sections: [{ title: 'User', text: 'The form finds the user.' }],
              anchors: [
                {
                  path: 'form.ts',
                  hash: source.hash,
                  startLine: 1,
                  endLine: 3,
                },
              ],
              observations: [],
            },
          ],
        },
      },
    })
    const bookUri = z
      .object({ data: z.object({ uri: z.string() }) })
      .parse(published.structuredContent).data.uri

    // Act
    const throughTool = await harness.client.callTool({
      name: 'codebook_read_resource',
      arguments: { uri: `${bookUri}/sources/0` },
    })
    const throughResource = await harness.client.readResource({
      uri: `${bookUri}/sources/0`,
    })

    // Assert
    assert.deepEqual(throughTool.structuredContent, {
      ok: true,
      uri: `${bookUri}/sources/0`,
      mimeType: 'text/plain',
      numberedText:
        '1\tconst email = read()\n2\t\n3\texport const user = find(email)',
    })
    assert.deepEqual(throughTool.content, [
      {
        type: 'text',
        text: '1\tconst email = read()\n2\t\n3\texport const user = find(email)',
      },
    ])
    assert.deepEqual(throughResource.contents, [
      {
        uri: `${bookUri}/sources/0`,
        mimeType: 'text/plain',
        text: 'const email = read()\n\nexport const user = find(email)',
      },
    ])
  } finally {
    await harness.close()
  }
})

// Value: protects=an agent that put a member of its document beside document learning where it belongs; fails_when=the refusal only says the key is unrecognized, or names no document.<member>; why_new=Cycle 0045 N14c-F1 (DX-1 c): the VS Code agent's first publish gave edges beside document and was answered "Unrecognized key: \"edges\""; seam=none
test('a publish that gives a member of the document beside document is refused with a sentence that says it belongs inside document', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const refused = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: {
        instanceId: harness.service.instanceId,
        bookId: 'price',
        key: 'first',
        expectedRevision: 0,
        document: {
          title: 'Price',
          summary: 'Where the price comes from.',
          nodes: [citedNode('entry')],
        },
        edges: [],
      },
    })

    // Assert
    assert.equal(refused.isError, true)
    assert.equal(
      toolText(refused),
      'MCP error -32602: Input validation error: Invalid arguments for tool codebook_publish_book: edges is a member of the published document, not of the call: give it inside document, as document.edges.',
    )
    await assert.rejects(
      readFile(join(harness.library.directory, 'price.book.v2.json')),
      /ENOENT/,
    )
  } finally {
    await harness.close()
  }
})

// Value: protects=the publish input staying strict for a key that belongs nowhere; fails_when=an unknown key that is no document member is accepted or loses the usual refusal; why_new=Cycle 0045 N14c-F1 (the guard of the new sentence); seam=none
test('a publish with an unknown key that is no member of the document is still refused as an unrecognized key', async () => {
  // Arrange
  const harness = await repositoryProtocolHarness()
  try {
    // Act
    const refused = await harness.client.callTool({
      name: 'codebook_publish_book',
      arguments: {
        instanceId: harness.service.instanceId,
        bookId: 'price',
        key: 'first',
        expectedRevision: 0,
        document: {
          title: 'Price',
          summary: 'Where the price comes from.',
          nodes: [citedNode('entry')],
        },
        draft: true,
      },
    })

    // Assert
    assert.equal(refused.isError, true)
    assert.equal(
      toolText(refused),
      'MCP error -32602: Input validation error: Invalid arguments for tool codebook_publish_book: Unrecognized key: "draft"',
    )
  } finally {
    await harness.close()
  }
})
