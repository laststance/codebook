import assert from 'node:assert/strict'
import { stat } from 'node:fs/promises'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow, postInitialize } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=Devin Local is refused (403) while the removal's saved-setup or descriptor step waits: Remove Devin Desktop Setup takes the window's in-memory mark off right after its entry step, before the steps that wait on storage; fails_when=the in-memory mark stays on until the descriptor step, so a removed entry is still served (200); why_new=the removal hold cases use no real server, and the late-mark and server-start tests get their 403 from other checks; seam=none; no_claim=the descriptor file while the clear waits; the removal's saved-setup clear waits at its gate, the server is the real one
test('a Devin removal whose saved-setup clear waits on storage refuses the Devin bridge once its entry step ended', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      "the reconnect's marked descriptor",
    )
    const statusBeforeRemoval = await postInitialize(
      await window.descriptorPath(),
      true,
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
    const statusWhileClearWaits = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.savedSetupWrite.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.deepEqual([statusBeforeRemoval, statusWhileClearWaits], [200, 403])
    assert.equal(removalOutcome, 'resolved')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=Remove Devin Desktop Setup takes the window's in-memory mark off as soon as it begins, so Devin Local is refused (403) while the removal's entry step still waits on storage, before or after the config change that step makes (/ship pass 1, Codex structured P1 at extension.ts:2074); fails_when=the mark stays on until the entry removal returned, so a connected bridge keeps using the server while the removal takes its entry out of the config; no_claim=the later steps (the saved-setup clear test above) and the descriptor file while the entry step waits; the held stand-in entry removal stands for the stalled storage, the server is the real one
test('a Devin removal whose entry removal waits on storage refuses the Devin bridge while it waits', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdEntryRemoval: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      async () => (await window.readDescriptorField()) === true,
      "the reconnect's marked descriptor",
    )
    const statusBeforeRemoval = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    // Act
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the removal's entry step",
    )
    const statusWhileEntryWaits = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    window.holds.entryRemoval.release()
    const removalOutcome = await within(removal, 15_000)
    // Assert
    assert.deepEqual([statusBeforeRemoval, statusWhileEntryWaits], [200, 403])
    assert.equal(removalOutcome, 'resolved')
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a server started by Start Agent Server while this window's removal waits on storage, whose removal then refuses before it changed the setup (an edited skill), serves the Devin bridge again once the removal ended: the window syncs its mark again from the receipts that still stand (/ship pass 1, native adversarial 1 and Codex outside voice 3); fails_when=the start's queue turn leaves the in-memory mark off for the removal and nothing restores it once the removal ends before its own descriptor step, so Devin Local is refused (403) for a setup that stands until the next restart; no_claim=a removal refused by another window's lock or by a setup's background work (the same end before the descriptor step, not run here) and a Reload Window offer for the restarted server (none while the removal runs); the held stand-in skill removal stands for the stalled storage and then throws, the server is the real one
test('a Devin server started while a removal waits serves the Devin bridge again once that removal refused without changing the setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    holdSkillRemoval: true,
    failSkillRemoval: true,
  })
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    const removal = window.commands.get(
      'codebook.removeManagedDevinSetup',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.skillRemoval.reachedAtMs(),
      "the removal's skill step",
    )
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const descriptorFile = await window.descriptorPath()
    const statusWhileRemoving = await postInitialize(descriptorFile, true)
    // Act
    window.holds.skillRemoval.release()
    const removalOutcome = await within(removal, 15_000)
    // The window's new sync is queued once the removal ended; its read is bounded by the mark read's budget, which this wait outlasts.
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again after the refused removal',
      8_000,
    ).then(
      () => true,
      () => false,
    )
    // Assert
    assert.equal(startOutcome, 'started')
    assert.equal(statusWhileRemoving, 403)
    assert.equal(removalOutcome, 'Injected skill removal failure')
    assert.equal(isServedAgain, true)
    assert.equal(await window.readDescriptorField(), true)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a removal refused before it changed the setup gives the window its mark back also when the sync's records read answers after its 5-second budget: a fresh read finds the setup standing, marks the descriptor, serves the Devin bridge again and offers Reload Window once (Cycle 0147 task 1); fails_when=the sync drops its late read and Devin Local is refused (403, then not set up) for a setup that stands until the next server start; no_claim=an edited skill's real hash check (the stand-in skill removal throws "Injected skill removal failure" before any bytes are read), a read that never answers; the server is the real one, read 2 reads the real records and waits at its gate
