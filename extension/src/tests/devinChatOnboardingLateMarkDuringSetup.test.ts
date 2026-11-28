import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEVIN_MARK_READ_RETRY_BUDGET_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow, postInitialize } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a sync's late mark whose own fresh read answers late while a setup of this window started meanwhile still runs waits for that setup instead of ending: once the setup failed before it wrote anything (its Node check), a fresh read finds the earlier setup standing, the window is marked, the Devin bridge is served again and Reload Window is offered once (Cycle 0147 review round, W2: CodeRabbit majors at extension.ts:1608, minors at :1597 and :1608); fails_when=the late mark ends at the turn that finds the setup running, nothing rewrites the descriptor after that setup failed, and Devin Local stays refused (403) for a setup that stands until the next server start; no_claim=a setup that succeeds (it marks the window itself), a run that never ends, the start's late mark (the same wait, the window load's take-back test); the removal-end sync's read answers its real records after 5.5 s, the late mark's fresh read waits at its gate, the setup's look for an owed take-back waits at its gate, the Node stand-in fails, the skill removal stand-in throws before any bytes are read, the server is the real one
test("a sync's late Devin mark whose fresh read answers while a setup of this window runs waits for that setup and, once it failed before writing anything, serves the Devin bridge again and offers Reload Window once", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    failSkillRemoval: true,
    receiptReadAnswerDelaysMs: [undefined, 5_500],
    holdReceiptReadAt: 3,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    const descriptorFile = await window.descriptorPath()
    const statusBefore = await postInitialize(descriptorFile, true)
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      15_000,
    )
    const freshReadStartedAtMs = await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      "the sync's late mark's fresh read",
      15_000,
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
    // The fresh read's own budget is a production deadline; it has to pass before the read answers, so the late mark waits for that read outside the queue.
    await waitUntil(
      () =>
        performance.now() - freshReadStartedAtMs >=
        DEVIN_MARK_READ_RETRY_BUDGET_MS + 500,
      "the fresh read's own start budget",
      15_000,
    )
    // Act
    // The held read answers the setup standing, as it read it before it waited.
    window.holds.receiptRead.release()
    // A request takes I/O, so the late mark's next step after that answer has run by the time it is answered.
    const statusWhileSetupRuns = await postInitialize(descriptorFile, true)
    const decisionsWhileSetupRuns = [...window.lateMarkDecisions]
    window.holds.owedTakeBackLook.release()
    const setupOutcome = await within(setup, 10_000)
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again once the setup ended',
      8_000,
    ).then(
      () => true,
      () => false,
    )
    // The mark serves the Devin bridge before the bridge's own check after it answers; the decision and its notice follow that check (up to 3 s).
    const isNoticeShown = await waitUntil(
      () =>
        window.notices.some(
          (notice) =>
            notice.message ===
            'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
        ),
      "the late mark's Reload Window notice",
      8_000,
    ).then(
      () => true,
      () => false,
    )
    // Assert
    assert.equal(statusBefore, 200)
    assert.equal(removalOutcome, 'Injected skill removal failure')
    assert.equal(statusWhileSetupRuns, 403)
    assert.equal(
      setupOutcome,
      'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not set up Devin Desktop. Check that setting, then run Codebook: Set Up AI Chat again.',
    )
    assert.equal(isServedAgain, true)
    assert.equal(isNoticeShown, true)
    assert.deepEqual(decisionsWhileSetupRuns, [])
    assert.deepEqual(window.lateMarkDecisions, [true])
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

