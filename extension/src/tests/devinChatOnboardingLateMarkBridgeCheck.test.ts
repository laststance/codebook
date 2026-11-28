import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { checkDevinBridgeReceipts } from '../utils/checkDevinBridgeReceipts'

import { devinWindow, postInitialize } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a late mark's own late answer is not trusted across this window's finished removal: the decision reads the records again, finds the entry record removed, leaves the window unmarked (403) and offers nothing (Cycle 0147 task 7); fails_when=the late mark decides on the answer read before the removal and marks a removed setup; no_claim=a removal still running at the decision (the take-off decides then), another window's removal (test 7c); failSetupClear keeps the saved setup so only the turn check decides, the stand-in entry removal deletes the receipt as the real one does, the first read answers no answer after 5.5 s, the second reads the real records and waits at its gate
test("a late Devin mark whose slow fresh read answered across this window's removal reads the records again and leaves the window unmarked", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    realServer: true,
    confirmRemoval: true,
    failSetupClear: true,
    removalDeletesReceipt: true,
    receiptReadDelaysMs: [5_500],
    holdReceiptReadAt: 2,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
      15_000,
    )
    await waitUntil(
      () => window.holds.receiptRead.reachedAtMs(),
      "the late mark's fresh read",
      15_000,
    )
    // Act
    // The command answers once its descriptor unmark ran, a queue turn after the late mark's turn ended at its own deadline.
    const removal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    const readsBeforeRelease = window.receiptReadCount()
    // The held read answers the setup standing with installation-test, as it read it before the receipt was deleted.
    window.holds.receiptRead.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const readsAtDecision = window.receiptReadCount()
    const status = await postInitialize(await window.descriptorPath(), true)
    // Assert
    assert.equal(removal, 'resolved')
    assert.equal(readsBeforeRelease, 2)
    assert.deepEqual(window.lateMarkDecisions, [false])
    assert.equal(readsAtDecision, readsBeforeRelease + 1)
    assert.equal(await window.readDescriptorField(), undefined)
    assert.equal(status, 403)
    assert.equal(
      window.notices.some(
        (notice) =>
          notice.message ===
          'Codebook marked this window for Devin Desktop after storage answered late. Reload this window so Devin Local connects.',
      ),
      false,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a window that a late mark marked for a setup another window removed meanwhile is refused by the bridge's own check of both records (removed, naming the missing entry record), so Devin Local opens no session on a removed setup, and its one notice names Codebook: Set Up AI Chat without a Reload Window button, because a reload starts a bridge that refuses the removed setup; the stale mark itself is the designed state of any window marked before another window's removal (Cycle 0147 task 7, D13; ship pass 1, Codex structured P2 at extension.ts:1736); fails_when=the check stands for that descriptor, the late mark names another installation than its read found, or the notice still says a reload connects Devin Local; no_claim=a bridge check that has no answer within its 3 s bound (the reload is offered then), a new setup in another window (the stand-in entry write reuses one installation id), the real removal's skill deletion; both windows share one extension host and storage folder, the second read of the first window reads the real records and waits at its gate
test("another window's removal during a late Devin mark's fresh read leaves Devin Local refused by the bridge's own setup check and names Set Up AI Chat instead of a reload", async (context) => {
  // Arrange
  const first = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdReceiptReadAt: 2,
  })
  try {
    const second = await devinWindow(context, {
      storageDirectory: first.directory,
      instanceLabel: 'second',
      savedSetup: true,
      confirmRemoval: true,
      removalDeletesReceipt: true,
    })
    try {
      await second.whenReconnected()
      const readReachedAtMs = await waitUntil(
        () => first.holds.receiptRead.reachedAtMs(),
        "the first window's fresh read",
        15_000,
      )
      // Act
      const removal = await within(
        second.commands.get('codebook.removeManagedDevinSetup')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        3_000,
      )
      const removalEndedAfterMs = performance.now() - readReachedAtMs
      // The held read answers the setup standing with installation-test, as it read it before the other window's removal.
      first.holds.receiptRead.release()
      await waitUntil(
        () => first.lateMarkDecisions.length > 0,
        "the first window's late mark decision",
        15_000,
      )
      const bridgeAnswer = await checkDevinBridgeReceipts(
        await first.descriptorPath(),
        { installationId: 'installation-test' },
      )
      // Assert
      assert.equal(removal, 'resolved')
      // The removal ended within the fresh read's own budget, so the decision takes the in-turn path that the source before this cycle also takes.
      assert.ok(
        removalEndedAfterMs < 4_500,
        `the removal ended ${Math.round(removalEndedAfterMs)} ms after the fresh read started`,
      )
      assert.deepEqual(first.lateMarkDecisions, [true])
      assert.equal(
        await first.readDescriptorInstallation(),
        'installation-test',
      )
      assert.deepEqual(bridgeAnswer, {
        answer: 'removed',
        reason: 'missing',
        path: join(first.directory, 'devin-mcp/receipt.json'),
      })
      assert.deepEqual(first.notices, [
        {
          severity: 'information',
          message:
            "Codebook checked this window's Devin Desktop setup after storage answered late and found it removed or changed meanwhile (for example from another window), so reloading this window would not connect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
          actions: [],
        },
      ])
    } finally {
      await second.loaded.deactivate()
    }
  } finally {
    await first.loaded.deactivate()
  }
})

