import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ERROR_RECOVERY } from '../errors'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { startFakeNodeServerRun } from './utils/startFakeNodeServerRun'

const NO_REPLAY = 'Learning replay is not available for server runs yet'

/** The state a draw of the status item shows, as the harness's item received it. */
function drawn(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return {
    text: harness.saveStatus.text,
    tooltip: harness.saveStatus.tooltip,
    visible: harness.saveStatus.visible,
    command: structuredClone(harness.saveStatus.command),
  }
}

// protects=D11 and task 12: the one status item says where a server run stands with the no-replay sentence beside it, for every state a run reads, with no command and never as saved; fails_when=a state's text differs, the item offers Save or Open replay, or it says the run is saved; no_claim=the editor's drawing of the item
test('the status item of a node-server run says where it stands, always beside "Learning replay is not available for server runs yet"', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { service, record, run } = await startFakeNodeServerRun(harness, {
      holdPrepare: true,
    })
    const shown: [string, ReturnType<typeof drawn>][] = []
    const draw = async (label: string): Promise<void> => {
      await readerSeams(harness).refresh()
      shown.push([label, drawn(harness)])
    }
    // Act
    await draw('starting')
    run.prepareGate.resolve()
    await record.preparation
    await draw('ready')
    await run.enter('paused')
    await draw('paused')
    run.learnerPause('learner')
    await draw('learner')
    run.respond({ status: 201 })
    await draw('responded')
    await service.stop({ instanceId: service.instanceId, runId: record.id })
    await draw('stopped')
    // Assert
    assert.deepEqual(
      shown.map(([label, item]) => [label, item.text]),
      [
        ['starting', `Server starting · ${NO_REPLAY}`],
        ['ready', `Listening on :4100 · ${NO_REPLAY}`],
        ['paused', `Paused at stop 1 of 2 · ${NO_REPLAY}`],
        ['learner', `Paused by you in the debugger · ${NO_REPLAY}`],
        ['responded', `Responded 201 · ${NO_REPLAY}`],
        ['stopped', `Stopped · ${NO_REPLAY}`],
      ],
    )
    for (const [, item] of shown) {
      assert.equal(item.visible, true)
      assert.equal(item.command, undefined)
      assert.match(item.tooltip, /Server runs are not saved yet/)
      assert.doesNotMatch(item.text, /saved|Save|replay is available/i)
    }
  } finally {
    await harness.close()
  }
})

// protects=task 12: a failed run reads Failed: <code> with the first sentence of the code's recovery and a pointer to Output › Codebook in its tooltip; fails_when=the code, the fix sentence or the Output pointer is missing; no_claim=the Output line (service tests)
test('the status item of a failed node-server run names the code and points to Output › Codebook', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { run } = await startFakeNodeServerRun(harness)
    await run.enter('request-failed')
    // Act
    await readerSeams(harness).refresh()
    // Assert
    const item = drawn(harness)
    assert.equal(item.text, `Failed: REQUEST_FAILED · ${NO_REPLAY}`)
    const firstSentence = ERROR_RECOVERY.REQUEST_FAILED.split('. ')[0] + '.'
    assert.ok(
      item.tooltip.startsWith(`${firstSentence} See Output › Codebook.`),
    )
    assert.match(item.tooltip, /Server runs are not saved yet/)
  } finally {
    await harness.close()
  }
})

// protects=task 12: the item of an unchanged server run is not redrawn on each 250 ms refresh; fails_when=every refresh assigns text, tooltip or visibility again; no_claim=the editor's own coalescing
test('a refresh redraws the status item of a node-server run only when it changed', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { run } = await startFakeNodeServerRun(harness)
    await readerSeams(harness).refresh()
    const afterFirst = harness.saveStatus.redraws
    // Act
    await readerSeams(harness).refresh()
    await readerSeams(harness).refresh()
    const afterUnchanged = harness.saveStatus.redraws
    await run.enter('responded')
    await readerSeams(harness).refresh()
    // Assert
    assert.equal(afterUnchanged, afterFirst)
    assert.equal(harness.saveStatus.text, `Responded 200 · ${NO_REPLAY}`)
  } finally {
    await harness.close()
  }
})

// protects=task 12: the Save command refuses a server run, since nothing of it is saved; fails_when=Save starts a seal or a browser save for a server run; no_claim=none
test('Save learning replay refuses a node-server run', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    await startFakeNodeServerRun(harness)
    // Act / Assert
    await assert.rejects(harness.reader.saveLearningReplay(), {
      message:
        'Server runs are not saved yet: there is no learning replay to save.',
    })
  } finally {
    await harness.close()
  }
})

// protects=a server run is no browser Study: the reader maps it to no live profile and a refresh with its Study pane closed neither fails nor checkpoints it; fails_when=a refresh throws or saves a server run; no_claim=the pane's rendering
test('the reader treats a node-server run as no live Study and saves nothing of it', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { service, record, run } = await startFakeNodeServerRun(harness)
    await run.enter('paused')
    // Act
    await readerSeams(harness).refresh()
    // Assert
    assert.equal(harness.reader.inspect().view?.liveProfile, undefined)
    assert.equal(service.state(record).historyOutcome.status, 'unavailable')
    assert.equal(harness.reader.inspect().view?.study?.recordingSave, undefined)
  } finally {
    await harness.close()
  }
})