// Value: protects=a late mark whose fresh read gets no answer for its whole budget (every read fails at once, as while the machine stays out of open files) while no setup, take-back or removal of this window runs ends after that one fresh read: the decision stays pending through that read's whole 5-second budget and comes at its end, before a second budget could end, the window stays unmarked, the Devin bridge refuses it (403), nothing is shown and no read starts afterwards, so the late mark does not hold the descriptor queue for up to 5 s per fresh read for as long as the server runs (Cycle 0148 review round, OCR L1 at extension.ts:1706; Cycle 0148 ship review, structured P2 at this test: the decision's time is measured from the fresh read's first attempt, and the attempts are counted after the server start's read); fails_when=the turn gives way after the empty answer and the late mark reads afresh again and again (no decision, the read count keeps growing), it ends at the fresh read's first failed attempt, or asks once and then only waits for the budget's end, instead of asking again until the budget ends (fewer than two attempts started after the server start's read by the decision), it reads afresh with a second budget before it ends, or it marks the window; no_claim=reads that answer only after their budget (the four-read test), a run of this window during the fresh read (the next test), a read that never answers, the 500 ms spacing of the fresh read's attempts; the server start's read reads the real records and waits at its gate until the test saw the unmarked descriptor, every later read gives no answer at once, the server is the real one
test('a late Devin mark whose fresh read gets no answer for its whole budget while no setup of this window runs ends after that read and leaves the Devin bridge refusing the window', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    holdReceiptReadAt: 1,
    receiptReadsWithoutAnswer: 1_000,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the descriptor the server start published unmarked at its read's deadline",
      15_000,
    )
    const descriptorFile = await window.descriptorPath()
    const fieldAtPublication = await window.readDescriptorField()
    // Act
    // The held read answers the setup standing; the late mark then reads afresh, and every read of that fresh read gives no answer at once, for its whole 5-second budget.
    window.holds.receiptRead.release()
    const decision = await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    ).then(
      () => 'decided',
      (error: Error) => error.message,
    )
    const readsAtDecision = window.receiptReadCount()
    const decidedAtMs = window.lateMarkDecisionTimesMs[0] ?? Number.NaN
    // The second read is the fresh read's first attempt: the first is the server start's, held at its gate.
    const decidedAfterFreshReadMs = Math.round(
      decidedAtMs - (window.receiptReadStartsMs[1] ?? Number.NaN),
    )
    // Every read after the server start's is an attempt of the fresh read; only those started by the decision count.
    const freshAttemptsByDecision = window.receiptReadStartsMs
      .slice(1)
      .filter((startMs) => startMs <= decidedAtMs).length
    // A fresh read asks again every 500 ms, so a read the late mark still started would come within this wait.
    const quietWait = await waitUntil(
      () => window.receiptReadCount() > readsAtDecision,
      'a records read after the late mark ended',
      2_000,
    ).then(
      () => 'a read started',
      (error: Error) => error.message,
    )
    const statusAfterDecision = await postInitialize(descriptorFile, true)
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.equal(decision, 'decided')
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.ok(
      freshAttemptsByDecision >= 2,
      `the late mark's fresh read asked again within its budget before it ended (${freshAttemptsByDecision} attempts after the server start's read)`,
    )
    // The budget's timer fires on the event loop's clock, which can trail `performance.now()` by a few milliseconds, so the lower bound allows 100 ms.
    assert.ok(
      decidedAfterFreshReadMs >= DEVIN_MARK_READ_RETRY_BUDGET_MS - 100,
      `the late mark decided ${decidedAfterFreshReadMs} ms after its fresh read's first attempt, before that read's ${DEVIN_MARK_READ_RETRY_BUDGET_MS} ms budget ended`,
    )
    assert.ok(
      decidedAfterFreshReadMs < 2 * DEVIN_MARK_READ_RETRY_BUDGET_MS,
      `the late mark decided ${decidedAfterFreshReadMs} ms after its fresh read's first attempt, as late as a second ${DEVIN_MARK_READ_RETRY_BUDGET_MS} ms budget`,
    )
    assert.equal(
      quietWait,
      'Timed out waiting for a records read after the late mark ended',
    )
    assert.equal(statusAfterDecision, 403)
    assert.equal(await window.readDescriptorField(), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late mark whose fresh read has no answer for its whole budget while this window's setup runs gives way and marks once that setup failed before writing (Cycle 0148 task 6), reading no records while it waits for that setup (Cycle 0148 ship review); fails_when=the turn ends unmarked on the empty answer, leaving 403 for a standing setup, or a records read starts within 2 s while the late mark waits for the setup after its fresh read's budget ended; no_claim=the bound exit (the next test), a run starting and ending inside the budget, a setup that succeeds; the server start's read reads the real records and waits at its gate until the test saw the unmarked descriptor, every later read gives no answer at once until the test sets their counter to 0, the setup's look for an owed take-back waits at its gate, the Node stand-in fails, the server is the real one
test("a late Devin mark whose fresh read gets no answer for its whole budget while this window's Set Up AI Chat runs waits for that setup and, once it failed at its Node check, serves the Devin bridge again and offers Reload Window once", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    holdReceiptReadAt: 1,
    receiptReadsWithoutAnswer: 1_000,
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
    // The held read answers the setup standing; the late mark then reads afresh, and every read of that fresh read gives no answer at once.
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.receiptReadCount() >= 2,
      "the late mark's fresh read",
      15_000,
    )
    const freshReadSeenAtMs = performance.now()
    // Armed once every earlier look for an owed take-back answered: the next setup waits at its own look, then fails at its Node check, before it writes anything.
    options.holdOwedTakeBackLookAt = window.owedTakeBackReads() + 1
    options.nodeFailure = true
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const lookHeldAtMs = await waitUntil(
      () => window.holds.owedTakeBackLook.reachedAtMs(),
      "the setup's look for an owed take-back",
    )
    // The fresh read's own budget is a production deadline; it ends with no answer while the setup still waits at its look.
    await waitUntil(
      () =>
        performance.now() - freshReadSeenAtMs >=
        DEVIN_MARK_READ_RETRY_BUDGET_MS + 1_000,
      "the end of the fresh read's own budget",
      15_000,
    )
    // Act
    // A request takes I/O, so the late mark's step after its empty answer has run by the time it is answered.
    const statusWhileSetupRuns = await postInitialize(descriptorFile, true)
    const decisionsWhileSetupRuns = [...window.lateMarkDecisions]
    // A late mark that waits for the setup reads no records; a fresh read asks again every 500 ms, so a read the late mark still started while it waits would come within this wait.
    const readsWhileSetupWaits = window.receiptReadCount()
    const quietWhileSetupRuns = await waitUntil(
      () => window.receiptReadCount() > readsWhileSetupWaits,
      'a records read while the late mark waits for the setup',
      2_000,
    ).then(
      () => 'a read started',
      (error: Error) => error.message,
    )
    // Storage answers again; the setup goes on and fails at its Node check.
    options.receiptReadsWithoutAnswer = 0
    window.holds.owedTakeBackLook.release()
    const setupOutcome = await within(setup, 10_000)
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again once the setup ended',
      8_000,
    ).then(
      () => true,
      () => false,
    )
    // The mark serves the Devin bridge before the bridge's own check after it answers; the decision and its notice follow that check (up to 3 s).
    const isNoticeShown = await waitUntil(
      () =>
        window.notices.some(
          (notice) =>
            notice.message ===
            'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
        ),
      "the late mark's Reload Window notice",
      8_000,
    ).then(
      () => true,
      () => false,
    )
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.equal(statusAtPublication, 403)
    assert.ok(
      lookHeldAtMs - freshReadSeenAtMs < 4_000,
      `the setup waited at its look ${lookHeldAtMs - freshReadSeenAtMs} ms after the fresh read was seen`,
    )
    assert.deepEqual(decisionsWhileSetupRuns, [])
    assert.equal(statusWhileSetupRuns, 403)
    assert.equal(
      quietWhileSetupRuns,
      'Timed out waiting for a records read while the late mark waits for the setup',
    )
    assert.equal(
      setupOutcome,
      'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not set up Devin Desktop. Check that setting, then run Codebook: Set Up AI Chat again.',
    )
    assert.equal(isServedAgain, true)
    assert.equal(isNoticeShown, true)
    assert.deepEqual(window.lateMarkDecisions, [true])
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
