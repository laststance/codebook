import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

/** The removal steps a test holds, with the harness option and hold of each and what the removal's warning names as done while that step waits. */
const REMOVAL_HOLD_CASES = [
  {
    step: 'skill',
    option: 'holdSkillRemoval',
    hold: 'skillRemoval',
    doneSentences: (): string[] => [],
  },
  {
    step: 'MCP entry',
    option: 'holdEntryRemoval',
    hold: 'entryRemoval',
    doneSentences: (): string[] => [
      'Codebook removed its Devin Desktop skill.',
    ],
  },
  {
    step: 'saved setup',
    option: 'holdSavedSetupWrite',
    hold: 'savedSetupWrite',
    doneSentences: (configPath: string): string[] => [
      'Codebook removed its Devin Desktop skill.',
      `Codebook removed its codebook entry from ${configPath} and kept the file's other entries.`,
    ],
  },
  {
    step: 'descriptor',
    option: 'holdDescriptorUnmark',
    hold: 'descriptorUnmark',
    doneSentences: (configPath: string): string[] => [
      'Codebook removed its Devin Desktop skill.',
      `Codebook removed its codebook entry from ${configPath} and kept the file's other entries.`,
    ],
  },
] as const

for (const holdCase of REMOVAL_HOLD_CASES) {
  // Value: protects=a Remove Devin Desktop Setup whose step waits on storage answers within the removal budget with a warning that names only the changes made so far and the step that waits, offers no reload, refuses a setup and a second removal meanwhile (the second removal before its question), holds the setup lock until its last step, and shows its own notice with Reload Window once storage answers (Cycle 0146 task 1a, v2 finding 11; /ship pass 1, specialist testing 3); fails_when=the removal waits for ever, its warning claims a change that has not happened (the skill case names no entry), it offers a reload too early, a setup joins it, a second removal asks its question again, or another window's setup runs before the removal's last step; no_claim=a removal whose step fails (a refusal); a stand-in step held at a gate stands for the stalled storage, and both windows share one extension host and one storage folder
  test(`a Devin removal whose ${holdCase.step} step waits on storage answers within the budget with only the changes made so far, then shows its own notice once storage answers`, async (context) => {
    // Arrange
    const first = await devinWindow(context, {
      savedSetup: true,
      confirmRemoval: true,
      [holdCase.option]: true,
    })
    let hadRemovalEndedWhenSecondStarted: boolean | undefined
    const second = await devinWindow(context, {
      storageDirectory: first.directory,
      instanceLabel: 'second',
      onResolveNode: (): void => {
        hadRemovalEndedWhenSecondStarted = first.notices.some((notice) =>
          notice.actions.includes('Reload Window'),
        )
      },
    })
    try {
      await first.whenReconnected()
      await waitUntil(
        async () => (await first.readDescriptorField()) === true,
        "the reconnect's marked descriptor",
      )
      // Act
      const removalAnswer = await within(
        first.commands.get('codebook.removeManagedDevinSetup')!().then(() =>
          performance.now(),
        ),
        16_000,
      )
      const stepReachedAtMs = first.holds[holdCase.hold].reachedAtMs()
      const noticesWhileWaiting = structuredClone(first.notices)
      const setupRefusal = await within(
        first.commands.get('codebook.setupAiChat')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        2_000,
      )
      const secondRemovalRefusal = await within(
        first.commands.get('codebook.removeManagedDevinSetup')!().then(
          () => 'resolved',
          (error: Error) => error.message,
        ),
        2_000,
      )
      const secondSetup = second.commands.get('codebook.setupAiChat')!()
      // Without the lock the second window's first step follows within milliseconds; half a second without it shows it waits.
      await assert.rejects(
        waitUntil(
          () => second.steps.length > 0,
          "the second window's setup to start while the removal holds the lock",
          500,
        ),
        {
          message:
            "Timed out waiting for the second window's setup to start while the removal holds the lock",
        },
      )
      first.holds[holdCase.hold].release()
      await waitUntil(
        () => first.notices.length === 2,
        "the removal's own notice",
      )
      await secondSetup
      // Assert
      assert.ok(removalAnswer !== 'still waiting', 'the removal answered')
      assert.ok(stepReachedAtMs !== undefined, 'the held step was reached')
      const answeredAfterMs = removalAnswer - stepReachedAtMs
      assert.ok(
        answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
        `the removal answered ${answeredAfterMs} ms after its ${holdCase.step} step was reached`,
      )
      assert.deepEqual(noticesWhileWaiting, [
        {
          severity: 'warning',
          message: [
            ...holdCase.doneSentences(first.configPath),
            `Codebook's removal of the Devin Desktop setup is still waiting on storage (${holdCase.step}) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.`,
          ].join(' '),
          actions: [],
        },
      ])
      assert.equal(
        setupRefusal,
        'Codebook is still removing the Devin Desktop setup because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window.',
      )
      // The second removal refuses before its question: only the first one asked.
      assert.equal(
        secondRemovalRefusal,
        'Codebook is still removing the Devin Desktop setup because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
      )
      assert.equal(first.modalQuestions.length, 1)
      assert.deepEqual(first.notices[1], {
        severity: 'information',
        message: `Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from ${first.configPath} and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again.`,
        actions: ['Reload Window'],
      })
      assert.equal(first.state.get('codebook.aiChatSetup'), undefined)
      assert.equal(await first.readDescriptorField(), undefined)
      assert.equal(hadRemovalEndedWhenSecondStarted, true)
      assert.deepEqual(second.steps, [
        'resolve Node',
        'deploy Devin skill',
        'start server',
        'write MCP entry',
        'verify Devin skill',
      ])
    } finally {
      await first.loaded.deactivate()
      await second.loaded.deactivate()
    }
  })
}