// Value: protects=a late Devin mark whose bridge check after the mark waits on storage, and whose server Stop Agent Server stopped meanwhile, shows no Reload Window and no other notice once that check answers, and its stopped server's descriptor stays gone, as README line 95 says of a stop meanwhile (Cycle 0147 ship pass 2, specialist-batched#2 and adversarial-native#5 at extension.ts:1755-1764); fails_when=the late mark's handler trusts its decision across the check (up to 3 s on slow storage, exactly when late marks happen) and shows "Reload this window so Devin Local connects." for a server that no longer runs, or the stopped server's descriptor is written again; no_claim=a check with no answer within its 3 s bound (the window then decides before the stop), a newer late mark of this window or a new start during the check, the stopped server's in-memory record (nothing reads it after its start); the first stand-in read waits 5.5 s and then has no answer, the late mark's fresh read is the real one, the held bridge check reads the real records and answers what it read once the test released it
test('a late Devin mark whose server is stopped while its bridge check waits on storage shows no Reload Window', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdBridgeCheck: true,
  })
  try {
    // The first Stop waits for the reconnect's start to end: a Stop while it still starts makes the reconnect answer "did not reconnect", a notice this test does not exercise.
    await window.whenReconnected()
    await waitUntil(
      () => window.holds.bridgeCheck.reachedAtMs(),
      "the late mark's bridge check, held after it read the records",
      15_000,
    )
    const fieldAtCheck = await window.readDescriptorField()
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    const decisionsAtStopEnd = [...window.lateMarkDecisions]
    window.holds.bridgeCheck.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    // Assert
    assert.equal(fieldAtCheck, true)
    // No decision before the stop ended: the check still waited within its 3 s bound, so its held answer is the one the window decides on.
    assert.deepEqual(decisionsAtStopEnd, [])
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.deepEqual(await window.descriptorNames(), [])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a late Devin mark whose bridge check after the mark waits on storage, while this window's removal is confirmed and ends, leaves the window unmarked and shows only the removal's own notice, no Reload Window of the late mark (Cycle 0147 ship pass 2, adversarial-native#5 at extension.ts:1755-1764); fails_when=the late mark's handler, which sees only a removal that still runs, offers "Reload this window so Devin Local connects." after the removal took the mark off and ended; no_claim=a removal still running when the check answers (the existing removal check shows nothing then), a take-back of a failed setup, another window's removal (the bridge's own check decides that notice); the first stand-in read waits 5.5 s and then has no answer, the late mark's fresh read is the real one, the held bridge check reads the real records and answers what it read once the test released it, the stand-in removals delete nothing
test("a late Devin mark whose bridge check waits on storage while this window's removal ends shows only the removal's notice", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    receiptReadDelaysMs: [5_500],
    holdBridgeCheck: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      () => window.holds.bridgeCheck.reachedAtMs(),
      "the late mark's bridge check, held after it read the records",
      15_000,
    )
    const fieldAtCheck = await window.readDescriptorField()
    // Act
    const removal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      3_000,
    )
    const decisionsAtRemovalEnd = [...window.lateMarkDecisions]
    window.holds.bridgeCheck.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    // Assert
    assert.equal(fieldAtCheck, true)
    assert.equal(removal, 'resolved')
    // No decision before the removal ended: the check still waited within its 3 s bound, so its held answer is the one the window decides on.
    assert.deepEqual(decisionsAtRemovalEnd, [])
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.equal(await window.readDescriptorField(), undefined)
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

// Value: protects=a Set Up AI Chat that succeeds in this window while the late mark's bridge check after its mark still waits on storage ends with only that setup's own notice (its Reload Window), also when that check, read before the setup rewrote the records, answers that another window removed the setup: the late mark's notice speaks for the mark it checked, which the setup's mark and final check replaced (Cycle 0147 final-range CodeRabbit pass, CR8 at extension.ts:1612-1615); fails_when=the late mark's handler, which sees the same server, the same late mark and the mark still on, follows the setup's success with "Run Codebook: Set Up AI Chat to set it up again" (or a second Reload Window) for a setup that now stands; no_claim=a setup still running or failed when the check answers (the late mark's notice then stays, as before), a check with no answer within its 3 s bound (the window then decides before the setup ends), the real removal's skill deletion; both windows share one extension host and storage folder, the first window's second records read reads the real records and waits at its gate, its first bridge check (the late mark's) reads the real records and answers what it read once the test released it, the setup's own final check is the real one
test("a Set Up AI Chat that succeeds while a late Devin mark's bridge check waits on storage is followed by no late-mark notice", async (context) => {
  // Arrange
  const first = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdReceiptReadAt: 2,
    holdBridgeCheckAt: 1,
  })
  try {
    const second = await devinWindow(context, {
      storageDirectory: first.directory,
      instanceLabel: 'second',
      savedSetup: true,
      confirmRemoval: true,
      removalDeletesReceipt: true,
    })
    try {
      await second.whenReconnected()
      await waitUntil(
        () => first.holds.receiptRead.reachedAtMs(),
        "the first window's fresh read",
        15_000,
      )
      const removal = await within(
        second.commands.get('codebook.removeManagedDevinSetup')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        3_000,
      )
      // The held read answers the setup standing, as it read it before the other window's removal; the late mark marks, and its bridge check reads the removed entry record and waits.
      first.holds.receiptRead.release()
      await waitUntil(
        () => first.holds.bridgeCheck.reachedAtMs(),
        "the late mark's bridge check, held after it read the records",
        15_000,
      )
      // Act
      const setup = await within(
        first.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        2_500,
      )
      const decisionsAtSetupEnd = [...first.lateMarkDecisions]
      first.holds.bridgeCheck.release()
      await waitUntil(
        () => first.lateMarkDecisions.length > 0,
        "the late mark's decision",
        15_000,
      )
      // Assert
      assert.equal(removal, 'resolved')
      assert.equal(setup, 'resolved')
      // No decision before the setup ended: the check still waited within its 3 s bound, so its held answer is the one the window decides on.
      assert.deepEqual(decisionsAtSetupEnd, [])
      assert.deepEqual(first.lateMarkDecisions, [true])
      assert.equal(await first.readDescriptorField(), true)
      assert.equal(
        await first.readDescriptorInstallation(),
        'installation-test',
      )
      assert.deepEqual(first.notices, [
        {
          severity: 'information',
          message:
            "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
          actions: ['Reload Window'],
        },
      ])
    } finally {
      await second.loaded.deactivate()
    }
  } finally {
    await first.loaded.deactivate()
  }
})

