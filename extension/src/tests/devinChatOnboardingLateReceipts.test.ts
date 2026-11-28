import assert from 'node:assert/strict'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow, postInitialize } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a Devin setup whose first read of the installation id never returns ends 3 seconds after that read started with the retry sentence, and takes back what it saved (the saved setup and the entry it installed), so a stalled disk never holds the setup lock before the commit (Cycle 0146 task 1b); fails_when=the setup waits on that read for ever, or ends without taking the entry and the saved setup back; no_claim=a read that answers late (it is not waited for); a stand-in read held at a gate stands for the stalled disk
test('a Devin setup whose first installation-id read never returns ends within 3 s and takes back what it saved', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    hangFirstInstallationRead: true,
  })
  try {
    // Act
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    const readStartedAtMs = await waitUntil(
      () => window.holds.firstInstallationRead.reachedAtMs(),
      'the first read of the installation id',
    )
    const setupOutcome = await within(setupEnd, 8_000)
    // Assert
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - readStartedAtMs
    assert.ok(
      answeredAfterMs >= 2_900 && answeredAfterMs <= 5_000,
      `the setup answered ${answeredAfterMs} ms after the read started`,
    )
    assert.equal(
      setupOutcome.message,
      'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.',
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.steps.slice(-1), ['remove MCP entry'])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose receipts read at its first server start answers only after the start's 5-second budget publishes its descriptor unmarked, then marks it once that read settled and a fresh read finds the setup standing, and offers Reload Window once (Cycle 0146 task 1c); fails_when=the late answer changes nothing, so the descriptor stays unmarked and Devin Local never connects, or the reload is offered twice; no_claim=a read that is between two retries at the deadline (no read to wait for, unchanged); the stand-in read waits at its gate until the test saw the unmarked descriptor, the next read is the real one
test('a Devin Desktop window whose first receipts read answers after the start budget marks its descriptor then and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 1,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    const fieldAtPublication = await window.readDescriptorField()
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

// Value: protects=after Stop and Start Agent Server, a restarted Devin Desktop server whose receipts read answers only after the start budget is marked once that read settled, and the window offers Reload Window once, although no restart offer came for the unmarked descriptor (Cycle 0146 task 1c); fails_when=the restarted window stays unmarked and offers no reload, or offers two; no_claim=the first start (the test above); the second read waits at its gate until the test saw the unmarked descriptor, the other reads are the real ones
test('a restarted Devin Desktop server whose receipts read answers after the start budget is marked then and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 2,
  })
  try {
    await waitUntil(
      async () =>
        (await window.descriptorReadable()) &&
        (await window.readDescriptorField()) === true,
      "the reconnect's marked descriptor",
    )
    // The first Stop waits for the reconnect's start to end: a Stop while it still starts makes the reconnect answer "did not reconnect", a notice this test does not exercise.
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    const fieldAtRestart = await window.readDescriptorField()
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the restarted server's late mark decision",
      15_000,
    )
    const fieldAfterLateMark = await window.readDescriptorField()
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(fieldAtRestart, undefined)
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

// Value: protects=a late receipts read that saw the setup standing, whose fresh read finds the setup removed (another window removed the entry record meanwhile), leaves the running window unmarked and shows no notice (Cycle 0146 task 1c); fails_when=the late mark trusts the old read, or offers a reload for a removed setup; no_claim=the removal command of this window; the stand-in read reads the installed records, waits at its gate until the test removed the receipt, then answers what it read; the fresh read is the real one, and the decision is read while the server still runs
test('a Devin Desktop window whose late receipts read finds the setup removed stays unmarked and offers nothing', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 1,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      'the late receipts read',
    )
    // Act
    await rm(join(window.directory, 'devin-mcp/receipt.json'))
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const fieldAfterDecision = await window.readDescriptorField()
    // Assert
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(fieldAfterDecision, undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late Devin mark whose descriptor rewrite fails is handled: one Output line says the window could not be marked, the window stays unmarked (its server refuses the Devin bridge, the descriptor carries no mark) and no Reload Window is offered; fails_when=the rejection escapes unhandled, or the window is marked in memory or offered a reload for a descriptor that was never marked; why_new=no test makes the late mark's write fail; seam=none; no_claim=the line's wording past its prefix; the first receipts read waits at its gate until the unmarked descriptor is published, the stand-in rewrite that sets the mark throws, the server is the real one
test('a late Devin mark whose descriptor rewrite fails writes one Output line, stays unmarked and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    holdReceiptReadAt: 1,
    failDescriptorMark: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const statusAfterDecision = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    // Assert
    assert.deepEqual(window.lateMarkDecisions, [
      'Injected descriptor mark failure',
    ])
    assert.equal(
      window.outputLines.filter((line) =>
        line.startsWith(
          'Codebook could not mark this window for Devin Desktop after storage answered late: ',
        ),
      ).length,
      1,
    )
    assert.equal(await window.readDescriptorField(), undefined)
    assert.equal(statusAfterDecision, 403)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late receipts read of a server that was stopped and replaced before the read settled leaves the new server's descriptor and notices as they are: its continuation, held until the new server's marked descriptor was captured, writes nothing (the file keeps its bytes and its inode) and decides `false`, and only the new server's restart offer is shown (Cycle 0146 task 1c; /ship pass 1, specialist testing 2 and Codex structured P2 at this test); fails_when=the late continuation marks or rewrites the new server's descriptor (also with identical bytes, which the rename of a rewrite gives a new inode), offers a second reload, or decides only after the assertions ran; no_claim=the new server's own late read (none here); the stand-in first read waits 5.5 s and then has no answer, the held continuation runs the real one once released, the other reads are the real ones
test("a late receipts read of a replaced Devin Desktop server leaves the new server's mark and notices as they are", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdLateMark: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // The first Stop waits for the reconnect's start to end: a Stop while it still starts makes the reconnect answer "did not reconnect", a notice this test does not exercise.
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    const newDescriptorFile = await window.descriptorPath()
    const newDescriptorText = await readFile(newDescriptorFile, 'utf8')
    const { ino: newDescriptorInode } = await stat(newDescriptorFile, {
      bigint: true,
    })
    await waitUntil(
      () => window.notices.length > 0,
      "the new server's restart offer",
    )
    await waitUntil(
      () => window.holds.lateMark.reachedAtMs(),
      "the first server's late continuation, held before it reads afresh",
    )
    // Act
    window.holds.lateMark.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the first server's late mark decision",
    )
    const descriptorTextAfterDecision = await readFile(
      newDescriptorFile,
      'utf8',
    )
    const { ino: inodeAfterDecision } = await stat(newDescriptorFile, {
      bigint: true,
    })
    // A stop queues behind every descriptor change, so a second offer would be shown before it ends.
    await window.commands.get('codebook.stopAgentServer')!()
    // Assert
    assert.equal(JSON.parse(newDescriptorText).devinChat, true)
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(descriptorTextAfterDecision, newDescriptorText)
    assert.equal(inodeAfterDecision, newDescriptorInode)
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          'Codebook restarted its agent server. Reload this window so Devin Local connects to the new server.',
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late mark whose descriptor write lands after this window's removal took the in-memory mark off leaves the mark off, so the server keeps refusing the Devin bridge while the removal still waits on storage; it then waits for the removal and, once the removal cleared the setup, ends without marking and offers no Reload Window (Cycle 0146 task 17; Cycle 0147 review round W2: the late mark waits for a run of this window instead of ending); fails_when=the late mark turns the in-memory mark back on once its write lands, so the Devin bridge is served for a setup that is being removed, or it marks after the removal; no_claim=the descriptor file while the removal waits (the removal's own unmark rewrites it later) and a take-back that takes the mark off; the late read, the late mark's rewrite and the removal's saved-setup clear wait at gates the test opens, the server is the real one
test("a late Devin mark whose descriptor write lands after this window's removal began keeps refusing the Devin bridge and offers no reload", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdReceiptReadAt: 1,
    holdDescriptorRewrite: true,
    holdSavedSetupWrite: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    window.holds.receiptRead.release()
    const lateRewrite = await within(window.rewriteReached, 15_000)
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the removal's saved-setup clear, after its entry step",
    )
    window.releaseRewrite()
    // The late mark's write has landed once the file carries the mark; its check after the write runs before the request below is answered.
    await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      "the late mark's descriptor write",
    )
    const statusWhileRemoving = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    const decisionsWhileRemoving = [...window.lateMarkDecisions]
    window.holds.savedSetupWrite.release()
    const removalOutcome = await within(removal, 15_000)
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision once the removal ended",
    )
    // Assert
    assert.notEqual(lateRewrite, 'still waiting')
    assert.equal(statusWhileRemoving, 403)
    assert.deepEqual(decisionsWhileRemoving, [])
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(removalOutcome, 'resolved')
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message: `Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from ${window.configPath} and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.`,
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin server start whose mark was decided before this window's removal took the in-memory mark off leaves the mark off once its descriptor is written, so the restarted server refuses the Devin bridge while the removal still waits on storage (Cycle 0146 task 17); fails_when=the start's queue turn sets the in-memory mark from its earlier decision, so the Devin bridge is served for a setup that is being removed; no_claim=the descriptor file while the removal waits (the removal's own unmark rewrites it later); the restart's receipts read reads the installed records and waits until the removal's entry step ran, the removal's saved-setup clear waits at its gate, the server is the real one
test("a Devin server start whose mark was decided before this window's removal took it off keeps refusing the Devin bridge", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    window.armReceiptsHold()
    const restart = window.commands.get('codebook.startAgentServer')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.hasReceiptsReached(),
      "the restart's receipts read",
    )
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the removal's saved-setup clear, after its entry step",
    )
    window.releaseReceipts()
    const restartOutcome = await within(restart, 15_000)
    const statusWhileRemoving = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.savedSetupWrite.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.equal(restartOutcome, 'resolved')
    assert.equal(statusWhileRemoving, 403)
    assert.equal(removalOutcome, 'resolved')
  } finally {
    await window.loaded.deactivate()
  }
})
