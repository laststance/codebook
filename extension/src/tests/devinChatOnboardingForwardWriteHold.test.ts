import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

/** The forward setup steps a test holds on storage, with the name the test's title gives the held step, the harness option and hold of each and the sentence the setup command answers while it waits. */
const FORWARD_WRITE_HOLD_CASES = [
  {
    name: 'saved setup write',
    option: 'holdSavedSetupWrite',
    hold: 'savedSetupWrite',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (saved setup) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'descriptor write',
    option: 'holdDescriptorMark',
    hold: 'descriptorMark',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (descriptor) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'MCP entry write',
    option: 'holdEntryWrite',
    hold: 'entryWrite',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'provisional saved setup write',
    option: 'holdProvisionalSave',
    hold: 'provisionalSave',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (saved setup) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: 'final skill check',
    option: 'holdSkillCheck',
    hold: 'skillCheck',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
  {
    name: "server start's descriptor publish",
    option: 'holdDescriptorPublish',
    hold: 'descriptorPublish',
    pendingSentence:
      "Codebook's Devin Desktop setup is still waiting on storage (descriptor) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
  },
] as const

for (const holdCase of FORWARD_WRITE_HOLD_CASES) {
  // Value: protects=a Devin setup whose forward step never returns (the server start's descriptor publish, the entry write, the provisional save, the final skill check, the descriptor's mark or the committed saved setup) answers within the setup budget naming that step, goes on under the setup lock, and shows its own notice with Reload Window once storage answers, with the setup saved and the descriptor marked (Cycle 0146 task 14; the publish, entry, provisional and skill check cases Cycle 0146 /ship Step 7); fails_when=a step runs outside its budget, so the command waits for that step for ever and the setup lock and a removal queued behind it wait with it; why_new=only the committed saved setup and the descriptor mark were held before; seam=none; no_claim=the skill deployment (its own test above) and the clear after a folder change (the folder tests below); a stand-in step held at a gate stands for the stalled storage, and the publish is the real write, held by a stand-in of the file module
  test(`a Devin setup whose ${holdCase.name} never returns answers within the budget and shows its own notice once storage answers`, async (context) => {
    // Arrange
    const window = await devinWindow(context, { [holdCase.option]: true })
    try {
      // Act
      const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
        () => ({ atMs: performance.now(), message: 'resolved' }),
        (error: Error) => ({ atMs: performance.now(), message: error.message }),
      )
      const writeReachedAtMs = await waitUntil(
        () => window.holds[holdCase.hold].reachedAtMs(),
        `the setup's held ${holdCase.name}`,
      )
      const setupOutcome = await within(setupEnd, 16_000)
      window.holds[holdCase.hold].release()
      await waitUntil(() => window.notices.length > 0, "the setup's own notice")
      // Assert
      assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
      const answeredAfterMs = setupOutcome.atMs - writeReachedAtMs
      assert.ok(
        answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
        `the setup command answered ${answeredAfterMs} ms after its ${holdCase.name} was reached`,
      )
      assert.equal(setupOutcome.message, holdCase.pendingSentence)
      assert.deepEqual(window.notices, [
        {
          severity: 'information',
          message:
            "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
          actions: ['Reload Window'],
        },
      ])
      assert.deepEqual(window.state.get('codebook.aiChatSetup'), {
        workspace: window.directory,
      })
      assert.equal(await window.readDescriptorField(), true)
    } finally {
      await window.loaded.deactivate()
    }
  })
}
