import assert from 'node:assert/strict'
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { StudyError } from '../errors'
import type { NodeServerConfiguration } from '../nodeServerConfigSchemas'
import { createOwnedNodeServerRun } from '../ownedNodeServerRun'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { isProcessGroupGone } from '../utils/isProcessGroupGone'
import { readNodeServerOrphanRecords } from '../utils/nodeServerOrphanRecords'

import { freeLoopbackPort } from './utils/freeLoopbackPort'
import {
  accepts,
  realNodeServerDependencies,
  untilView,
} from './utils/realNodeServerDependencies'

/** The test-only HTTP server as compiled beside this test; it never ships. */
const FIXTURE_SERVER = join(__dirname, 'fixtures/node-server/server.js')

/** Builds a run of the fixture server in a new repository folder; the folder and every process are cleaned up after the test. */
async function fixtureRun(
  t: TestContext,
  options: { mode: string; giveUpMs?: number; requestPath?: string },
) {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-node-server-run-')),
  )
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const port = await freeLoopbackPort()
  await copyFile(FIXTURE_SERVER, join(workspace, 'server.cjs'))
  await writeFile(
    join(workspace, 'fixture-server.json'),
    JSON.stringify({ mode: options.mode, port, host: '127.0.0.1' }),
  )
  const text = await readFile(join(workspace, 'server.cjs'), 'utf8')
  // The stop is the fixture handler's logging line, where `requestPath` is a readable local.
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
    request: { method: 'GET', path: options.requestPath ?? '/health' },
    source: { path: 'server.cjs', hash: sha256(text), line, column: 5 },
    inspections: [{ path: 'requestPath', mode: 'value', required: true }],
    additionalStops: undefined,
  }
  const events: Array<{ type: string; detail: unknown }> = []
  const orphanStore = new Map<string, unknown>()
  let launchedPid: number | undefined
  const run = createOwnedNodeServerRun({
    workspace,
    configuration,
    record: (type, detail) => {
      events.push({ type, detail })
      if (
        type === 'node-server.started' &&
        detail &&
        typeof detail === 'object'
      )
        launchedPid = Reflect.get(detail, 'pid')
    },
    citedSources: [],
    runId: 'process-run',
    dependencies: realNodeServerDependencies(
      { executable: process.execPath, version: process.versions.node },
      options.giveUpMs ?? 20_000,
      orphanStore,
    ),
  })
  // A failed test still ends the server it started.
  t.after(() => run.stop().catch(() => undefined))
  return { run, port, events, workspace, orphanStore, pid: () => launchedPid }
}

// protects=the full loop against a real process: start, ready, the request pauses in the handler with a readable local, continue, the response, stop with the group and port freed; fails_when=any step of the loop fails or a process or the port is left; no_claim=the DAP binding and pwa-node attach (a direct inspector connection stands in)
test('a real server runs the loop: ready, paused in its handler with a readable local, response observed, stopped with the port and group free', async (t) => {
  // Arrange
  const { run, port, pid, orphanStore } = await fixtureRun(t, {
    mode: 'listen',
  })
  // Act
  await run.prepare()
  const ready = run.view()
  await run.sendRequest('key-1')
  const paused = await untilView(run, (view) => view.state === 'paused')
  assert.ok(paused.pause)
  await run.continue(paused.pause)
  const answered = await untilView(run, (view) => view.state === 'responded')
  const group = pid()!
  const recordedWhileRunning = readNodeServerOrphanRecords({
    get: (key) => orphanStore.get(key),
    update: async () => undefined,
  }).map((record) => record.pid)
  await run.stop()
  // Assert
  assert.equal(ready.state, 'ready')
  assert.deepEqual(ready.address, { host: '127.0.0.1', port })
  assert.equal(paused.captures[0]?.facts['value:requestPath'], '/health')
  assert.deepEqual(paused.stopsReached, [0])
  assert.equal(answered.response?.status, 200)
  assert.equal(answered.response?.body, '{"status":"ok"}')
  assert.equal(run.view().state, 'stopped')
  assert.equal(isProcessGroupGone(group), true)
  assert.equal(await accepts(port), false)
  assert.deepEqual(recordedWhileRunning, [group])
  assert.deepEqual(
    readNodeServerOrphanRecords({
      get: (key) => orphanStore.get(key),
      update: async () => undefined,
    }),
    [],
  )
})

