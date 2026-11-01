import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeNodeLearningSave } from '../utils/describeNodeLearningSave'

// Value: protects=the status item's text and tooltip before the first stop, during the run and after Stop; fails_when=preparing offers Save, the live text loses its stop count, or the finished text loses its $(save) icon; why_new=a test run had no Save item (C49-2, DS8, EN1); seam=none; no_claim=which command each state assigns (NodeLearningSave tests)
test('the Save item reads preparing, then the stops reached during the run, then finished after Stop', () => {
  // Arrange / Act
  const preparing = describeNodeLearningSave({ kind: 'preparing' })
  const live = describeNodeLearningSave({
    kind: 'live',
    reached: 1,
    declared: 2,
  })
  const finished = describeNodeLearningSave({ kind: 'finished' })

  // Assert
  assert.deepEqual(preparing, {
    text: '$(sync~spin) Preparing the test run…',
    tooltip:
      'Codebook is preparing the test run; Save learning replay appears once the first stop is recorded.',
  })
  assert.deepEqual(live, {
    text: '$(record) Recording explanation · stop 1 of 2 · Save learning replay',
    tooltip:
      "Save learning replay ends this test run and saves its recorded output, source, debugger stops and the chat's learning material.",
  })
  assert.deepEqual(finished, {
    text: '$(save) Recording finished · Save learning replay',
    tooltip:
      "Save learning replay saves the sealed test history with the chat's learning material.",
  })
})

// Value: protects=the saved and partially saved states, with every missing part in order and the verdict; fails_when=a part is dropped or reordered, or a failing test with nothing missing reads Missing; why_new=Save named "complete execution/capture evidence" for every gap (DS9, X3); seam=none; no_claim=how the parts are found (listMissingNodeLearning tests)
test('saved reads the verdict and every stop explained, and partially saved names each missing part in order', () => {
  // Arrange / Act
  const saved = describeNodeLearningSave({
    kind: 'saved',
    verdict: 'Test passed · exit code 0',
    stops: 2,
  })
  const partial = describeNodeLearningSave({
    kind: 'partial',
    verdict: 'Test passed · exit code 0',
    missing: [
      { kind: 'stop', stop: 2 },
      { kind: 'result' },
      { kind: 'stop-state', stop: 1 },
    ],
  })
  const failingWithNothingMissing = describeNodeLearningSave({
    kind: 'partial',
    verdict: 'Test failed · exit code 1',
    missing: [],
  })

  // Assert
  assert.deepEqual(saved, {
    text: '$(check) Learning saved · Open replay',
    tooltip:
      'Saved: Test passed · exit code 0 · capture complete · 2 of 2 stops explained. Opens the test replay.',
  })
  assert.equal(
    partial.text,
    '$(warning) Learning partially saved · Open replay',
  )
  assert.equal(
    partial.tooltip,
    'Saved available learning · Test passed · exit code 0 · Missing: an explanation step for stop 2, an explanation step for the result, recorded debugger state of stop 1. Open replay to inspect retained evidence.',
  )
  assert.equal(
    failingWithNothingMissing.tooltip,
    'Saved available learning · Test failed · exit code 1. Open replay to inspect retained evidence.',
  )
})

// Value: protects=the three failed stages of Save, each naming its stage, its cause and what a click does; fails_when=a stop rejection, a failed read-back or a failed seal reads like another stage, or a cause is shown longer than 300 characters; why_new=Save had one "Learning save failed · Retry" for every failure (X6); seam=none; no_claim=what each Retry does (NodeLearningSave tests)
test('a rejected stop, a failed read-back and a failed seal each name their stage and cause', () => {
  // Arrange
  const longCause = 'EIO: i/o error '.repeat(40)

  // Act
  const stopRejected = describeNodeLearningSave({
    kind: 'stop-rejected',
    cause: 'debugger did not release',
  })
  const readFailed = describeNodeLearningSave({
    kind: 'read-failed',
    cause: 'EACCES: permission denied',
  })
  const sealFailed = describeNodeLearningSave({
    kind: 'seal-failed',
    cause: longCause,
  })

  // Assert
  assert.deepEqual(stopRejected, {
    text: '$(error) Learning save failed · Retry',
    tooltip:
      'Learning save failed: stopping the test run did not finish (debugger did not release). What was recorded is kept; click to stop it again. Details: Output › Codebook.',
  })
  assert.deepEqual(readFailed, {
    text: '$(error) Learning save failed · Retry',
    tooltip:
      'Learning save failed: the test history was sealed but could not be read back (EACCES: permission denied). Click to read it again; the test does not run again. Details: Output › Codebook.',
  })
  assert.equal(
    sealFailed.text,
    '$(error) Learning save failed · Open retained history',
  )
  assert.ok(sealFailed.tooltip?.includes('… [cut]'))
  assert.ok(!sealFailed.tooltip?.includes(longCause))
})

