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
