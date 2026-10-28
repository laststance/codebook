import assert from 'node:assert/strict'
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test } from 'node:test'

import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import type { NodeServerHistorySink } from '../nodeServerHistorySink'
import { NodeServerHistorySinkImpl } from '../nodeServerHistorySink'
import { createOwnedNodeServerRun } from '../ownedNodeServerRun'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { freeLoopbackPort } from './utils/freeLoopbackPort'
import {
  nodeServerHistoryHeader,
  openServerRepository,
  SERVER_WORKSPACE_KEY,
} from './utils/nodeServerHistoryFixture'
import {
  realNodeServerDependencies,
  untilView,
} from './utils/realNodeServerDependencies'
import { realProcessStart } from './utils/realProcessStart'

before(async () => {
  await realProcessStart(process.pid)
})

/** The test-only HTTP server as compiled beside this test; it never ships. */
const FIXTURE_SERVER = join(__dirname, 'fixtures/node-server/server.js')

// protects=a launched server (a real process under a real inspector) written through the history sink seals a complete history of its request, stop, output and response under 2 MiB, whose bytes are recorded; fails_when=the real run's output, request window, capture or response do not reach the journal in a replayable order, or the history outgrows 2 MiB; no_claim=the editor's DAP binding (the capture here is the test debugger's, given a presentable snapshot) and any other repository
test('a real fixture server run writes a sealed complete history under 2 MiB', async (context) => {
  // Arrange
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-server-history-')),
  )
  context.after(() => rm(workspace, { recursive: true, force: true }))
  const port = await freeLoopbackPort()
  await copyFile(FIXTURE_SERVER, join(workspace, 'server.cjs'))
  await writeFile(
    join(workspace, 'fixture-server.json'),
    JSON.stringify({ mode: 'listen', port, host: '127.0.0.1' }),
  )
  const text = await readFile(join(workspace, 'server.cjs'), 'utf8')
  const line =
    text
      .split('\n')
      .findIndex((row) => row.includes('console.log(`fixture request')) + 1
  assert.ok(line > 0)
  const configuration: NodeServerConfiguration = {
    version: 1,
    adapter: 'node-server',
    book: {
      bookId: 'fixture-api',
      revision: 1,
      nodeId: 'handler',
      anchorIndex: 0,
    },
    packageRoot: '.',
    entry: 'server.cjs',
    loader: 'node',
    port,
    request: { method: 'GET', path: '/health' },
    source: { path: 'server.cjs', hash: sha256(text), line, column: 5 },
    inspections: [{ path: 'requestPath', mode: 'value', required: true }],
    additionalStops: undefined,
  }
  const { repository, learningDirectory } = await openServerRepository(context)
  const header = {
    ...nodeServerHistoryHeader(SERVER_WORKSPACE_KEY, { declaredStops: 1 }),
    declaredStops: [{ path: 'server.cjs', line }],
  }
  const writer = await repository.serverHistories.start(header)
  const sink = new NodeServerHistorySinkImpl({
    writer,
    sanitize: (value) => value,
  })
  // The test debugger reads no frames; the capture is given the snapshot a native session reads, so the history is presentable.
  const history: NodeServerHistorySink = {
    openRequest: (...input) => sink.openRequest(...input),
    withdrawRequest: (...input) => sink.withdrawRequest(...input),
    markRequestSent: (...input) => sink.markRequestSent(...input),
    output: (...input) => sink.output(...input),
    response: (...input) => sink.response(...input),
    failRequest: (...input) => sink.failRequest(...input),
    markCaptureBudgetExhausted: () => sink.markCaptureBudgetExhausted(),
    stop: (at, pause, generation, read) =>
      sink.stop(at, pause, generation, {
        ...read,
        column: 5,
        frameName: 'handler',
        snapshot: {
          version: 1,
          frames: [
            {
              name: 'handler',
              line: read.line,
              column: 5,
              source: {
                name: 'server.cjs',
                text,
                hash: sha256(text),
                line: read.line,
              },
              scopes: [{ name: 'Local', variables: [0] }],
            },
          ],
          variables: [
            {
              name: 'requestPath',
              value: '/health',
              type: 'string',
              children: [],
            },
          ],
          limitations: [],
        },
      }),
  }
  const run = createOwnedNodeServerRun({
    workspace,
    configuration,
    record: () => undefined,
    citedSources: [],
    runId: 'process-run',
    history,
    dependencies: realNodeServerDependencies(
      { executable: process.execPath, version: process.versions.node },
      20_000,
      new Map<string, unknown>(),
    ),
  })
  context.after(() => run.stop().catch(() => undefined))

  // Act
  await run.prepare()
  await run.sendRequest('key-1')
  const paused = await untilView(run, (view) => view.state === 'paused')
  await run.continue(paused.pause!)
  await untilView(run, (view) => view.state === 'responded')
  await run.stop()
  sink.flush()
  await writer.seal({ elapsedMs: 0, reason: 'stopped' })
  const opened = await repository.serverHistories.read(header.studyId)
  const folder = join(learningDirectory, 'node-servers.v1', header.studyId)
  const bytes = (await readdir(folder)).length
    ? (await stat(join(folder, 'events.jsonl'))).size
    : 0

  // Assert
  const types = opened.entries.map((entry) => entry.type)
  assert.equal(
    opened.status,
    'complete',
    opened.seal?.reasons.map((r) => r.text).join(' | '),
  )
  assert.deepEqual(
    types.filter((type) => type !== 'output'),
    ['request', 'request-sent', 'source', 'stop', 'response', 'end'],
  )
  assert.ok(bytes > 0 && bytes < 2 * 1_048_576, `journal bytes ${bytes}`)
  console.log(`fixture server history journal bytes: ${bytes}`)
})
