import assert from 'node:assert/strict'
import { join } from 'node:path'
import { before, test } from 'node:test'

import { createHarness } from './helpers'
import { openServerRepository } from './utils/nodeServerHistoryFixture'
import { readHistoryFolderText } from './utils/readHistoryFolderText'
import { realProcessStart } from './utils/realProcessStart'
import { debuggerCapture } from './utils/serverRunCapture'
import { startHistoryServerRun } from './utils/startHistoryServerRun'

before(async () => {
  await realProcessStart(process.pid)
})

// protects=a debugger value the capture cut inside the opened workspace root reaches the stored history as a private-root placeholder (the harness storage root, which holds the workspace, is the most general), through the service's own root set; fails_when=the service stops handing the sink its roots and the cut workspace path stays in a history file; no_claim=which placeholder a real install shows and the real debugger's cut
test('a debugger value cut inside the workspace root is stored as a private-root placeholder', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const opened = await openServerRepository(context)
  const { service, record, run } = await startHistoryServerRun(
    harness,
    context,
    { repository: opened.repository },
  )
  const cutWorkspace = service.environment.workspace.slice(0, -3)
  const base = debuggerCapture({ line: 2 })
  const capture = {
    ...base,
    snapshot: {
      ...base.snapshot,
      variables: [
        {
          name: 'cut',
          value: `at ${cutWorkspace}… [truncated]`,
          children: [],
        },
      ],
    },
  }
  await run.sendRequest('k1')

  // Act
  run.history?.stop(100, { declaredStopIndex: 0 }, 1, capture)
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const files = await readHistoryFolderText(
    join(
      opened.learningDirectory,
      'node-servers.v1',
      `${service.instanceId}_${record.id}`,
    ),
  )

  // Assert
  assert.equal(files.includes(cutWorkspace), false)
  assert.equal(files.includes('at <storage>… [truncated]'), true)
})

// protects=a stop with 60 variables makes the service read its private roots no more often than a stop with none (the run's roots are computed once and frozen, so no text pays a realpath read of every workspace folder and the home directory), and the cut value is still hidden; fails_when=the history sink asks the service for its roots per text (60 more reads at this stop); no_claim=the journal's own per-event reads and the cost of one read
test('a stop with many variables reads the private roots once per run, not once per text', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const opened = await openServerRepository(context)
  const { service, record, run } = await startHistoryServerRun(
    harness,
    context,
    { repository: opened.repository },
  )
  let rootsReads = 0
  const read = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(service),
    'causeRoots',
  )?.get
  Object.defineProperty(service, 'causeRoots', {
    get() {
      rootsReads++
      return read?.call(service)
    },
  })
  const cutWorkspace = service.environment.workspace.slice(0, -3)
  const base = debuggerCapture({ line: 2 })
  const capture = {
    ...base,
    snapshot: {
      ...base.snapshot,
      variables: Array.from({ length: 60 }, (_, index) => ({
        name: `v${index}`,
        value: `at ${cutWorkspace}… [truncated]`,
        children: [],
      })),
    },
  }
  await run.sendRequest('k1')
  const readsBeforeStop = rootsReads

  // Act
  run.history?.stop(100, { declaredStopIndex: 0 }, 1, capture)
  const readsAtStop = rootsReads - readsBeforeStop
  run.pauseAt(1)
  run.respond()
  await service.stop({ instanceId: service.instanceId, runId: record.id })
  const files = await readHistoryFolderText(
    join(
      opened.learningDirectory,
      'node-servers.v1',
      `${service.instanceId}_${record.id}`,
    ),
  )

  // Assert
  assert.equal(readsAtStop, 0)
  assert.equal(files.includes(cutWorkspace), false)
  assert.equal(files.includes('at <storage>… [truncated]'), true)
})

// protects=the live journal of a node-server run hides private roots with the run's frozen snapshot, so its output events make the service read its roots no more often than none would, and a workspace path in output still reads as a placeholder; fails_when=the journal's sanitizer asks the service for its roots per event (30 more reads for 30 chunks); no_claim=the cost of one read and the history sink's own reads
test('the live journal reads the private roots once per run, not once per output event', async (context) => {
  // Arrange
  const harness = await createHarness()
  context.after(() => harness.close())
  const opened = await openServerRepository(context)
  const { service, record, run } = await startHistoryServerRun(
    harness,
    context,
    { repository: opened.repository },
  )
  let rootsReads = 0
  const read = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(service),
    'causeRoots',
  )?.get
  Object.defineProperty(service, 'causeRoots', {
    get() {
      rootsReads++
      return read?.call(service)
    },
  })
  const workspace = service.environment.workspace

  // Act
  for (let sequence = 1; sequence <= 30; sequence++)
    run.record('node-server.output', {
      sequence,
      elapsedMs: sequence,
      channel: 'stdout',
      text: `serving ${workspace}/src/server.ts\n`,
    })
  const readsForOutput = rootsReads
  const journalText = JSON.stringify(record.nodeEvents)

  // Assert
  assert.equal(readsForOutput, 0)
  assert.equal(journalText.includes(workspace), false)
  assert.equal(journalText.includes('serving <storage>/src/server.ts'), true)
})
