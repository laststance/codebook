import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { devinWindow } from './utils/devinChatOnboardingHarness'
import { within } from './utils/within'

// Value: protects=a Devin setup whose skill deployment never returns answers within the setup budget with the step that waits, a Remove Devin Desktop Setup issued meanwhile refuses at once without its question, and the setup's own notice with Reload Window follows once storage answers (Cycle 0146 task 13); fails_when=the command waits for the deployment for ever, the removal waits for the setup or asks its question, or the setup's end is never shown; no_claim=a forward step that fails after it answered (its warning); the held stand-in deployment stands for the stalled storage
test('a Devin setup whose skill deployment never returns answers within the budget, a removal meanwhile refuses, and its own notice follows once storage answers', async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    confirmRemoval: true,
  })
  try {
    // Act
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => ({ atMs: performance.now(), message: 'resolved' }),
      (error: Error) => ({ atMs: performance.now(), message: error.message }),
    )
    // A setup that fails before its deployment ends the race too, so the test fails in its assertion instead of waiting.
    const deployReachedAtMs = await within(
      Promise.race([
        window.deployReached.then(() => performance.now()),
        setupEnd.then(() => 'setup ended first'),
      ]),
      5_000,
    )
    const setupOutcome = await within(setupEnd, 16_000)
    const removalRefusal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    window.releaseDeploy()
    await waitUntil(() => window.notices.length > 0, "the setup's own notice")
    // Assert
    assert.ok(
      typeof deployReachedAtMs === 'number',
      'the setup reached its deployment',
    )
    assert.ok(setupOutcome !== 'still waiting', 'the setup command answered')
    const answeredAfterMs = setupOutcome.atMs - deployReachedAtMs
    assert.ok(
      answeredAfterMs >= 9_000 && answeredAfterMs <= 15_000,
      `the setup command answered ${answeredAfterMs} ms after the deployment was reached`,
    )
    assert.equal(
      setupOutcome.message,
      "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.equal(
      removalRefusal,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
    assert.deepEqual(window.modalQuestions, [])
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

// Value: protects=a Remove Devin Desktop Setup confirmed while a setup's skill deployment still waits, before that step's 10-second lapse, answers within about 12 seconds that Codebook is still setting up Devin Desktop, removes nothing, and the setup still ends with its own ready notice once storage answers (Cycle 0146 task 15); fails_when=the removal goes on to the setup lock once the setup's command answered early, so it waits behind that setup and ends after about 25 seconds with the sentence that another window is changing the setup, or its removal flag makes the background setup fail; no_claim=a removal whose question is still open at the lapse (the same check runs after the question; the harness answers the question at once); the held stand-in deployment stands for the stalled storage
test("a Devin removal confirmed while a setup's step still waits refuses with the setting-up sentence once that step waited 10 seconds", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    confirmRemoval: true,
  })
  try {
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    // A setup that fails before its deployment ends the race too, so the test fails in its assertion instead of waiting.
    const deployOutcome = await within(
      Promise.race([window.deployReached.then(() => 'reached'), setupEnd]),
      5_000,
    )
    // Act
    const removalStartedAtMs = performance.now()
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => ({ atMs: performance.now(), message: 'resolved' }),
        (error: Error) => ({ atMs: performance.now(), message: error.message }),
      ),
      16_000,
    )
    const setupOutcome = await within(setupEnd, 1_000)
    window.releaseDeploy()
    await waitUntil(() => window.notices.length > 0, "the setup's own notice")
    // Assert
    assert.equal(deployOutcome, 'reached')
    assert.ok(removalOutcome !== 'still waiting', 'the removal answered')
    const answeredAfterMs = removalOutcome.atMs - removalStartedAtMs
    assert.ok(
      answeredAfterMs <= 12_000,
      `the removal answered ${answeredAfterMs} ms after it was confirmed`,
    )
    assert.equal(
      removalOutcome.message,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
    assert.equal(
      setupOutcome,
      "Codebook's Devin Desktop setup is still waiting on storage (skill) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window.",
    )
    assert.deepEqual(window.modalQuestions, [
      "Remove the Codebook-owned Devin Desktop skill and Codebook's entry in Devin's MCP config? Every Devin Desktop window of this user shares them.",
    ])
    assert.equal(window.steps.includes('remove Devin skill'), false)
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

// Value: protects=after a removal refused because a setup of this window answered early while its skill deployment still waits, that setup's background state stands: Set Up AI Chat and a second Remove Devin Desktop Setup still refuse at once with the setting-up sentence, the second asks no question, and the Output says the setup ended only once storage answered (Cycle 0146 task 15); fails_when=the removal's own end clears the setup's background state and writes its end line, so a later command waits for the setup lock instead of refusing; no_claim=the removal's own answer (the test above); the held stand-in deployment stands for the stalled storage
test("a Devin removal that refused while a setup still runs leaves that setup's refusal of further commands in place", async (context) => {
  // Arrange
  const window = await devinWindow(context, {
    holdDeploy: true,
    confirmRemoval: true,
  })
  const setupEndedLine =
    "Codebook's Devin Desktop setup ended now that storage answered, so Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup run again in this window."
  try {
    const setupEnd = window.commands.get('codebook.setupAiChat')!().then(
      () => 'resolved',
      (error: Error) => error.message,
    )
    const deployOutcome = await within(
      Promise.race([window.deployReached.then(() => 'reached'), setupEnd]),
      5_000,
    )
    // A removal that waits for the setup lock ends after about 25 seconds, so it is waited for that long before the commands below.
    const removalOutcome = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      30_000,
    )
    // Act
    // Each answer is waited for 2 seconds at most: a command that waits for the setup lock answers 'still waiting'.
    const setupRefusal = await within(
      window.commands.get('codebook.setupAiChat')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    const secondRemovalRefusal = await within(
      window.commands.get('codebook.removeManagedDevinSetup')!().then(
        () => 'resolved',
        (error: Error) => error.message,
      ),
      2_000,
    )
    const hadEndedLineWhileRunning = window.outputLines.includes(setupEndedLine)
    window.releaseDeploy()
    await waitUntil(() => window.notices.length > 0, "the setup's own notice")
    // Assert
    assert.equal(deployOutcome, 'reached')
    assert.equal(
      setupRefusal,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window.',
    )
    assert.equal(
      secondRemovalRefusal,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
    assert.equal(window.modalQuestions.length, 1)
    assert.equal(hadEndedLineWhileRunning, false)
    assert.equal(window.outputLines.includes(setupEndedLine), true)
    assert.equal(
      removalOutcome,
      'Codebook is still setting up Devin Desktop because storage does not answer. Run Codebook: Remove Devin Desktop Setup again once it finishes, or reload the window.',
    )
  } finally {
    await window.loaded.deactivate()
  }
})
