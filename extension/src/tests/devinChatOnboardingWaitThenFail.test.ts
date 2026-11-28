import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a Remove Devin Desktop Setup whose skill step waits on storage and then fails shows that failure as a warning once storage answers, as its pending warning promised that it shows its result, and the Output keeps its line (Cycle 0146 task 26); fails_when=the late failure only reaches the Output, so the learner never learns that the removal ended without removing anything; no_claim=a late success (the hold cases above) and a setup's late failure (its own warning); the held stand-in skill removal stands for the stalled storage, then throws
test('a Devin removal whose skill step waits on storage and then fails shows that failure as a warning once storage answers', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    savedSetup: true,
    confirmRemoval: true,
    holdSkillRemoval: true,
    failSkillRemoval: true,
  })
  try {
    await window.whenReconnected()
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      16_000,
    )
    // Act
    window.holds.skillRemoval.release()
    await waitUntil(
      () => window.notices.length === 2,
      "the removal's late failure warning",
    )
    // Assert
    assert.equal(removalOutcome, 'resolved')
    assert.deepEqual(window.notices, [
      {
        severity: 'warning',
        message:
          "Codebook's removal of the Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
        actions: [],
      },
      {
        severity: 'warning',
        message: 'Injected skill removal failure',
        actions: [],
      },
    ])
    assert.equal(
      window.outputLines.includes(
        "Codebook's removal of the Devin Desktop setup ended after storage answered: Injected skill removal failure",
      ),
      true,
    )
  } finally {
    await window.loaded.deactivate()
  }
})

// Value: protects=a Devin setup whose skill deployment waited on storage (its command answered) and whose later failure names an MCP receipt others can read, which its take-back then deletes while that take-back also waits on storage, ends with a warning that asks only for a setup retry (Cycle 0146 review round, CodeRabbit extension.ts:1629-1632); fails_when=the late warning asks the learner to make a deleted receipt private (mode 600); no_claim=a receipt that stays (the mode repair then stands), and Windows, where file modes do not apply; held stand-ins of the deployment and of the entry removal stand for the stalled storage, and the entry removal deletes the receipt as the real one does
test(
  'a Devin setup whose step and take-back both waited on storage asks only for a retry once that take-back deleted the receipt its failure named',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      holdDeploy: true,
      receiptMode: 0o644,
      removalDeletesReceipt: true,
      holdEntryRemoval: true,
    })
    try {
      const setupOutcome = await within(
        window.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        16_000,
      )
      // Act
      window.releaseDeploy()
      await waitUntil(
        () =>
          window.outputLines.includes(
            "Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
          ),
        "the take-back's lapse",
      )
      window.holds.entryRemoval.release()
      await waitUntil(
        () => window.notices.length > 0,
        "the setup's late failure warning",
      )
      // Assert
      assert.equal(
        setupOutcome,
        "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
      )
      assert.deepEqual(window.notices, [
        {
          severity: 'warning',
          message:
            'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.',
          actions: [],
        },
      ])
    } finally {
      await window.loaded.deactivate()
    }
  },
)

// Value: protects=a failed Devin setup whose failure names an MCP receipt others can read, and whose take-back waits on storage, answers without that failure (the take-back deletes the receipt), and once storage answered shows a warning with what to do now: a setup retry, since the take-back deleted the receipt (Cycle 0146 review round, CodeRabbit extension.ts:1863); fails_when=the setup's end only reaches the Output, so the learner never reads why the setup failed; no_claim=a take-back whose answer named the failure (it only goes to the Output, the take-back tests above), and Windows, where file modes do not apply; the held stand-in entry removal stands for the stalled storage and deletes the receipt as the real one does
test(
  'a failed Devin setup whose take-back answered without its failure shows a retry warning once storage answers',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const window = await devinWindow(context, {
      receiptMode: 0o644,
      removalDeletesReceipt: true,
      holdEntryRemoval: true,
    })
    try {
      const setupOutcome = await within(
        window.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        16_000,
      )
      // Act
      window.holds.entryRemoval.release()
      await waitUntil(
        () => window.notices.length > 0,
        "the setup's late failure warning",
      )
      // Assert
      assert.equal(
        setupOutcome,
        "Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
      )
      assert.deepEqual(window.notices, [
        {
          severity: 'warning',
          message:
            'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.',
          actions: [],
        },
      ])
    } finally {
      await window.loaded.deactivate()
    }
  },
)
