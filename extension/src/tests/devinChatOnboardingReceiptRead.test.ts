import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// protects=a moment of descriptor exhaustion at server start does not leave the descriptor of a set-up window unmarked for the whole run; fails_when=the first read gets no answer and the descriptor is published without the mark, so the bridge exits as not set up; no_claim=a receipt that is observed removed, which stays unmarked
test('a Devin Desktop window whose first receipt read at server start gets no answer ends with a marked descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadsWithoutAnswer: 1,
  })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    const isMarked = async (): Promise<boolean> =>
      (await window.readDescriptorField()) === true
    await waitUntil(isMarked, 'the mark after the receipts read answered')
    // Assert
    assert.equal(await window.readDescriptorField(), true)
    assert.equal(await window.readDescriptorInstallation(), 'installation-test')
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a read that never returns at server start does not keep the descriptor from being published: the descriptor appears, unmarked, within the read budget (Cycle 0145 final-range F7); fails_when=the start waits on the first read inside the descriptor queue, so no descriptor is published and a later stop cannot remove it; no_claim=a read that settles after the deadline (it changes nothing, but the test does not observe it)
test('a Devin Desktop window whose receipt read never returns at server start publishes an unmarked descriptor within the budget', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadsHang: true,
  })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=server restarts while the receipt reads hang start the reads once, so they never pile up until the editor's file pool is held (Cycle 0145 last-round O4); fails_when=each start begins two more reads that never return; no_claim=the descriptor's mark (unmarked here)
test('a Devin Desktop window whose receipt reads hang asks for them once however often its server starts', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadsHang: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the first start's connection descriptor",
      15_000,
    )
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    await waitUntil(
      window.descriptorReadable,
      "the second start's connection descriptor",
      15_000,
    )
    // Assert
    assert.equal(window.receiptReadCount(), 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a read that answered nothing just before the deadline is not asked again after the descriptor was published unmarked (Cycle 0145 last-round G9); fails_when=the retry wait outlives the deadline and a second read starts; no_claim=a retry that falls within the budget (the exhaustion test above)
test('a Devin Desktop window starts no receipt read after its unmarked descriptor was published at the deadline', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    // The first read answers nothing 100 ms before the 5 s deadline.
    receiptReadDelaysMs: [4_900],
  })
  try {
    // Act
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // gstack-timing-ok: proving that no read starts after the deadline needs a window past the 500 ms retry wait; a slow runner can only hide the defect, never fail a correct build.
    await delay(1_200)
    // Assert
    assert.equal(window.receiptReadCount(), 1)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a receipt read that never returns does not hold the removal, the descriptor queue or later writes of a window whose saved setup could not be cleared (Cycle 0145 last-round G11); fails_when=the mark decision waits on the read for ever, so the removal never ends; no_claim=the wording of the removal notice
test('a Devin Desktop removal ends and unmarks the descriptor although the receipt read never returns', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    confirmRemoval: true,
    failSetupClear: true,
  }
  const window = await devinWindow(context, options)
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    // The storage stops answering after the start.
    options.receiptReadsHang = true
    // Act
    const removal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!(),
      15_000,
    )
    // Assert
    assert.notEqual(removal, 'still waiting')
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects=a failed re-run of a valid setup whose rollback sync gets one read without an answer keeps the earlier mark and the server's token (Cycle 0145 final-range F12); fails_when=the sync turns the missing answer into not set up, removes the mark and rotates the token, and nothing marks again when the receipts read; no_claim=a receipt observed removed (it unmarks at once, the rotation test above)
test('a failed Devin setup re-run whose rollback sync reads no answer once keeps the earlier setup marked with the same token', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    realServer: true,
    savedSetup: true,
    entryWrite: 'current',
    skillManaged: false,
  }
  let tokenBefore: string | undefined
  let readsBeforeFailure = 0
  options.onSkillCheck = async (): Promise<void> => {
    // The restarted server is marked; the next read of the receipts (the rollback's sync) gets no answer once.
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    tokenBefore = JSON.parse(
      await readFile(await window.descriptorPath(), 'utf8'),
    ).token
    options.receiptReadsWithoutAnswer = 1
    readsBeforeFailure = window.receiptReadCount()
    throw new Error('Injected skill check failure')
  }
  const window = await devinWindow(context, options)
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const descriptorFile = await window.descriptorPath()
    const tokenAfter = JSON.parse(await readFile(descriptorFile, 'utf8')).token
    // Assert
    // The injected failure is what ended the setup.
    assert.equal(setupOutcome, 'Injected skill check failure')
    // The rollback's sync read without an answer (the stand-in used its one), and a retry read followed it.
    assert.equal(options.receiptReadsWithoutAnswer, 0)
    assert.equal(window.receiptReadCount() - readsBeforeFailure >= 2, true)
    assert.equal(await window.readDescriptorField(), true)
    assert.equal(typeof tokenBefore, 'string')
    assert.equal(tokenAfter, tokenBefore)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin re-setup after Stop Agent Server whose own server start read answered after the start budget ends with one Reload Window, its own: the late mark finds the window already marked by the setup and writes and offers nothing (Cycle 0146 review round, ocr-lens1 P3); fails_when=the late mark rewrites the descriptor the setup marked and offers a second Reload Window; no_claim=a late read that settles while the setup still runs (the next test); the setup's server start read reads the real records and waits at its gate until the setup answered
test('a Devin re-setup whose server start read answers after the setup offers only its own Reload Window', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdReceiptReadAt: 2,
  })
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    // Act
    const setupOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      15_000,
    )
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    // Assert
    assert.equal(setupOutcome, 'resolved')
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late mark whose read settles while a Devin re-setup of this window still runs leaves the mark to that setup: it waits for the setup, writes and offers nothing, finds the window marked by the setup once it ended, and the setup ends with one Reload Window, its own (Cycle 0146 review round, ocr-lens1 P3; Cycle 0147 review round W2: the late mark waits for a run of this window instead of ending); fails_when=the late mark marks the descriptor in the middle of the setup, or after it, and offers a second Reload Window; no_claim=a take-back of the setup (the setup succeeds here); the setup's server start read waits at its gate, which the skill check stand-in opens, the stand-in waits until the late mark's continuation reached its own gate and opens that one before the setup goes on
test('a late Devin mark whose read settles while a re-setup still runs leaves the mark to the setup and offers no second reload', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    holdReceiptReadAt: 2,
    holdLateMark: true,
  }
  const window = await devinWindow(context, options)
  let decisionsDuringSetup: unknown[] = []
  try {
    await window.whenReconnected()
    await window.commands.get('codebook.stopAgentServer')!()
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      window.holds.receiptRead.release()
      await waitUntil(
        () => window.holds.lateMark.reachedAtMs(),
        "the late mark's continuation during the setup",
      )
      window.holds.lateMark.release()
      // A file read takes I/O, so the late mark's first step after its gate has run by its answer.
      await window.readDescriptorField()
      decisionsDuringSetup = [...window.lateMarkDecisions]
    }
    // Act
    const setupOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      20_000,
    )
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision once the setup ended",
    )
    // Assert
    assert.equal(setupOutcome, 'resolved')
    assert.deepEqual(decisionsDuringSetup, [])
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.deepEqual(window.notices, [
      {
        severity: 'information',
        message:
          "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
        actions: ['Reload Window'],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})
