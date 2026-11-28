import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEVIN_MARK_READ_RETRY_BUDGET_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  isSetupLockHeld,
  devinWindow,
  postInitialize,
} from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=the bound of three late "no answer" reads gives way to a run of this window, and the valid late answer of the read after it still decides (Cycle 0148 task 6; D5 Codex P1); fails_when=the counter ends the mark while the setup runs, or drops read 5's valid answer, leaving 403; no_claim=the first exit (the test above), the bound with no run (the four-read test), a run after the mark ended; the first three reads each give no answer after 5.5 s, the fourth (the third fresh read) waits at the hung-read gate until the test, once the setup waits at its look and that read's own budget passed, opens it and it gives no answer, the fifth reads the real records and answers them after 5.5 s, the setup's look for an owed take-back waits at its gate, the Node stand-in fails, the server is the real one
test("a late Devin mark whose third fresh read gives no answer while this window's Set Up AI Chat runs waits for that setup and, once it failed at its Node check, marks the window on the late answer of the read after it and offers Reload Window once", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    receiptReadDelaysMs: Array.from({ length: 3 }, () => 5_500),
    receiptReadsHang: true,
    receiptReadAnswerDelaysMs: [
      undefined,
      undefined,
      undefined,
      undefined,
      5_500,
    ],
  }
  const window = await devinWindow(context, options)
  try {
    await waitUntil(
      window.descriptorReadable,
      "the descriptor the server start published unmarked at its read's deadline",
      15_000,
    )
    const descriptorFile = await window.descriptorPath()
    const fieldAtPublication = await window.readDescriptorField()
    const statusAtPublication = await postInitialize(descriptorFile, true)
    // The start's read and the first two fresh reads each give no answer after 5.5 s, so the third fresh read, the fourth read, reaches the hung-read gate about 11 s after the descriptor.
    const thirdFreshReadHeldAtMs = await waitUntil(
      () => window.hungReceiptReadReachedAtMs(),
      "the late mark's third fresh read",
      20_000,
    )
    // Armed once every earlier look for an owed take-back answered: the next setup waits at its own look, then fails at its Node check, before it writes anything.
    options.holdOwedTakeBackLookAt = window.owedTakeBackReads() + 1
    options.nodeFailure = true
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.owedTakeBackLook.reachedAtMs(),
      "the setup's look for an owed take-back",
    )
    // The third fresh read's own budget is a production deadline; that read is still held at it, so the late mark waits for its own answer outside the descriptor queue.
    await waitUntil(
      () =>
        performance.now() - thirdFreshReadHeldAtMs >=
        DEVIN_MARK_READ_RETRY_BUDGET_MS + 1_000,
      "the end of the third fresh read's own budget",
      15_000,
    )
    // Act
    // The third fresh read gives no answer now, while the setup still waits at its look.
    window.releaseHungReceiptReads()
    // A request takes I/O, so the late mark's step after that answer has run by the time it is answered.
    const statusWhileSetupRuns = await postInitialize(descriptorFile, true)
    const decisionsWhileSetupRuns = [...window.lateMarkDecisions]
    const readsWhileSetupRuns = window.receiptReadCount()
    window.holds.owedTakeBackLook.release()
    const setupOutcome = await within(setup, 10_000)
    // The fifth read answers the setup standing only after its own 5-second budget; the turn after it decides on that answer, and the decision follows the bridge's own check after the mark (up to 3 s).
    const decision = await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision once the setup ended",
      15_000,
    ).then(
      () => 'decided',
      (error: Error) => error.message,
    )
    const readsAtDecision = window.receiptReadCount()
    const statusAfterDecision = await postInitialize(descriptorFile, true)
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.equal(statusAtPublication, 403)
    assert.deepEqual(decisionsWhileSetupRuns, [])
    assert.equal(statusWhileSetupRuns, 403)
    assert.equal(readsWhileSetupRuns, 4)
    assert.equal(
      setupOutcome,
      'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not set up Devin Desktop. Check that setting, then run Codebook: Set Up AI Chat again.',
    )
    assert.equal(decision, 'decided')
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(readsAtDecision, 5)
    assert.equal(statusAfterDecision, 200)
    assert.equal(await window.readDescriptorField(), true)
    assert.equal(await window.readDescriptorInstallation(), 'installation-test')
    assert.deepEqual(
      window.notices.filter(
        (notice) =>
          notice.message ===
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
      ),
      [
        {
          severity: 'information',
          message:
            'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
          actions: ['Reload Window'],
        },
      ],
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late mark that waits for this window's removal, whose entry step waits on storage past its 10-second lapse, ends once Stop Agent Server stopped its server: it decides without reading the records while the removal still holds the setup lock, and offers nothing (Cycle 0147 review round, W4: OCR lens 1 P3 at extension.ts:1542); fails_when=the wait ignores the stop and goes on until the removal ends, or the late mark reads the records or marks a stopped server; no_claim=a new start ending the wait (the same check of the running server), the removal's own end and notice; the server start's read waits at its gate, the late mark's continuation waits at its gate until the removal answered at its lapse, the held stand-in entry removal stands for the stalled storage
test("a late Devin mark that waits for this window's removal ends at Stop Agent Server without reading the records while the removal still waits on storage", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    holdReceiptReadAt: 1,
    holdLateMark: true,
    holdEntryRemoval: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      15_000,
    )
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.holds.lateMark.reachedAtMs(),
      "the late mark's continuation while the removal waits",
    )
    window.holds.lateMark.release()
    // A file read takes I/O, so the late mark has begun its wait for the removal by its answer.
    await window.readDescriptorField()
    const decisionsBeforeStop = [...window.lateMarkDecisions]
    const readsBeforeStop = window.receiptReadCount()
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    const decisionAfterStop = await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision after the stop",
      3_000,
    ).then(
      () => 'decided',
      (error: Error) => error.message,
    )
    const isRemovalWaitingAtDecision = await isSetupLockHeld(window.directory)
    const readsAfterDecision = window.receiptReadCount()
    window.holds.entryRemoval.release()
    await waitUntil(
      async () => !(await isSetupLockHeld(window.directory)),
      "the removal's end once its entry step answered",
      5_000,
    )
    // Assert
    assert.equal(removalOutcome, 'resolved')
    assert.deepEqual(decisionsBeforeStop, [])
    assert.equal(decisionAfterStop, 'decided')
    assert.equal(isRemovalWaitingAtDecision, true)
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(readsBeforeStop, 1)
    assert.equal(readsAfterDecision, 1)
    assert.deepEqual(
      window.notices.filter(
        (notice) =>
          notice.message ===
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
      ),
      [],
    )
  } finally {
    await window.loaded.deactivate()
  }
})