// protects=D14 against a real process: stopping while paused in the handler kills the group first, so the handler's next line never runs; fails_when=the paused handler runs on (its log line appears) or the group or port stays; no_claim=a database write after the stop
test('stopping a real server while it is paused in the handler never lets the handler run on', async (t) => {
  // Arrange
  const { run, port, events, pid } = await fixtureRun(t, { mode: 'listen' })
  await run.prepare()
  await run.sendRequest('key-1')
  await untilView(run, (view) => view.state === 'paused')
  const group = pid()!
  // Act
  await run.stop()
  // Assert
  assert.equal(isProcessGroupGone(group), true)
  assert.equal(await accepts(port), false)
  const printed = events
    .filter((event) => event.type === 'node-server.output')
    .map((event) => JSON.stringify(event.detail))
    .join('')
  assert.doesNotMatch(printed, /fixture request GET/)
  assert.equal(run.view().state, 'stopped')
})

// protects=a server that exits before it listens ends the start with SERVER_EXITED, its exit code and last output, and nothing is left; fails_when=another code, a missing output or a process left; no_claim=a server that exits after readiness
test('a real server that exits before it listens fails the start with SERVER_EXITED and leaves nothing running', async (t) => {
  // Arrange
  const { run, port, pid } = await fixtureRun(t, { mode: 'exit-before-listen' })
  // Act
  const error = await run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'SERVER_EXITED')
  assert.match(error.message, /exited with code 3/)
  assert.match(error.message, /fixture cannot start: exit-before-listen/)
  // The seal reads the failure from the run's own view, so a failed start must carry it there.
  assert.equal(run.view().runFailure?.code, 'SERVER_EXITED')
  assert.equal(isProcessGroupGone(pid()!), true)
  assert.equal(await accepts(port), false)
  assert.equal(run.view().state, 'stopped')
})

// protects=a server that never listens ends the start with SERVER_NOT_LISTENING and is closed; fails_when=the run waits on or leaves the process; no_claim=the real 30 s budget (a stand-in readiness gives up early)
test('a real server that never listens fails the start with SERVER_NOT_LISTENING and is closed', async (t) => {
  // Arrange
  const { run, port, pid } = await fixtureRun(t, {
    mode: 'never-listen',
    giveUpMs: 400,
  })
  // Act
  const error = await run.prepare().then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  // Assert
  assert.ok(error instanceof StudyError)
  assert.equal(error.code, 'SERVER_NOT_LISTENING')
  assert.match(error.message, new RegExp(`declared port ${port}`))
  // The seal reads the failure from the run's own view, so a failed start must carry it there.
  assert.equal(run.view().runFailure?.code, 'SERVER_NOT_LISTENING')
  assert.equal(isProcessGroupGone(pid()!), true)
})

// protects=the run's clock stops at the Stop, so a seal delayed or retried after it still writes the Stop's own end time; fails_when=elapsedSinceLaunchMs keeps counting after the run stopped; no_claim=the end entry written by the service (its own test)
test('a stopped real server reports the same time since launch however late it is asked', async (t) => {
  // Arrange
  const { run } = await fixtureRun(t, { mode: 'listen' })
  await run.prepare()
  const beforeStop = run.elapsedSinceLaunchMs()
  await run.stop()
  const atStop = run.elapsedSinceLaunchMs()

  // Act
  // gstack-timing-ok: real elapsed time must pass for a live clock to differ from the frozen one
  await new Promise((resolve) => setTimeout(resolve, 150))
  const later = run.elapsedSinceLaunchMs()

  // Assert
  assert.ok(atStop >= beforeStop)
  assert.equal(later, atStop)
})

// Value: protects=the run hands its workspace to the launcher as a private root, so a server that prints its own folder split over two writes leaves the folder in no output event the run records; fails_when=ownedNodeServerRun stops passing privateRoots to launchNodeServer (or the launcher drops it) and a split root reaches the events; why_new=captureProcessOutput is tested with roots only at the unit level, nothing proves the production wiring; seam=none; no_claim=the history files (their own tests) and roots of a shape hidePrivateRoots does not know
test('a real server printing its workspace split over two writes leaves the workspace in no recorded output event', async (t) => {
  // Arrange
  const { run, events, workspace } = await fixtureRun(t, {
    mode: 'listen',
    requestPath: '/log-root',
  })
  await run.prepare()
  // Act
  await run.sendRequest('key-root')
  const paused = await untilView(run, (view) => view.state === 'paused')
  assert.ok(paused.pause)
  await run.continue(paused.pause)
  await untilView(run, (view) => view.state === 'responded')
  await run.stop()
  const printed = events
    .filter((event) => event.type === 'node-server.output')
    .map((event) => String(Reflect.get(event.detail as object, 'text')))
    .join('')
  // Assert
  assert.match(printed, /fixture cwd <workspace>\/src\/server\.ts/)
  assert.equal(printed.includes(workspace), false)
})