test('a Devin removal refused before it changed the setup, whose records read answers after the budget, serves the Devin bridge again and offers Reload Window once', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    failSkillRemoval: true,
    holdReceiptReadAt: 2,
  })
  try {
    await window.whenReconnected()
    const descriptorFile = await window.descriptorPath()
    const statusBefore = await postInitialize(descriptorFile, true)
    // Act
    const outcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      15_000,
    )
    await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      "the removal-end sync's records read",
    )
    await waitUntil(
      async () => (await window.readDescriptorField()) === undefined,
      'the sync publishing unmarked at its deadline',
      8_000,
    )
    const statusWhileUnmarked = await postInitialize(descriptorFile, true)
    window.holds.receiptRead.release()
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again after the late records read',
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
    assert.equal(outcome, 'Injected skill removal failure')
    assert.equal(statusBefore, 200)
    assert.equal(statusWhileUnmarked, 403)
    assert.equal(isServedAgain, true)
    assert.equal(isNoticeShown, true)
    assert.equal(await window.readDescriptorField(), true)
    assert.equal(await window.readDescriptorInstallation(), 'installation-test')
    assert.deepEqual(window.lateMarkDecisions, [true])
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

// Value: protects=a failed re-run of a setup that still stands, whose take-back's records read answers after the 5-second budget, serves that setup again once the setup ended: the late mark, handed over before the take-back's rewrite, reaches its check while that rewrite and so the setup still wait, decides nothing then, waits for the run that ran the sync, then a fresh read marks the descriptor, the server answers 200 and Reload Window is offered once (Cycle 0147 task 1, Codex T1-F1; review round W3: CodeRabbit at devinChatOnboarding.test.ts:5053); fails_when=the late mark gives way to the setup that ran the sync and ends (a decision while the setup's rewrite still waits, or none that marks after it), or none is scheduled, so the window stays unmarked (403, token rotated) while its setup stands; no_claim=a take-back of a first setup (its records go, nothing to mark), a run that never settles; the final skill check stand-in throws once, the take-back sync's read reads the real records and waits at its gate, the late mark's continuation waits at its gate until the test saw it during the setup, the held unmark write then runs the real one, the server is the real one
test('a failed re-run of a standing Devin setup whose take-back records read answers late serves the Devin bridge again once the setup ended and offers Reload Window once', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    realServer: true,
    entryWrite: 'current',
    holdDescriptorUnmark: true,
    holdLateMark: true,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    const descriptorFile = await window.descriptorPath()
    const statusBefore = await postInitialize(descriptorFile, true)
    // Armed after the reconnect's own skill check: the re-run's final skill check fails, and the take-back sync's records read, the next one, waits at its gate.
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      options.holdReceiptReadAt = window.receiptReadCount() + 1
      throw new Error('Injected skill check failure')
    }
    // Act
    let hasSetupEnded = false
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    void setup.then(() => {
      hasSetupEnded = true
    })
    await waitUntil(
      () => window.holds.descriptorUnmark.reachedAtMs(),
      "the take-back sync's unmark at its read's deadline",
      8_000,
    )
    const statusWhileUnmarked = await postInitialize(descriptorFile, true)
    // The late answer comes while the setup still holds its take-back's descriptor step.
    window.holds.receiptRead.release()
    // The sync handed its late read over before its rewrite, so the late mark's continuation comes while that rewrite, the setup's take-back step, still waits.
    await waitUntil(
      () => window.holds.lateMark.reachedAtMs(),
      "the late mark's continuation while the setup's rewrite waits",
    )
    window.holds.lateMark.release()
    // A request takes I/O, so the late mark's check after its gate has run by its answer, while the setup still waits at the rewrite.
    const statusWhileSetupRuns = await postInitialize(descriptorFile, true)
    const decisionsWhileSetupRuns = [...window.lateMarkDecisions]
    const hadSetupEndedAtCheck = hasSetupEnded
    window.holds.descriptorUnmark.release()
    const setupOutcome = await within(setup, 10_000)
    // The unmark rotated the token; each request reads the descriptor's current one.
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again once the failed setup ended',
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
    assert.equal(statusWhileUnmarked, 403)
    assert.equal(statusWhileSetupRuns, 403)
    assert.equal(hadSetupEndedAtCheck, false)
    assert.deepEqual(decisionsWhileSetupRuns, [])
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.equal(isServedAgain, true)
    assert.equal(isNoticeShown, true)
    assert.equal(await window.readDescriptorInstallation(), 'installation-test')
    assert.deepEqual(window.lateMarkDecisions, [true])
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

