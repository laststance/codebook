import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { hasDevinSetupReceipts } from '../utils/hasDevinSetupReceipts'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { removeTestFolder } from './utils/removeTestFolder'

// Value: protects=a removal finished in another window while this window's refresh ran leaves this window reconnecting nothing: no server start, and the removed line in the Output; fails_when=the refresh answers not-managed for a gone entry receipt and activation goes on to start a server for a removed setup; why_new=review finding F4 (Cycle 0143 /ship pass 2, removal during the refresh); seam=an entry refresh stand-in that removes the entry's record and answers not-managed
test('a Devin Desktop window whose setup another window removed during the refresh reconnects nothing', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    entryRefresh: 'not-managed',
    afterRefresh: () =>
      rm(join(storageDirectory, 'devin-mcp/receipt.json'), { force: true }),
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's Devin Desktop setup was removed, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
        ),
      'the removed line in the Output',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
    ])
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a connection descriptor written after another window removed the skill is not marked for the Devin bridge, also when that removal's MCP-entry removal failed and left the entry's record; fails_when=the skill's record left with installed false still counts, so the bridge connects for a removed skill; why_new=review finding I1 (Cycle 0143 /ship cycle 3, installed receipts only); seam=the real descriptor file, the skill's record rewritten as a skill removal leaves it
test('a Devin Desktop descriptor written after another window removed the skill but kept the entry record is not marked', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // A skill removal leaves its record with installed false.
    await writeFile(
      join(window.directory, 'devin-skill/receipt.json'),
      '{"installed":false}',
    )
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a connection descriptor is marked for the Devin bridge only while the entry's record is left; fails_when=the descriptor written at a restart carries devinChat although another window removed the entry, so the bridge connects for a removed setup; why_new=review finding F4 (Cycle 0143 /ship pass 2, mark decided at the write), moved to a restart by finding I2 (the reconnect starts nothing without both records); seam=the real descriptor file, the entry's record deleted after the start
test('a Devin Desktop descriptor written after another window removed the entry record is not marked', async (context) => {
  // Arrange
  const window = await devinWindow(context, { savedSetup: true })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    await rm(join(window.directory, 'devin-mcp/receipt.json'), { force: true })
    // Act
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=the skill's record counts only while it parses and says installed true; fails_when=a missing, unparsable or uninstalled skill record still reads as a standing setup; why_new=review finding I1 (Cycle 0143 /ship cycle 3); seam=the real records in a temporary storage
test('a Devin setup stands only while the skill record says installed and the entry record is left', async (context) => {
  // Arrange
  const storage = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storage))
  await mkdir(join(storage, 'devin-skill'), { recursive: true })
  await mkdir(join(storage, 'devin-mcp'), { recursive: true })
  await writeFile(join(storage, 'devin-mcp/receipt.json'), '{}')
  const skillReceipt = join(storage, 'devin-skill/receipt.json')
  const outcomes: boolean[] = []
  // Act
  await writeFile(skillReceipt, '{"installed":true}')
  outcomes.push(await hasDevinSetupReceipts(storage))
  await writeFile(skillReceipt, '{"installed":false}')
  outcomes.push(await hasDevinSetupReceipts(storage))
  await writeFile(skillReceipt, 'not json')
  outcomes.push(await hasDevinSetupReceipts(storage))
  await rm(skillReceipt)
  outcomes.push(await hasDevinSetupReceipts(storage))
  // Assert
  assert.deepEqual(outcomes, [true, false, false, false])
})

// Value: protects=a reconnect starts no server once a removal finished in another window after the entry refresh answered current; fails_when=only the entry's record is read again, so a skill record taken meanwhile still lets the server start for a removed setup; why_new=review finding I2 (Cycle 0143 /ship cycle 3, both records read before the start); seam=an entry refresh stand-in that removes the skill's record before it answers
test('a Devin Desktop reconnect starts no server when the skill record disappears after the entry refresh', async (context) => {
  // Arrange
  const storageDirectory = await mkdtemp(join(tmpdir(), 'codebook-devin-'))
  context.after(() => removeTestFolder(storageDirectory))
  const window = await devinWindow(context, {
    storageDirectory,
    savedSetup: true,
    entryRefresh: 'current',
    afterRefresh: () =>
      rm(join(storageDirectory, 'devin-skill/receipt.json'), { force: true }),
  })
  try {
    // Act
    await waitUntil(
      () =>
        window.outputLines.includes(
          "Codebook's Devin Desktop setup was removed, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat to set it up again.",
        ),
      'the removed line in the Output',
    )
    // Assert
    assert.deepEqual(window.steps, [
      'verify Devin skill',
      'resolve Node',
      'refresh MCP entry',
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Stop Agent Server between the read and the write of a descriptor rewrite never leaves a descriptor for the stopped instance; fails_when=the rewrite's atomic write recreates the descriptor the stop removed, so the bridge finds a file whose server is gone; why_new=review finding F5 (Cycle 0143 /ship pass 2, rewrite and stop in one queue); seam=a descriptor rewrite stand-in that waits after its read
test('a Stop Agent Server that comes while a Devin descriptor rewrite is pending leaves no descriptor', async (context) => {
  // Arrange
  const window = await devinWindow(context, { holdDescriptorRewrite: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const setup = window.commands.get('codebook.setupAiChat')!()
    await window.rewriteReached
    // Act
    const stop = window.commands.get('codebook.stopAgentServer')!()
    // gstack-timing-ok: an unqueued stop needs a real moment to remove the file first; the checked outcome is the missing descriptor
    await delay(100)
    window.releaseRewrite()
    // The setup now ends with a retry sentence, because the server it checked was stopped meanwhile; this test reads only the descriptor.
    await Promise.allSettled([setup, stop])
    // Assert
    assert.deepEqual(await window.descriptorNames(), [])
  } finally {
    window.releaseRewrite()
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed re-run of Set Up AI Chat on a workspace already set up keeps the saved setup, so the shared entry that stays current still reconnects at the next window load; fails_when=the rollback clears the setup the earlier run saved; why_new=review finding F6 (Cycle 0143 /ship pass 2, restore the previous setup); seam=a saved setup, a skill check that fails
test('a failed Devin setup re-run keeps the setup saved before it', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    skillManaged: false,
    entryWrite: 'current',
  })
  try {
    await waitUntil(
      () => window.steps.includes('start server'),
      'the reconnect at activation',
    )
    // Act
    const setup = window.commands.get('codebook.setupAiChat')!()
    // Assert
    await assert.rejects(setup)
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Remove Devin Desktop Setup that comes while a restarted server is deciding its descriptor mark leaves the descriptor unmarked, so the Devin bridge never connects for a removed setup; fails_when=the mark decision and the descriptor write are outside the queue of the removal's unmark, so a decision made before the removal is written after its unmark found no running server; why_new=review finding M1 (Cycle 0143 /ship cycle 3 final range, first mark serialized with the removal); seam=a stand-in of the setup records that waits after it read them, the real descriptor file
test('a removal that comes while a restarted Devin Desktop server decides its descriptor mark leaves the descriptor unmarked', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
  })
  try {
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    await window.commands.get('codebook.stopAgentServer')!()
    window.armReceiptsHold()
    const restart = window.commands.get('codebook.startAgentServer')!()
    // The restart has read that the setup stands and waits before it writes the descriptor.
    await waitUntil(
      window.hasReceiptsReached,
      'the restart to read the setup records',
    )
    // Act
    const removal = window.commands.get('codebook.removeManagedDevinSetup')!()
    await waitUntil(
      () => window.state.get('codebook.aiChatSetup') === undefined,
      'the removal to clear the saved setup',
    )
    window.releaseReceipts()
    await Promise.all([restart, removal])
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
  } finally {
    window.releaseReceipts()
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin Desktop setup whose agent server was stopped before it finished ends with a retry sentence, takes back the entry it wrote and offers no reload; fails_when=the setup reports success and offers a reload for a server that no longer runs, so the learner reloads into a bridge with nothing to reach; why_new=review finding M2 (Cycle 0143 /ship cycle 3 final range, target checked after the mark); seam=a descriptor rewrite stand-in that waits after its read, a Stop Agent Server that comes meanwhile
test('a Devin Desktop setup whose server was stopped while it finished takes the entry back and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { holdDescriptorRewrite: true })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    const setup = window.commands.get('codebook.setupAiChat')!()
    await window.rewriteReached
    // Act
    const stop = window.commands.get('codebook.stopAgentServer')!()
    window.releaseRewrite()
    const [setupOutcome] = await Promise.allSettled([setup, stop])
    // Assert
    assert.equal(setupOutcome.status, 'rejected')
    assert.equal(
      setupOutcome.reason.message,
      'Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
  } finally {
    window.releaseRewrite()
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose server is stopped while its committed setup is being saved ends in success with the committed setup and no rollback; fails_when=the setup checks the server after the commit write and rolls back, so a failing restore write leaves a committed value that the next start marks as a failed setup; no_claim=a server stopped before the receipts read (the sibling test above), the restart itself (a window load starts the server of a saved setup)
test('a Devin Desktop setup whose server was stopped while its commit was written keeps the committed setup and takes nothing back', async (context) => {
  // Arrange
  const stopServer = async (): Promise<void> => {
    await window.commands.get('codebook.stopAgentServer')!()
  }
  const window = await devinWindow(context, {
    onSetupCommit: stopServer,
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome, 'resolved')
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
    assert.deepEqual(window.entryRemovals, [])
    assert.equal(window.notices.length, 1)
    assert.deepEqual(window.notices[0]?.actions, ['Reload Window'])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose window switched to another folder while its commit was written reports that it did not complete, offers no reload and leaves no saved setup of the old folder; fails_when=the setup reports success and offers a reload that cannot connect the folder now open, or the commit lands after the folder change cleared the saved value and the old folder's setup stays saved; no_claim=the wording of the folder-change handling's own notices
test('a Devin Desktop setup whose folder changed while its commit was written offers no reload and says it did not complete', async (context) => {
  // Arrange
  const switchFolder = async (seam: {
    changeFolder: (folder: string) => void
  }): Promise<void> => {
    // The registered folder-change listeners run against the held commit write.
    seam.changeFolder('/other/folder')
  }
  const window = await devinWindow(context, { onSetupCommit: switchFolder })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // The folder-change handling stops the old folder's server; both processes have settled when no descriptor is left.
    await waitUntil(
      async () => (await window.descriptorNames()).length === 0,
      "the stop of the old folder's server",
    )
    // Assert
    assert.equal(
      setupOutcome,
      'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose window switched to another folder while the setup lock was released reports that it did not complete and offers no reload; fails_when=the success notice and its Reload Window button come for the folder that just closed, because the folder is compared only inside the lock; no_claim=the old folder's saved value (the folder-change handling clears it)
test('a Devin Desktop setup whose folder changed while its lock was released offers no reload and says it did not complete', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    afterSetupLockRelease: async (seam) => {
      seam.changeFolder('/other/folder')
    },
  })
  try {
    await window.commands.get('codebook.startAgentServer')!()
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      setupOutcome,
      'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a Devin Desktop setup whose final receipts check never answers takes its records back within a bound and offers no reload; fails_when=the setup waits for ever on a skill receipt read that hangs, never rolls back, and a removal queued behind it waits too; no_claim=a check that answers late (it is no answer once the bound passed)
test('a Devin Desktop setup whose final receipts check never answers takes the entry back and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, { hangFinalReceiptsCheck: true })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(
      setupOutcome,
      'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.notices, [])
    assert.deepEqual(window.entryRemovals, [
      { expectedGeneration: 'generation-of-this-setup' },
    ])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// protects: a failed Devin setup leaves no mark on a server that started during it and read the half-saved setup / fails_when: the new server keeps `devinChat: true` after the rollback, so the bridge connects to a workspace whose setup was taken back / no_claim: the shared MCP entry of another window
test('a Devin Desktop setup that fails after a server restart unmarks the new server it never checked', async (context) => {
  // Arrange
  const stopAndStart = async (): Promise<void> => {
    await window.commands.get('codebook.stopAgentServer')!()
    await window.commands.get('codebook.startAgentServer')!()
  }
  const window = await devinWindow(context, { onSkillCheck: stopAndStart })
  try {
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(await window.readDescriptorField(), undefined)
    assert.equal(
      setupOutcome,
      'Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again.',
    )
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})
