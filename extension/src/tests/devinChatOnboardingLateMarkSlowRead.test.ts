import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEVIN_MARK_READ_RETRY_BUDGET_MS } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a late Devin mark whose fresh read is itself still in flight at its own start budget waits for that read too and decides on that read's own answer once it settled (Cycle 0147 task 7), so a window whose storage answers only after two budgets is still marked and offers Reload Window once (/ship pass 1, Codex outside voice 10); fails_when=the late mark takes the fresh read's missed deadline for an unmarked setup, so the window stays unmarked for the rest of its server's run although its setup stands; no_claim=a fresh read that gets no answer at all within its budget (no read is in flight then, and the mark gives up as before) and a stop meanwhile; the first stand-in read waits 5.5 s and then has no answer, the second reads the real records and waits at its gate until the test released it after that read's own budget passed, the later reads are the real ones
test('a late Devin mark whose fresh read also outlasts the start budget marks the window once that read answers and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdReceiptReadAt: 2,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const fieldAtPublication = await window.readDescriptorField()
    const freshReadStartedAtMs = await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      "the late mark's fresh read",
      15_000,
    )
    // The fresh read's own budget is a production deadline; it has to pass before the read answers.
    await waitUntil(
      () =>
        performance.now() - freshReadStartedAtMs >=
        DEVIN_MARK_READ_RETRY_BUDGET_MS + 500,
      "the fresh read's own start budget",
      15_000,
    )
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const fieldAfterLateMark = await window.readDescriptorField()
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(fieldAfterLateMark, true)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a window whose storage answers every records read after the 5-second budget, and whose removal refused before it changed the setup during the start's late mark's first fresh read, is marked once, offers Reload Window once and then reads the records no more while its server runs: the removal-end sync's late mark replaces the start's, so the two never take turns that each make the other's late answer stale (Cycle 0147 review round, W1: OCR lens 1 P1 and CodeRabbit major at extension.ts:1565); fails_when=the start's late mark and the sync's late mark both stay alive, each sees the other's turn between two of its own, both read afresh for as long as the server runs (5-second queue holds that Stop waits behind) and the window is never marked; no_claim=a removal that changed the setup, another window's removal, a read that never answers; the stand-in reads the real records and answers them after 5.5 s, the skill removal stand-in throws before any bytes are read
test("a Devin window whose removal-end sync's records read also answers late during the start's late mark is marked once and then reads nothing more", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    failSkillRemoval: true,
    receiptReadAnswerDelaysMs: Array.from({ length: 10 }, () => 5_500),
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    await waitUntil(
      () => window.receiptReadCount() === 2,
      "the start's late mark's first fresh read",
      15_000,
    )
    const freshReadSeenAtMs = performance.now()
    // Act
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      4_000,
    )
    const removalEndedAfterMs = performance.now() - freshReadSeenAtMs
    const isMarkedInTime = await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      'the late mark',
      25_000,
    ).then(
      () => true,
      () => false,
    )
    const readsAtMark = window.receiptReadCount()
    // The server keeps running through a wait longer than one delayed read, so a read started after the mark would be counted.
    const quietWait = await waitUntil(
      () => window.receiptReadCount() > readsAtMark,
      'a receipts read after the late mark',
      6_000,
    ).then(
      () => 'a read started',
      (error: Error) => error.message,
    )
    const readsAfterQuiet = window.receiptReadCount()
    // Assert
    assert.equal(removalOutcome, 'Injected skill removal failure')
    // The removal ended within the fresh read's own budget, so its sync waited behind that late mark's turn.
    assert.ok(
      removalEndedAfterMs < 4_500,
      `the removal ended ${Math.round(removalEndedAfterMs)} ms after the fresh read started`,
    )
    assert.equal(isMarkedInTime, true)
    // The start's late mark ends at its first turn after the sync, and the sync's own late mark marks.
    assert.deepEqual(window.lateMarkDecisions, [false, true])
    assert.equal(readsAtMark, 4)
    assert.equal(
      quietWait,
      'Timed out waiting for a receipts read after the late mark',
    )
    assert.equal(readsAfterQuiet, 4)
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
