import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  owedTakeBackRecord,
  leaveOwedTakeBack,
  devinWindow,
  postInitialize,
} from './utils/devinChatOnboardingHarness'
import { removeTestFolder } from './utils/removeTestFolder'
import { within } from './utils/within'

// Value: protects=a failed Devin setup whose take-back waits on a storage that stops answering still answers its command within the take-back budget, with the failure and the step that waits, while the take-back keeps the setup lock until storage answers, so another window's setup changes nothing meanwhile (Cycle 0146 task 1a); fails_when=the command waits for the take-back for ever, answers before the budget, or the lock is released before the take-back ended, so the other window's setup starts while the entry removal is still held; no_claim=the refusal of this window's own setup and removal (the next test); a stand-in entry removal held at a gate stands for the stalled storage, and both windows share one extension host and one storage folder
test('a failed Devin setup whose take-back waits on storage answers within the budget naming the waiting step and keeps the setup lock until storage answers', async (context) => {
  // Arrange
  const first = await devinWindow(context, {
    failSetupCommit: true,
    holdEntryRemoval: true,
  })
  let hadFirstEndedWhenSecondStarted: boolean | undefined
  const second = await devinWindow(context, {
    storageDirectory: first.directory,
    instanceLabel: 'second',
    onResolveNode: (): void => {
      hadFirstEndedWhenSecondStarted = first.outputLines.includes(
        "Codebook's take-back of this Devin Desktop setup ended now that storage answered, so Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup run again in this window.",
      )
    },
  })
  try {
    // Act
    const setupEnd = first.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    const removalReachedAtMs = await waitUntil(
      () => first.holds.entryRemoval.reachedAtMs(),
      "the take-back's entry removal",
    )
    const setupOutcome = await within(setupEnd, 16_000)
    const secondSetup = second.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - removalReachedAtMs
    assert.ok(
      answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
      `the setup command answered ${answeredAfterMs} ms after the entry removal was reached`,
    )
    assert.equal(
      setupOutcome.message,
      "Injected workspace state commit failure Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    // Without the lock the second window's first step follows within milliseconds; half a second without it shows it waits.
    await assert.rejects(
      waitUntil(
        () => second.steps.length > 0,
        "the second window's setup to start while the take-back holds the lock",
        500,
      ),
      {
        message:
          "Timed out waiting for the second window's setup to start while the take-back holds the lock",
      },
    )
    first.holds.entryRemoval.release()
    await secondSetup
    assert.deepEqual(second.steps, [
      'resolve Node',
      'deploy Devin skill',
      'start server',
      'write MCP entry',
      'verify Devin skill',
    ])
    assert.equal(hadFirstEndedWhenSecondStarted, true)
  } finally {
    await first.loaded.deactivate()
    await second.loaded.deactivate()
  }
})

// Value: protects=while a failed setup's take-back still waits on storage after its command answered, a new Set Up AI Chat and a Remove Devin Desktop Setup of that window refuse at once with the sentence that names the take-back and says that a reload tries it again, and the removal asks no question (Cycle 0146 task 1a; reload clause: Cycle 0146 /ship final-range pass, CodeRabbit CLI devinWindowSentences.ts:123); fails_when=the first command never answers, or a later command joins the pending take-back, waits for the lock, or asks its modal question first, or the refusal promises that a reload finishes the take-back, which another window's lock or a failed removal of the entry can still stop; no_claim=the lock seen from another window (the test above); the held stand-in entry removal stands for the stalled storage
test('a Devin setup and a removal refuse at once while an earlier take-back still waits on storage', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupCommit: true,
    holdEntryRemoval: true,
    confirmRemoval: true,
  })
  try {
    const firstOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    // Act
    // Each answer is waited for 2 seconds at most: a command that joins the pending take-back or waits for the lock answers 'still waiting'.
    const setupRefusal = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    const removalRefusal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    // Assert
    assert.notEqual(firstOutcome, 'still waiting')
    assert.equal(
      setupRefusal,
      'Codebook is still taking back an earlier Devin Desktop setup because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window, which tries that take-back again when it loads.',
    )
    assert.equal(
      removalRefusal,
      'Codebook is still taking back an earlier Devin Desktop setup because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window, which tries that take-back again when it loads.',
    )
    assert.deepEqual(window.modalQuestions, [])
    assert.equal(
      window.steps.filter((step) => step === 'resolve Node').length,
      1,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=while a failed first setup's take-back waits on storage after its record of the owed entry could not be written (a full disk), a new Set Up AI Chat refuses with the plain reload clause and the Output says what a reload leaves, because a reload then stops that take-back for good (Cycle 0146 /ship pass 2, red-team 3); fails_when=the refusal promises that a reload finishes the take-back although no record is on disk, so a learner who reloads as advised leaves the failed setup's entry installed; no_claim=a record write that itself waits on storage (the same flag stays off until it answers) and a take-back whose record was written (the test above keeps the full clause); the failing stand-in record write stands for the full disk and the held stand-in entry removal for the stalled storage
test('a Devin setup refused while a take-back without its record waits on storage promises no reload that finishes it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupCommit: true,
    holdEntryRemoval: true,
    failTakeBackRecord: true,
  })
  try {
    const firstOutcome = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    // Act
    const setupRefusal = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    // Assert
    assert.notEqual(firstOutcome, 'still waiting')
    assert.equal(
      setupRefusal,
      'Codebook is still taking back an earlier Devin Desktop setup because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window.',
    )
    assert.equal(await owedTakeBackRecord(window.directory), undefined)
    assert.equal(
      window.outputLines.filter(
        (line) =>
          line ===
          "Codebook has not recorded that the codebook entry of the failed Devin Desktop setup is still to be taken back, so a reload of this window now leaves that entry in Devin Desktop's MCP config: Codebook: Set Up AI Chat then keeps it as its own, and Codebook: Remove Devin Desktop Setup takes it out.",
      ).length,
      1,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed first Devin setup records that its entry is still to be taken back before its take-back's first step waits on storage, and drops that record once its entry step answered, so a reload or a closed window during the take-back leaves the entry to the next run (Cycle 0146 /ship pass 1, outside-voice 4 and red-team 1); fails_when=only the window's memory knows the take-back is owed, so a reload while the saved setup's restore waits drops the entry step and the failed setup's entry and receipt stay installed; why_new=the take-back's steps were tested only within one window's life; seam=a held take-back restore of the saved setup; no_claim=what the next window does with the record (the next tests); the held stand-in write stands for the stalled editor storage, and the record is the real file
test('a failed first Devin setup records its owed take-back before its first step waits on storage and drops it once the entry step answered', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failSetupCommit: true,
    holdSavedSetupWrite: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the take-back's restore of the saved setup",
    )
    // Act
    const recordWhileRestoreHeld = await owedTakeBackRecord(window.directory)
    window.holds.savedSetupWrite.release()
    const setupOutcome = await within(setup, 9_000)
    // Assert
    assert.deepEqual(recordWhileRestoreHeld, {
      schemaVersion: 1,
      generation: 'generation-of-this-setup',
    })
    assert.equal(setupOutcome, 'Injected workspace state commit failure')
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
    assert.equal(await owedTakeBackRecord(window.directory), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads on a storage with an owed take-back (a reload stopped a failed setup's take-back) takes that entry back by the failed setup's generation, says so in the Output and drops the record, also without a setup of its own to reconnect (Cycle 0146 /ship pass 1, outside-voice 4 and red-team 1); fails_when=nothing reads the record, so the failed first setup's entry and receipt stay installed until the learner runs setup or removal again; why_new=no run finished a take-back that a reload stopped; seam=none; no_claim=a record whose generation a newer setup replaced (the removal by generation then touches nothing, the config module's own tests); the record is the real file, left as a stopped take-back leaves it
test('a Devin Desktop window that loads with an owed take-back takes that entry back by its generation and drops the record', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  // Act
  const window = await devinWindow(context, { storageDirectory })
  try {
    await waitUntil(
      async () =>
        window.steps.includes('remove MCP entry') &&
        (await owedTakeBackRecord(storageDirectory)) === undefined,
      "the window load's take-back of the owed entry",
      5_000,
    )
    // Assert
    assert.deepEqual(window.steps, ['remove MCP entry'])
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-a-failed-setup' },
    ])
    assert.deepEqual(window.outputLines, [
      "Codebook is finishing the take-back of a failed Devin Desktop setup that a reload or a closed window stopped: it takes the codebook entry that setup wrote out of Devin Desktop's MCP config.",
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Set Up AI Chat that runs while a take-back is owed takes that failed setup's entry back by its generation before it writes its own entry, so it never adopts the failed entry as current and no later run takes back the entry this setup reported ready (Cycle 0146 /ship pass 1, outside-voice 4); fails_when=the setup writes its entry over the owed record, keeps the failed setup's generation, and the record later removes the new setup's entry; why_new=no run finished a take-back that a reload stopped; seam=a count of the looks for an owed take-back, so the record is left only after the window's own load looked; no_claim=the removal and the activation refresh, which finish it the same way first; the record is the real file
test('a Devin setup that runs while a take-back is owed takes that entry back before it writes its own', async (context) => {
  // Arrange
  const window = await devinWindow(context)
  try {
    await waitUntil(
      () => window.owedTakeBackReads() >= 1,
      "the window load's look for an owed take-back",
    )
    await leaveOwedTakeBack(window.directory, 'generation-of-a-failed-setup')
    // Act
    await window.commands.get('codebook.setupAiChat')!()
    // Assert
    assert.deepEqual(window.steps.slice(0, 3), [
      'remove MCP entry',
      'resolve Node',
      'deploy Devin skill',
    ])
    assert.equal(window.steps.includes('write MCP entry'), true)
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-a-failed-setup' },
    ])
    assert.equal(await owedTakeBackRecord(window.directory), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Set Up AI Chat whose take-back of an owed entry fails (its removal throws, for example on a full disk) writes no entry, reports no ready setup and keeps the record, so no later run takes out an entry this setup reported ready (Cycle 0146 /ship pass 2, specialist-batched 1); fails_when=the setup goes on after the failed take-back, adopts the failed setup's entry as current with the same generation and reports ready while the record still names that generation; no_claim=the activation refresh and the removal (their own tests); a stand-in entry removal that throws stands for the full disk, and the record is the real file
test('a Devin setup whose owed take-back fails writes no entry, reports no ready setup and keeps the record', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    failEntryRemoval: true,
    entryWrite: 'current',
  })
  try {
    await waitUntil(
      () => window.owedTakeBackReads() >= 1,
      "the window load's look for an owed take-back",
    )
    await leaveOwedTakeBack(window.directory, 'generation-of-this-setup')
    // Act
    const outcome = await window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      outcome,
      "Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished, so it did not set up Devin Desktop; see Codebook's Output for details, then run Codebook: Set Up AI Chat again.",
    )
    assert.deepEqual(window.steps, ['remove MCP entry'])
    assert.deepEqual(window.notices, [])
    assert.deepEqual(await owedTakeBackRecord(window.directory), {
      schemaVersion: 1,
      generation: 'generation-of-this-setup',
    })
    assert.deepEqual(window.outputLines, [
      "Codebook is finishing the take-back of a failed Devin Desktop setup that a reload or a closed window stopped: it takes the codebook entry that setup wrote out of Devin Desktop's MCP config.",
      'Codebook could not take back the Devin Desktop MCP entry this setup wrote: Injected entry removal failure',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Set Up AI Chat whose look for an owed take-back gets no answer (descriptor exhaustion, EIO) writes no entry and reports no ready setup, and the Output names the record, because that record may name the entry the setup would adopt (Cycle 0146 /ship pass 2, red-team 1); fails_when=a look without answer reads as nothing owed, so the setup adopts the failed setup's entry as current and reports ready, and the next look that answers takes that entry out, or the Output line advises deleting the record before making it readable again, so the next setup finds nothing owed and keeps the failed setup's entry; no_claim=a record that cannot be used for good (the same refusal; when this repeats, the Output line asks first to make that record readable again, and only when that cannot be done to check the failed setup's `codebook` entry in Devin Desktop's MCP config before deleting the record, Cycle 0146 /ship final-range pass, CodeRabbit CLI devinWindowSentences.ts:204); the stand-in read of the record answers no-answer once, and the record is the real file
test('a Devin setup whose look for an owed take-back gets no answer writes no entry and reports no ready setup', async (context) => {
  // Arrange
  const window = await devinWindow(context, { entryWrite: 'current' })
  try {
    await waitUntil(
      () => window.owedTakeBackReads() >= 1,
      "the window load's look for an owed take-back",
    )
    await leaveOwedTakeBack(window.directory, 'generation-of-this-setup')
    window.failNextOwedTakeBackLooks(1)
    // Act
    const outcome = await window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      outcome,
      "Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished, so it did not set up Devin Desktop; see Codebook's Output for details, then run Codebook: Set Up AI Chat again.",
    )
    assert.deepEqual(window.steps, [])
    assert.deepEqual(window.notices, [])
    assert.deepEqual(await owedTakeBackRecord(window.directory), {
      schemaVersion: 1,
      generation: 'generation-of-this-setup',
    })
    assert.deepEqual(window.outputLines, [
      `Codebook could not read ${join(window.directory, 'devin-setup', 'take-back.json')}, its record of a failed Devin Desktop setup's take-back, so it cannot tell whether that take-back has finished. If this repeats, make that file readable again, as a regular file readable only by you (mode 600); only when you cannot, check the \`codebook\` entry in Devin Desktop's MCP config, which that failed setup may have left, before you delete that file and run Codebook: Set Up AI Chat again.`,
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window that loads on a set-up workspace while an owed take-back cannot finish (its removal throws) leaves the entry unrefreshed and reconnects nothing, so it never serves the failed setup's entry that a later run takes out, and the Output says what to do (Cycle 0146 /ship pass 2, red-team 1); fails_when=the refresh keeps the failed setup's entry and the window starts its server marked for it; no_claim=a look without answer (the next test: the window still reconnects) and a server the learner starts by hand; a stand-in entry removal that throws stands for the full disk, and the record is the real file
test('a Devin Desktop window whose owed take-back fails leaves the entry unrefreshed and reconnects nothing', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  // Act
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    failEntryRemoval: true,
  })
  try {
    await window.whenReconnected()
    // Assert
    assert.deepEqual(
      window.steps.filter(
        (step) => step === 'refresh MCP entry' || step === 'start server',
      ),
      [],
    )
    assert.equal(
      window.outputLines.filter(
        (line) =>
          line ===
          'Codebook did not refresh its Devin Desktop MCP entry or reconnect this window because the take-back of the failed Devin Desktop setup that wrote that entry has not finished; run Codebook: Set Up AI Chat again once storage answers.',
      ).length,
      1,
    )
    assert.deepEqual(await owedTakeBackRecord(storageDirectory), {
      schemaVersion: 1,
      generation: 'generation-of-a-failed-setup',
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop window whose looks for an owed take-back get no answer at load leaves the entry unrefreshed and says so in the Output, and still reconnects, so one moment of descriptor exhaustion neither refreshes an entry a record may name nor leaves a set-up window without its server (Cycle 0146 /ship pass 2, red-team 1); fails_when=a look without answer reads as nothing owed and the refresh rewrites or keeps the entry as installed, or the window stops reconnecting for a read that only failed to look; no_claim=a record that stands after a failed removal (the test above: nothing reconnects); the stand-in read of the record answers no-answer twice (the load's look and the refresh's), and the record is the real file
test('a Devin Desktop window whose look for an owed take-back gets no answer leaves the entry unrefreshed and still reconnects', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  await leaveOwedTakeBack(storageDirectory, 'generation-of-a-failed-setup')
  // Act
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    owedTakeBackLooksWithoutAnswer: 2,
  })
  try {
    await window.whenReconnected()
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'start server',
    ])
    assert.deepEqual(window.outputLines, [
      `Codebook could not read ${join(storageDirectory, 'devin-setup', 'take-back.json')}, its record of a failed Devin Desktop setup's take-back, so it cannot tell whether that take-back has finished. If this repeats, make that file readable again, as a regular file readable only by you (mode 600); only when you cannot, check the \`codebook\` entry in Devin Desktop's MCP config, which that failed setup may have left, before you delete that file and run Codebook: Set Up AI Chat again.`,
      'Codebook did not refresh its Devin Desktop MCP entry: Codebook could not confirm that the take-back of an earlier failed Devin Desktop setup has finished.',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed first Devin setup whose descriptor rewrite waits on storage answers within the budget, refuses the Devin bridge meanwhile and leaves the descriptor and the served token as they are until the write lands, then rotates the token, so a bridge with the old token is refused (Cycle 0146 task 1a, v2 finding 12); fails_when=the command waits for the write for ever, the server switches token before the descriptor carries the new one, or the old token is still served afterwards; no_claim=a removal's unmark (the removal tests); the held stand-in rewrite runs the real one once released, the server is the real one
test('a failed first Devin setup whose descriptor unmark waits on storage keeps the old token until the write lands, then rotates it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    realServer: true,
    failSetupCommit: true,
    holdDescriptorUnmark: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.descriptorUnmark.reachedAtMs(),
      "the take-back's descriptor unmark",
    )
    const descriptorFile = await window.descriptorPath()
    const descriptorWhileHeld = await readFile(descriptorFile, 'utf8')
    const oldToken: string = JSON.parse(descriptorWhileHeld).token
    const setupOutcome = await within(setup, 16_000)
    const statusAfterAnswer = await postInitialize(descriptorFile, true)
    const descriptorAfterAnswer = await readFile(descriptorFile, 'utf8')
    // Act
    window.holds.descriptorUnmark.release()
    await waitUntil(
      async () =>
        JSON.parse(await readFile(descriptorFile, 'utf8')).token !== oldToken,
      'the rotated token in the descriptor',
    )
    const rotatedDescriptor = JSON.parse(await readFile(descriptorFile, 'utf8'))
    const withOldToken = await postInitialize(descriptorFile, false, oldToken)
    const withNewToken = await postInitialize(descriptorFile, false)
    // Assert
    assert.equal(
      setupOutcome,
      "Injected workspace state commit failure Codebook's take-back of this Devin Desktop setup is still waiting on storage (descriptor) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.equal(statusAfterAnswer, 403)
    assert.equal(descriptorAfterAnswer, descriptorWhileHeld)
    assert.equal(rotatedDescriptor.devinChat, undefined)
    assert.deepEqual([withOldToken, withNewToken], [401, 200])
  } finally {
    await window.loaded.deactivate()
  }
})
