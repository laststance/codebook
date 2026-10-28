import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ERROR_RECOVERY } from '../errors'

import { readerSeams, workspaceHarness } from './studyWorkspaceHarness'
import { startFakeNodeServerRun } from './utils/startFakeNodeServerRun'

const RECORDING = '$(record) Recording explanation'
const SAVE = 'Save learning replay'

/** The state a draw of the status item shows, as the harness's item received it. */
function drawn(harness: Awaited<ReturnType<typeof workspaceHarness>>) {
  return {
    text: harness.saveStatus.text,
    tooltip: harness.saveStatus.tooltip,
    visible: harness.saveStatus.visible,
    command: structuredClone(harness.saveStatus.command),
  }
}

// protects=D11 and task 12: the one status item says where a server run stands beside its learning replay (Recording explanation with Save while it lives, Recording finished after the stop) and offers the Save command; fails_when=a state's text differs, the item offers no Save or says the run is saved; no_claim=the editor's drawing of the item
test('the status item of a node-server run says where it stands beside Save learning replay', async () => {
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
        ['starting', `${RECORDING} · Server starting · ${SAVE}`],
        ['ready', `${RECORDING} · Listening on :4100 · ${SAVE}`],
        ['paused', `${RECORDING} · Paused at stop 1 of 2 · ${SAVE}`],
        ['learner', `${RECORDING} · Paused by you in the debugger · ${SAVE}`],
        ['responded', `${RECORDING} · Responded 201 · ${SAVE}`],
        ['stopped', `$(save) Recording finished · ${SAVE}`],
      ],
    )
    for (const [, item] of shown) {
      assert.equal(item.visible, true)
      assert.match(JSON.stringify(item.command), /codebook\.saveLearningReplay/)
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
    assert.equal(item.text, `${RECORDING} · Failed: REQUEST_FAILED · ${SAVE}`)
    const firstSentence = ERROR_RECOVERY.REQUEST_FAILED.split('. ')[0] + '.'
    assert.ok(
      item.tooltip.startsWith(`${firstSentence} See Output › Codebook.`),
    )
    assert.match(item.tooltip, /Save learning replay stops this server run/)
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
    assert.equal(
      harness.saveStatus.text,
      `${RECORDING} · Responded 200 · ${SAVE}`,
    )
  } finally {
    await harness.close()
  }
})

// protects=the Save command of a server run that has not sent its request answers that there is nothing to save yet and stops nothing; fails_when=Save stops the run or starts a browser save; no_claim=the question and notices (nodeServerLearningSave tests)
test('Save learning replay of a node-server run before its request says there is nothing to save', async () => {
  // Arrange
  const harness = await workspaceHarness()
  try {
    readerSeams(harness).stopOwnTimer()
    const { record } = await startFakeNodeServerRun(harness)
    // Act
    await harness.reader.saveLearningReplay()
    // Assert
    assert.equal(record.stopped, false)
    assert.ok(
      harness.informationMessages.some(
        (shown) =>
          shown.message ===
          'Nothing to save yet: the server run has not sent its request.',
      ) ||
        harness.informationMessages.some((shown) =>
          /Learning replay unavailable/.test(shown.message),
        ),
    )
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