// Value: protects=the question before the result and the partial-save notification, which offers an explanation only for an explanation gap; fails_when=the question loses the stop count, a capture gap is offered to the chat, or a sentence appears that does not apply; why_new=Save ended a live test silently and offered no recovery (DS8, DS9, X3); seam=none; no_claim=when NodeLearningSave raises them
test('the question names the stops reached, and the partial notice composes only the sentences that apply', () => {
  // Arrange / Act
  const question = describeNodeLearningSave({
    kind: 'question',
    reached: 1,
    declared: 3,
  })
  const failingWithGaps = describeNodeLearningSave({
    kind: 'partial-notice',
    result: { exitCode: 1, signal: null },
    explanations: [{ kind: 'stop', stop: 2 }],
    capture: [{ kind: 'stop-state', stop: 2 }],
  })
  const signalled = describeNodeLearningSave({
    kind: 'partial-notice',
    result: { exitCode: null, signal: 'SIGTERM' },
    explanations: [],
    capture: [],
  })
  const explanationOnly = describeNodeLearningSave({
    kind: 'partial-notice',
    result: { exitCode: 0, signal: null },
    explanations: [{ kind: 'summary' }],
    capture: [],
  })

  // Assert
  assert.deepEqual(question, {
    text: 'Saving ends the test run before its result (1 of 3 stops reached). Save now?',
    actions: ['Save now'],
  })
  assert.deepEqual(failingWithGaps, {
    text: 'Learning partially saved. The test did not pass (exit code 1); the replay holds the failing run. Ask the chat for an explanation step for stop 2, then save again. Not recorded: recorded debugger state of stop 2. An explanation cannot add them; only a new test run records them.',
    actions: ['Open replay'],
  })
  assert.equal(
    signalled.text,
    'Learning partially saved. The test ended by signal SIGTERM; the replay holds the run up to it.',
  )
  assert.equal(
    explanationOnly.text,
    'Learning partially saved. Ask the chat for learning summary and sequence, then save again.',
  )
})

// Value: protects=the open refusal during a browser replay and the open failure, each with its action; fails_when=either reads otherwise than the String catalog; why_new=Open replay for a test replay is new (DS10, X4); seam=none; no_claim=the Output entry of a failed open
test('opening a test replay during a browser replay is refused, and a failed open names the replay and its cause', () => {
  // Arrange / Act
  const refused = describeNodeLearningSave({ kind: 'open-refused' })
  const failed = describeNodeLearningSave({
    kind: 'open-failed',
    title:
      'src/scheduler.test.ts › job scheduler › runs a delayed job after its timer',
    cause: 'Sealed Node history journal is corrupt.',
  })

  // Assert
  assert.deepEqual(refused, {
    text: 'Codebook shows one replay at a time. Close the browser replay to open this test replay.',
    actions: ['Close browser replay'],
  })
  assert.deepEqual(failed, {
    text: 'Codebook could not open the test replay "src/scheduler.test.ts › job scheduler › runs a delayed job after its timer": Sealed Node history journal is corrupt. The saved history is unchanged; open it again from Saved studies.',
    actions: ['Show details'],
  })
})

// protects=N69: the open-failure notice names an Extension replay an Extension replay, and server and test replays keep their words; fails_when=an Extension replay is called a test replay
test('a failed open names an Extension replay, a server replay and a test replay each by its own word', () => {
  // Arrange / Act
  const extension = describeNodeLearningSave({
    kind: 'open-failed',
    profile: 'chrome-extension',
    title: 'Popup click',
    cause: 'Native pane changed.',
  })
  const server = describeNodeLearningSave({
    kind: 'open-failed',
    profile: 'node-server',
    title: 'Popup click',
    cause: 'Native pane changed.',
  })
  const testReplay = describeNodeLearningSave({
    kind: 'open-failed',
    profile: 'node-test',
    title: 'Popup click',
    cause: 'Native pane changed.',
  })

  // Assert
  assert.equal(
    extension.text,
    'Codebook could not open the Extension replay "Popup click": Native pane changed. The saved history is unchanged; open it again from Saved studies.',
  )
  assert.equal(
    server.text,
    'Codebook could not open the server replay "Popup click": Native pane changed. The saved history is unchanged; open it again from Saved studies.',
  )
  assert.equal(
    testReplay.text,
    'Codebook could not open the test replay "Popup click": Native pane changed. The saved history is unchanged; open it again from Saved studies.',
  )
})
