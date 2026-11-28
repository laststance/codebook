import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  owedTakeBackRecord,
  leaveOwedTakeBack,
  isSetupLockHeld,
  devinWindow,
  postInitialize,
} from './utils/devinChatOnboardingHarness'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

// Value: protects=a Devin Desktop window whose activation refresh holds the setup lock while its look for an owed take-back never answers still publishes its server's descriptor within 6 seconds of its load, inside the 15 seconds the Devin bridge waits for it, says in the Output that the refresh could not confirm the take-back, and keeps the setup lock until that look ends, refreshing nothing after it (Cycle 0146 /ship final-range pass, CodeRabbit CLI extension.ts:2249); fails_when=the refresh waits for the look without a bound once it holds the lock, so the server never starts while the read hangs and the bridge Devin Local started at the window load gives up, or the lock is released while the look still runs, or the entry is refreshed after the refresh answered; no_claim=a look that answers within the bound (the tests above) and the bridge's own wait (its tests); the stand-in look waits at a gate before it reads the real record, and the lock is the real one
test("a Devin Desktop window whose refresh's look for an owed take-back never answers still publishes its descriptor and keeps the setup lock until the look ends", async (context) => {
  // Arrange
  const loadedAtMs = performance.now()
  const window = await devinWindow(context, {
    savedSetup: true,
    holdOwedTakeBackLookAt: 2,
  })
  try {
    // Act
    const publishedAtMs = await waitUntil(
      async () =>
        (await window.descriptorReadable()) ? performance.now() : undefined,
      "the reconnected server's descriptor while the refresh's look for an owed take-back hangs",
      10_000,
    )
    await window.whenReconnected()
    const isLockHeldWhileLookHangs = await isSetupLockHeld(window.directory)
    window.holds.owedTakeBackLook.release()
    await waitUntil(
      async () => !(await isSetupLockHeld(window.directory)),
      "the setup lock's release once the held look ended",
      5_000,
    )
    // Assert
    const publishedAfterMs = publishedAtMs - loadedAtMs
    assert.ok(
      publishedAfterMs < 6_000,
      `the descriptor was published ${Math.round(publishedAfterMs)} ms after the window loaded`,
    )
    assert.equal(isLockHeldWhileLookHangs, true)
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [
      'Codebook did not refresh its Devin Desktop MCP entry: Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished.',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose activation refresh found no owed take-back and whose rewrite of the entry then never answers (a stalled volume of Devin's MCP config) still publishes its server's descriptor within 6 seconds of its load, inside the 15 seconds the Devin bridge waits for it, says in the Output that the rewrite had not ended, and keeps the setup lock until that rewrite ends (Cycle 0146 /ship last round, outside-voice 5 and adversarial-native 4); fails_when=only the look for an owed take-back is bounded, so the refresh waits for the rewrite without a bound, the server never starts while it hangs and the bridge Devin Local started at the window load gives up, or the lock is released while the rewrite still runs; no_claim=a rewrite that ends within the bound (the refresh tests above), the reads before and after the lock (the skill check, the Node lookup and the setup records' check, which this bound does not cover) and the bridge's own wait (its tests); the held stand-in rewrite waits at its gate until the test releases it, and the lock is the real one
test("a Devin Desktop window whose refresh's rewrite of the entry never answers still publishes its descriptor and keeps the setup lock until the rewrite ends", async (context) => {
  // Arrange
  const loadedAtMs = performance.now()
  const window = await devinWindow(context, {
    savedSetup: true,
    holdRefresh: true,
  })
  try {
    // Act
    const publishedAtMs = await waitUntil(
      async () =>
        (await window.descriptorReadable()) ? performance.now() : undefined,
      "the reconnected server's descriptor while the refresh's rewrite hangs",
      10_000,
    )
    await window.whenReconnected()
    const isLockHeldWhileRewriteHangs = await isSetupLockHeld(window.directory)
    window.releaseRefresh()
    await waitUntil(
      async () => !(await isSetupLockHeld(window.directory)),
      "the setup lock's release once the held rewrite ended",
      5_000,
    )
    // Assert
    const publishedAfterMs = publishedAtMs - loadedAtMs
    assert.ok(
      publishedAfterMs < 6_000,
      `the descriptor was published ${Math.round(publishedAfterMs)} ms after the window loaded`,
    )
    assert.equal(isLockHeldWhileRewriteHangs, true)
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [
      "Codebook did not refresh its Devin Desktop MCP entry: Codebook's rewrite of that entry had not ended after 3 seconds, so this window goes on without waiting for it; the rewrite keeps the setup lock until storage answers, and when it moves the entry, Devin Local starts the moved entry only after you reload this window.",
    ])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose activation refresh found an owed take-back, and whose removal of that failed setup's entry then outlasts the refresh's 3 seconds, reconnects nothing and says in the Output that the take-back has not finished, so it never serves the failed setup's entry that the take-back removes later (Cycle 0146 /ship last round, outside-voice 1 and adversarial-native 3); fails_when=the lapse reads as an ordinary refusal, so the window reconnects while both setup records still stand and starts its server marked for the failed setup; no_claim=a look whose read of the record never answers (the test above: the window still reconnects) and a server started meanwhile (the next tests); the window load's own look waits at its gate, so the refresh's look is the one that finds the real record, and the held stand-in entry removal deletes the receipt as the real one does once released
test("a Devin Desktop window whose refresh's take-back of an owed entry outlasts the refresh's budget reconnects nothing", async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    holdOwedTakeBackLookAt: 1,
    holdEntryRemoval: true,
    removalDeletesReceipt: true,
  })
  try {
    // Act
    const reconnect = await within(window.whenReconnected(), 10_000)
    const stepsWhileRemovalHangs = [...window.steps]
    window.holds.entryRemoval.release()
    await waitUntil(
      async () => !(await isSetupLockHeld(storageDirectory)),
      "the setup lock's release once the refresh's take-back ended",
      5_000,
    )
    // Assert
    assert.equal(reconnect, undefined)
    assert.deepEqual(stepsWhileRemovalHangs, [
      'verify Devin skill',
      'resolve Node',
      'remove MCP entry',
    ])
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'remove MCP entry',
    ])
    assert.deepEqual(window.outputLines, [
      "Codebook is finishing the take-back of a failed Devin Desktop setup that a reload or a closed window stopped: it takes the codebook entry that setup wrote out of Devin Desktop's MCP config.",
      'Codebook did not refresh its Devin Desktop MCP entry or reconnect this window because the take-back of the failed Devin Desktop setup that wrote that entry has not finished; run Codebook: Set Up AI Chat again once storage answers.',
    ])
    assert.equal(await owedTakeBackRecord(storageDirectory), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a server that a Devin Desktop window starts while the take-back of an owed entry at its load still waits on storage (the reconnect gave up on the setup lock that take-back holds) refuses the Devin bridge meanwhile, and once that take-back removed the failed setup's entry and its receipt, the window's descriptor is unmarked and its server still refuses the bridge (Cycle 0146 /ship last round, outside-voice 1 and adversarial-native 3); fails_when=the owed take-back takes no mark off, so the server is marked from the receipts that take-back has not removed yet, and it keeps serving the bridge after the entry is gone; no_claim=a removal that fails (the record stays, and the window then serves as its setup records say) and the refresh's own look (the test above); the refresh's skill check waits at its gate until the load's take-back holds the setup lock, the held stand-in entry removal deletes the receipt as the real one does once released, the server and the lock are the real ones
test("a server started while a window load's take-back of an owed entry waits on storage refuses the Devin bridge and stays unmarked after that take-back", async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    realServer: true,
    holdSkillCheck: true,
    holdEntryRemoval: true,
    removalDeletesReceipt: true,
  })
  try {
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the window load's take-back of the owed entry",
    )
    window.holds.skillCheck.release()
    const reconnect = await within(window.whenReconnected(), 10_000)
    const descriptorFile = await window.descriptorPath()
    // Act
    const statusWhileTakeBackWaits = await postInitialize(descriptorFile, true)
    window.holds.entryRemoval.release()
    await waitUntil(
      async () => !(await isSetupLockHeld(storageDirectory)),
      "the setup lock's release once the load's take-back ended",
      5_000,
    )
    const statusAfterTakeBack = await postInitialize(descriptorFile, true)
    // Assert
    assert.equal(reconnect, undefined)
    assert.equal(window.steps.includes('start server'), true)
    assert.equal(statusWhileTakeBackWaits, 403)
    assert.equal(await window.readDescriptorField(), undefined)
    assert.equal(statusAfterTakeBack, 403)
    assert.equal(await owedTakeBackRecord(storageDirectory), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late mark (the server start's read of the setup records answered after its 5-second deadline) waits for the take-back of an owed entry at the window load that still waits on storage, reading nothing and turning nothing on, so the server keeps refusing the Devin bridge until that take-back's own descriptor step decides; once the take-back ended, the late mark's fresh read finds the failed setup's receipt gone and leaves the window unmarked (Cycle 0146 /ship last round, outside-voice 1; Cycle 0147 review round W2: the late mark waits for a run of this window instead of ending); fails_when=the late mark reads the receipts that take-back has not removed yet and turns the in-memory mark on, so the bridge is served while the failed setup's entry is being taken back, or it marks the window after the take-back removed the receipt; no_claim=a late mark during a setup, its take-back or a removal (their own tests); the refresh's skill check waits at its gate until the load's take-back holds the setup lock, the server start's read of the records waits at its gate after it read them, the late mark's continuation waits at its gate until the test saw it, the held stand-in entry removal deletes the receipt as the real one does once released, the server and the lock are the real ones
test("a late mark during a window load's take-back of an owed entry leaves the server refusing the Devin bridge", async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    realServer: true,
    holdSkillCheck: true,
    holdEntryRemoval: true,
    removalDeletesReceipt: true,
    holdReceiptReadAt: 1,
    holdLateMark: true,
  })
  try {
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the window load's take-back of the owed entry",
    )
    window.holds.skillCheck.release()
    await waitUntil(
      () => window.descriptorReadable(),
      "the descriptor the server start published unmarked at its read's deadline",
      15_000,
    )
    // Act
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.holds.lateMark.reachedAtMs(),
      "the late mark's continuation while the load's take-back waits",
    )
    window.holds.lateMark.release()
    // A late mark that read the records while the take-back waits would start a second read within this bounded wait.
    const readWhileTakeBackWaits = await waitUntil(
      () => window.receiptReadCount() > 1,
      'a receipts read while the take-back waits',
      1_000,
    ).then(
      () => 'a read started',
      (error: Error) => error.message,
    )
    const statusWhileTakeBackWaits = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    const decisionsWhileTakeBackWaits = [...window.lateMarkDecisions]
    window.holds.entryRemoval.release()
    await waitUntil(
      async () => !(await isSetupLockHeld(storageDirectory)),
      "the setup lock's release once the load's take-back ended",
      5_000,
    )
    await waitUntil(
      () => window.lateMarkDecisions.length === 1,
      "the late mark's decision once the load's take-back ended",
    )
    // Assert
    assert.equal(
      readWhileTakeBackWaits,
      'Timed out waiting for a receipts read while the take-back waits',
    )
    assert.equal(statusWhileTakeBackWaits, 403)
    assert.deepEqual(decisionsWhileTakeBackWaits, [])
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed first Devin setup stops serving the Devin bridge as soon as its take-back starts, also while the take-back's entry removal waits on storage (Cycle 0146 task 1a, v2 finding 5); fails_when=the window's mark stays on until the take-back's last step, so the bridge is served for a setup that is being taken back; no_claim=the descriptor file's content; the held stand-in entry removal stands for the stalled storage, the server is the real one
test("a failed first Devin setup's bridge request is refused while its take-back waits on storage", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    failSetupCommit: true,
    holdEntryRemoval: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the take-back's entry removal",
    )
    // Act
    const statusWhileHeld = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.entryRemoval.release()
    const setupOutcome = await within(setup, 15_000)
    // Assert
    assert.equal(statusWhileHeld, 403)
    assert.equal(setupOutcome, 'Injected workspace state commit failure')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a server started by Start Agent Server while a failed Devin setup's take-back still waits on storage after its command answered is not marked from the receipts that held take-back has not removed yet, so it refuses the Devin bridge until the take-back's own descriptor step decides; fails_when=the start's queue turn sets the in-memory mark from its read of the receipts (the take-back is not counted as taking the mark off), so the Devin bridge is served for a setup that is being taken back; why_new=only a removal is covered as the run that takes the mark off at a server start; seam=none; no_claim=the descriptor file's content while the take-back is held (its descriptor step rewrites it later); the earlier setup is put back first, the held stand-in entry removal stands for the stalled storage and deletes the receipt as the real one does, the server is the real one
test("Start Agent Server while a failed setup's take-back waits on storage starts a server that refuses the Devin bridge", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    holdEntryRemoval: true,
    removalDeletesReceipt: true,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    // Armed after the reconnect's own skill check, so the re-run fails after its entry write and takes itself back.
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    const setupOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    await window.commands.get('codebook.stopAgentServer')!()
    // Act
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const statusWhileHeld = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.entryRemoval.release()
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's take-back of this Devin Desktop setup ended now that storage answered, so Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup run again in this window.",
        ),
      "the take-back's end",
    )
    // Assert
    assert.equal(
      setupOutcome,
      "Injected skill check failure Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.equal(startOutcome, 'started')
    assert.equal(statusWhileHeld, 403)
  } finally {
    await window.loaded.deactivate()
  }
})
