import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'

// Value: protects=a window whose storage answers every records read after the 5-second budget is marked once the late mark's first fresh read answers, with two reads in all, still two 6 s later while its server runs, and offers Reload Window once (Cycle 0147 task 7); fails_when=each late answer is discarded and reads and 5-second queue holds repeat for the whole run, or a read starts after the mark; no_claim=a read that never answers, a read with no answer, another window's removal during the read (test 7c); the stand-in reads the real records and answers them after 5.5 s
test("a Devin Desktop window whose every records read answers after the start budget is marked once the late mark's first fresh read answers, after two reads in all", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadAnswerDelaysMs: Array.from({ length: 6 }, () => 5_500),
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const fieldAtPublication = await window.readDescriptorField()
    // Act
    const isMarkedInTime = await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      'the late mark',
      15_000,
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
    assert.equal(fieldAtPublication, undefined)
    assert.equal(isMarkedInTime, true)
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(readsAtMark, 2)
    assert.equal(
      quietWait,
      'Timed out waiting for a receipts read after the late mark',
    )
    assert.equal(readsAfterQuiet, 2)
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

// Value: protects=a window whose every records read gives no answer, each only after the 5-second budget (a failing disk that answers each read only after 5 seconds), ends its late mark after three fresh reads that gave no answer, four reads in all, stays unmarked, shows nothing and starts no read afterwards while its server runs, so the late mark no longer holds the descriptor queue up to 5 s per read for as long as the server runs (Cycle 0147 final-range CodeRabbit pass, CR13 at extension.ts:1741); fails_when=the late mark reads afresh after every late "no answer" for the whole run (no decision, the read count keeps growing), ends before its third such read, or marks the window; no_claim=a read that never answers (the late mark waits for it outside the queue), a late answer that decides (task 7's test), reads that give no answer within the budget (the read at the budget decides unmarked, unchanged), the in-flight reads of a server stopped meanwhile; the stand-in waits 5.5 s on each read and then answers with no answer
test('a Devin window whose every records read gives no answer after the start budget ends its late mark after three fresh reads and stays unmarked', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: Array.from({ length: 8 }, () => 5_500),
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const fieldAtPublication = await window.readDescriptorField()
    // Act
    const decision = await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      30_000,
    ).then(
      () => 'decided',
      (error: Error) => error.message,
    )
    const readsAtDecision = window.receiptReadCount()
    // Each fresh read started at once after the one before it answered, so a read the late mark still started would come within this wait.
    const quietWait = await waitUntil(
      () => window.receiptReadCount() > readsAtDecision,
      'a records read after the late mark ended',
      2_000,
    ).then(
      () => 'a read started',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(fieldAtPublication, undefined)
    assert.equal(decision, 'decided')
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(readsAtDecision, 4)
    assert.equal(
      quietWait,
      'Timed out waiting for a records read after the late mark ended',
    )
    assert.equal(await window.readDescriptorField(), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})
