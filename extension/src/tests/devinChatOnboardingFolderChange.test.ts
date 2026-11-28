import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONNECTION_DESCRIPTOR_SUFFIX } from '../constants'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a failed Devin setup re-run whose window changed its workspace folder after the run began, and before the failure, leaves no saved setup of the folder that closed, and the Output says why (Cycle 0146 task 6); fails_when=the take-back writes the old folder's setup back over the folder change's clear; no_claim=a folder change after the take-back's restore started (the next test); the skill check stand-in, armed after the reconnect at activation, changes the folder as the editor does and then fails
test('a failed Devin setup re-run whose folder changed after it began leaves no saved setup of the old folder', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = { savedSetup: true }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    let savedWhenFolderChanged: unknown
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      savedWhenFolderChanged = window.state.get('codebook.aiChatSetup')
      window.changeFolder('/other/folder')
      throw new Error('Injected skill check failure')
    }
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.deepEqual(savedWhenFolderChanged, {
      workspace: window.directory,
      provisional: true,
      previous: { workspace: window.directory },
    })
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.equal(
      window.outputLines.includes(
        "Codebook did not put back this window's earlier Devin Desktop setup because the folder changed.",
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder change that comes while a failed Devin setup's restore of the earlier saved setup is being written still ends with no saved setup, because the folder change's clear lands after that restore (Cycle 0146 task 6, v2 finding 8); fails_when=the clear lands first and the held restore writes the old folder's setup back last; no_claim=a folder change before the restore started (the test above); the held stand-in write stands for a slow editor storage
test("a folder change while a failed Devin setup's restore is written leaves no saved setup", async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    holdSavedSetupWrite: true,
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the take-back's restore of the saved setup",
    )
    // Act
    window.changeFolder('/other/folder')
    window.holds.savedSetupWrite.release()
    const setupOutcome = await within(setup, 15_000)
    // Assert
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a failed Devin setup re-run in the same folder, whose entry write found the earlier setup's entry unchanged, still puts back the setup saved before it, keeps that entry and writes no folder line (Cycle 0146 task 6 guard); fails_when=the folder check clears the earlier setup although no folder changed, or the take-back removes an entry it did not install; no_claim=the folder change cases above; the skill check stand-in is armed after the reconnect at activation
test('a failed Devin setup re-run without a folder change puts back the setup saved before it', async (context) => {
  // Arrange
  // The re-run finds the entry of the earlier setup unchanged, as a re-run in the same folder does.
  const options: Parameters<typeof devinWindow>[1] = {
    savedSetup: true,
    entryWrite: 'current',
  }
  const window = await devinWindow(context, options)
  try {
    await window.whenReconnected()
    options.onSkillCheck = async (): Promise<void> => {
      options.onSkillCheck = undefined
      throw new Error('Injected skill check failure')
    }
    // Act
    const setupOutcome = await window.commands.get(
      'codebook.setupAiChat',
    )!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // Assert
    assert.equal(setupOutcome, 'Injected skill check failure')
    assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
      workspace: window.directory,
    })
    assert.equal(window.steps.includes('remove MCP entry'), false)
    assert.equal(
      window.outputLines.includes(
        "Codebook did not put back this window's earlier Devin Desktop setup because the folder changed.",
      ),
      false,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin setup whose window changed its workspace folder while the setup's skill deployment waited starts no server, writes no entry and saves no setup for the folder now open, and answers that the setup did not complete for this folder; fails_when=the setup reads the folder only when its server starts, so the server, the entry, the descriptor's mark and the commit set up the folder the learner switched to and end with a ready notice (Cycle 0146 /ship pass 1, codex-structured extension.ts:1741); why_new=only folder changes during the commit and the lock's release were tested, after the server already served the folder the command ran in; seam=serverFollowsFolder, so the server serves the folder open when it starts; no_claim=a folder change during the lock's wait (the same check runs before the server start) and after the entry write (that check takes back what the setup saved); the held stand-in deployment stands for a slow storage
test('a Devin setup whose window changed its folder while the skill deployment waited sets up nothing for the folder now open', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    serverFollowsFolder: true,
  })
  try {
    const setup = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    await window.deployReached
    // Act
    window.changeFolder('/other/folder')
    window.releaseDeploy()
    const setupOutcome = await within(setup, 9_000)
    // Assert
    assert.equal(
      setupOutcome,
      'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
    )
    assert.deepEqual(window.steps, ['resolve Node', 'deploy Devin skill'])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin setup whose window changed its workspace folder while its commit was written, and whose clear of the saved setup for that change then never returns, answers within the setup budget naming the saved setup step, and once storage answers ends with the folder-change warning and no saved setup (Cycle 0146 task 28); fails_when=the folder check after the commit waits for that clear for ever, so the command never answers and the setup lock stays held; no_claim=the same check after the lock's release (it runs its clear under the same budget, not held here) and a clear that fails late; the hold, armed while the commit is written, stands for a storage that stops answering at the first clear after the commit (the folder change's own clear, which the setup's clear queues behind)
test('a Devin setup whose folder changed during its commit answers within the budget although clearing the saved setup never returns', async (context) => {
  // Arrange
  const options: Parameters<typeof devinWindow>[1] = {}
  options.onSetupCommit = async (window): Promise<void> => {
    options.onSetupCommit = undefined
    window.changeFolder('/other/folder')
    // Armed after the commit write passed its own hold check, so the first write held is a clear that comes after the commit.
    options.holdSavedSetupWrite = true
  }
  const window = await devinWindow(context, options)
  try {
    // Act
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    const clearReachedAtMs = await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      'the held clear of the saved setup after the folder change',
    )
    const setupOutcome = await within(setupEnd, 16_000)
    window.holds.savedSetupWrite.release()
    // A command that never answered shows no late warning: the wait ends at once, and the first assertion says why.
    await waitUntil(
      () => setupOutcome === 'still waiting' || window.notices.length > 0,
      "the setup's late failure warning",
    )
    // Assert
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - clearReachedAtMs
    assert.ok(
      answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
      `the setup command answered ${answeredAfterMs} ms after the clear of the saved setup was reached`,
    )
    assert.equal(
      setupOutcome.message,
      "Codebook's Devin Desktop setup is still waiting on storage (saved setup) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.deepEqual(window.notices, [
      {
        severity: 'warning',
        message:
          'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.',
        actions: [],
      },
    ])
    assert.equal(window.state.get('codebook.aiChatSetup'), undefined)
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a change of the workspace's folders whose clear of the saved Devin setup waits on a storage that stops answering still stops the old folder's server and lets Codebook: Start Agent Server start one for the new folder, and the clear still lands once storage answers (Cycle 0146 task 16); fails_when=the handling of the folder change waits for that clear, so the old server keeps running and the new folder's start waits for ever; no_claim=the order of the clear after a take-back's restore (the restore test above) and the notice of a clear that fails (the next test); the held stand-in write stands for the stalled storage
test("a folder change whose clear of the saved Devin setup waits on storage still stops the old server and lets the new folder's server start", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // Act
    window.changeFolder('/other/folder')
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the folder change's clear of the saved setup",
    )
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const descriptorsWhileHeld = await window.descriptorNames()
    const savedWhileHeld = window.state.get('codebook.aiChatSetup')
    window.holds.savedSetupWrite.release()
    await waitUntil(
      () => window.state.get('codebook.aiChatSetup') === undefined,
      "the folder change's clear of the saved setup to land",
    )
    // Assert
    assert.equal(startOutcome, 'started')
    assert.deepEqual(descriptorsWhileHeld, [
      `instance-2${CONNECTION_DESCRIPTOR_SUFFIX}`,
    ])
    assert.deepEqual(savedWhileHeld, { workspace: window.directory })
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder change whose clear of the saved Devin setup waits on storage and then fails still lets the new folder's server start meanwhile, and tells that late failure in a cleanup notice of its own once storage answered (Cycle 0146 task 16); fails_when=the late failure is lost because the handling's notice was already decided, or the handling waits for the clear; no_claim=a clear that fails at once (it joins the handling's one notice); the held stand-in write stands for the stalled storage, then fails
test('a folder change whose clear of the saved Devin setup fails after storage answered late tells that failure in its own notice', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdSavedSetupWrite: true,
    failHeldSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    window.changeFolder('/other/folder')
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the folder change's clear of the saved setup",
    )
    const startOutcome = await within(
      window.commands.get('codebook.startAgentServer')!().then(
        () => 'started',
        (error: Error) => error.message,
      ),
      5_000,
    )
    const noticesWhileHeld = structuredClone(window.notices)
    // Act
    window.holds.savedSetupWrite.release()
    await waitUntil(
      () => window.notices.length > 0,
      "the notice of the clear's late failure",
    )
    // Assert
    assert.equal(startOutcome, 'started')
    assert.deepEqual(noticesWhileHeld, [])
    assert.deepEqual(window.notices, [
      {
        severity: 'error',
        message:
          "Codebook did not finish its cleanup after the workspace's folders changed. The saved AI chat setup could not be cleared: Injected late workspace state write failure. It is still in use; run Codebook: Set Up AI Chat to replace it. Codebook goes on with new readers.",
        actions: [],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder change whose clear of the saved Devin setup fails at once tells that failure in the handling's one cleanup notice, first, before the failure of a step that ran after it; fails_when=the failure is dropped, it is told after the later step's failure, or it gets a notice of its own beside the handling's (two notices); why_new=only the late failure and the notice wording are tested; seam=none; no_claim=VS Code and Cursor windows, which share this path; the stand-in storage refuses the clear at once, and the stand-in Study reader's first dispose throws as the later failure
test('a folder change whose saved-setup clear fails at once tells it first in the one cleanup notice', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    failSetupClear: true,
    failStudyReaderDispose: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // Act
    window.changeFolder('/other/folder')
    // Only the handling's own notice names the Study reader, and it is shown last: a notice of the clear alone would already be there.
    await waitUntil(
      () =>
        window.notices.some(({ message }) =>
          message.includes('The Study workspace could not be closed'),
        ),
      "the folder change's cleanup notice",
    )
    // Assert
    assert.deepEqual(window.notices, [
      {
        severity: 'error',
        message:
          "Codebook did not finish its cleanup after the workspace's folders changed. The saved AI chat setup could not be cleared: Injected workspace state write failure. It is still in use; run Codebook: Set Up AI Chat to replace it. The Study workspace could not be closed: Injected Study reader dispose failure. Codebook goes on with new readers. If a Codebook pane stayed open, close it by hand.",
        actions: [],
      },
    ])
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a folder removed and added again at the same path, while the folder change's clear of the saved Devin setup still waits on storage, starts its next server unmarked and offers no Reload Window, because the setup that clear takes away no longer counts for the folder now open; fails_when=the window reads the old folder's saved setup, which the editor still holds until the queued clear's turn, as the setup of the folder now open, so the new server is marked for Devin Local and offers a reload for a setup that is being cleared (Cycle 0146 /ship pass 1, adversarial-native P3 3); why_new=only a folder change to another path was held, where the saved workspace differs anyway; seam=none; no_claim=a clear that failed (the setup it could not clear then counts again, as the cleanup notice says); the held stand-in write stands for the stalled storage
test('a folder added again at the same path while its saved Devin setup is still being cleared starts its server unmarked and offers no reload', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    holdSavedSetupWrite: true,
  })
  try {
    await window.whenReconnected()
    await waitUntil(
      window.descriptorReadable,
      "the reconnect's connection descriptor",
    )
    // The reconnect offered no notice; the window's notices start empty here.
    const noticesBefore = structuredClone(window.notices)
    window.changeFolder(window.directory)
    await waitUntil(
      () => window.holds.savedSetupWrite.reachedAtMs(),
      "the folder change's clear of the saved setup",
    )
    // Act
    await window.commands.get('codebook.startAgentServer')!()
    // Assert
    assert.deepEqual(noticesBefore, [])
    assert.equal(await window.readDescriptorField(), undefined)
    assert.deepEqual(window.notices, [])
  } finally {
    await window.loaded.deactivate()
  }
})