// Value: protects=a late Devin mark whose bridge check after the mark answers while a Set Up AI Chat of this window, started during that check, still runs offers no Reload Window in the middle of that setup, and the setup's own notice with its Reload Window is the window's only notice once it ends (Cycle 0147 last fix-check, p4n/adversarial-native#2 at extension.ts:1615-1623); fails_when=the late mark's handler, which sees the same server, the same late mark, the mark still on and no setup succeeded yet, offers "Reload this window so Devin Local connects." while the setup still waits on storage, so a press reloads the window in the middle of that setup; no_claim=a setup that then fails without touching the mark (the late mark's notice is then not offered either; the setup's failure speaks), a check with no answer within its 3 s bound (the setup is held past it, so the same decision follows), a setup that succeeds during the check (its own test above); the first stand-in read waits 5.5 s and then has no answer, the late mark's fresh read is the real one, its bridge check (the first) reads the real records and answers what it read once the test released it, the setup's provisional save waits at its gate until the test released it, the setup's own final check is the real one
test("a late Devin mark whose bridge check answers while this window's Set Up AI Chat still runs offers no Reload Window in the middle of that setup", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    receiptReadDelaysMs: [5_500],
    holdBridgeCheckAt: 1,
    holdProvisionalSave: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      () => window.holds.bridgeCheck.reachedAtMs(),
      "the late mark's bridge check, held after it read the records",
      15_000,
    )
    // The setup starts during the check and waits at its provisional save, so it still runs when the check answers.
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.provisionalSave.reachedAtMs(),
      "the setup's held provisional save",
      15_000,
    )
    // Act
    window.holds.bridgeCheck.release()
    await waitUntil(
      () => window.lateMarkDecisions.length > 0,
      "the late mark's decision",
      15_000,
    )
    const noticesWhileSetupRuns = [...window.notices]
    window.holds.provisionalSave.release()
    const setupOutcome = await within(setup, 10_000)
    // Assert
    assert.deepEqual(window.lateMarkDecisions, [true])
    assert.deepEqual(noticesWhileSetupRuns, [])
    assert.equal(setupOutcome, 'resolved')
    assert.equal(await window.readDescriptorField(), true)
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