// Value: protects=a sync whose read answered late and whose unmark rewrite then failed still hands that read to a late mark: once storage answers, a fresh read marks the descriptor (a new file), the server answers 200 and Reload Window is offered once, while the rewrite's own failure still reaches the Output (Cycle 0147 task 1, Codex T1-F2); fails_when=the failed rewrite drops the late mark and the window answers 403 for a setup that stands until the next start, or the failure is swallowed; no_claim=a failed rewrite after a timely read (no late read; unchanged); every unmark rewrite of the stand-in throws "Injected descriptor unmark failure" (the late mark writes a mark, which is the real one), the skill removal stand-in throws before any bytes
test('a Devin removal refused before it changed the setup serves the Devin bridge again after a late records read also when its descriptor rewrite failed', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    failSkillRemoval: true,
    failDescriptorUnmark: true,
    holdReceiptReadAt: 2,
  })
  try {
    await window.whenReconnected()
    const descriptorFile = await window.descriptorPath()
    // Act
    const outcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      15_000,
    )
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook could not update this window's connection descriptor: Injected descriptor unmark failure",
        ),
      "the sync's failed unmark in the Output",
      8_000,
    )
    const statusWhileUnmarked = await postInitialize(descriptorFile, true)
    const inodeBefore = (await stat(descriptorFile)).ino
    window.holds.receiptRead.release()
    const isServedAgain = await waitUntil(
      async () => (await postInitialize(descriptorFile, true)) === 200,
      'the Devin bridge served again after the late records read',
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
    const inodeAfter = (await stat(descriptorFile)).ino
    // Assert
    assert.equal(outcome, 'Injected skill removal failure')
    assert.equal(
      window.outputLines.filter(
        (line) =>
          line ===
          "Codebook could not update this window's connection descriptor: Injected descriptor unmark failure",
      ).length,
      1,
    )
    assert.equal(statusWhileUnmarked, 403)
    assert.equal(isServedAgain, true)
    assert.equal(isNoticeShown, true)
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.notEqual(inodeAfter, inodeBefore)
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

// Value: protects=a server started by Stop and Start Agent Server in the first seconds of a failed setup's take-back, before that take-back's command answered, refuses the Devin bridge and offers no Reload Window, although the earlier setup was put back first and the receipts the take-back is removing still stand (/ship pass 1, Codex outside voice 3 and Codex structured P1 at extension.ts:1380); fails_when=only a take-back whose command already answered counts as taking the mark off, so the start marks the window from those receipts and the Devin bridge is served (200) for an entry that is being taken back, or the restart offers a reload for it; no_claim=a start after the take-back's 10-second lapse (the Start Agent Server test above) and the descriptor file while the take-back is held (its descriptor step rewrites it later); the held stand-in entry removal stands for the stalled storage and deletes the receipt as the real one does, the server is the real one
test("Stop and Start Agent Server in a failed setup take-back's first seconds start a server that refuses the Devin bridge and offers no reload", async (context) => {
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
    let hasSetupAnswered = false
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    void setup.then(() => {
      hasSetupAnswered = true
    })
    await waitUntil(
      () => window.holds.entryRemoval.reachedAtMs(),
      "the take-back's entry removal",
    )
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const statusWhileTakingBack = await postInitialize(
      await window.descriptorPath(),
      true,
    )
    const hadSetupAnsweredAtRequest = hasSetupAnswered
    window.holds.entryRemoval.release()
    const setupOutcome = await within(setup, 15_000)
    // Assert
    assert.equal(startOutcome, 'started')
    assert.equal(hadSetupAnsweredAtRequest, false)
    assert.equal(statusWhileTakingBack, 403)
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})
