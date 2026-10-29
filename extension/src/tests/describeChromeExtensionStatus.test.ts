import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeChromeExtensionStatus,
  type ChromeExtensionStatusInput,
} from '../utils/describeChromeExtensionStatus'

const BASE: ChromeExtensionStatusInput = {
  phase: 'ready',
  surfaceKind: 'popup',
  clicksDeclared: 2,
  clicksPerformed: 0,
  stopsDeclared: 2,
  stopsNotReached: 2,
}

/** The status item text of a state that differs from the base. */
function statusItem(overrides: Partial<ChromeExtensionStatusInput>): string {
  return describeChromeExtensionStatus({ ...BASE, ...overrides }).statusItem
}

// Value: protects=C4, SR24: the preparation phases read as the status table words; fails_when=a phase word changes; no_claim=the viewport rendering
test('words each preparation phase as the status table does', () => {
  // Act
  const words = (
    [
      'starting',
      'launching',
      'installing',
      'opening',
      'waking',
      'arming',
    ] as const
  ).map((phase) => statusItem({ phase }))
  // Assert
  assert.deepEqual(words, [
    'Installing extension…',
    'Installing extension…',
    'Installing extension…',
    'Opening the extension popup…',
    'Waiting for the service worker…',
    'Setting stops…',
  ])
  assert.equal(
    statusItem({ phase: 'opening', surfaceKind: 'page' }),
    'Opening the extension page…',
  )
})

// Value: protects=DR2: ready names the next click and a dispatched click names its title; fails_when=the counts are 0-based or the title is missing; no_claim=the title source
test('words waiting for chat and a dispatched click with 1-based counts', () => {
  // Act / Assert
  assert.equal(statusItem({}), 'Waiting for chat · next click 1 of 2')
  assert.equal(
    statusItem({ clicksPerformed: 1, dispatchedClickTitle: 'Open dialog' }),
    'Clicked "Open dialog" (1 of 2)',
  )
})

// Value: protects=DR3: a pause names its stop, the total and its context; fails_when=the context words or the order change; no_claim=the pinned frame
test('words a pause with its stop number, the total and its context', () => {
  // Act / Assert
  assert.equal(
    statusItem({
      phase: 'paused',
      pause: { stopIndex: 2, context: 'service-worker' },
    }),
    'Paused at stop 2 of 2 · service worker',
  )
  assert.equal(
    statusItem({ phase: 'paused', pause: { stopIndex: 1, context: 'page' } }),
    'Paused at stop 1 of 2 · page',
  )
})

// Value: protects=DR5, SR24: the finished run reads its stops and result, never the word complete alone, and the viewport adds the click count; fails_when=a result word is missing or the lines are swapped; no_claim=the observed value
test('words the finished run with stops, result and clicks for the viewport', () => {
  // Arrange
  const input = {
    ...BASE,
    phase: 'completed' as const,
    clicksPerformed: 2,
    stopsNotReached: 1,
    observationResult: 'changed' as const,
  }
  // Act
  const text = describeChromeExtensionStatus(input)
  // Assert
  assert.deepEqual(text, {
    statusItem: 'Run finished · stops 1/2 · result changed',
    viewportPhase: 'clicks 2/2 · stops 1/2 · result changed',
  })
  assert.equal(/complete/i.test(text.statusItem + text.viewportPhase), false)
})

// Value: protects=DR9, C4: reading the result is worded and no text of any phase offers to save; fails_when=a save action appears in a status word; no_claim=the Save command's own gating (service)
test('words reading the result and offers no save action in any phase', () => {
  // Arrange
  const phases = [
    'starting',
    'launching',
    'installing',
    'opening',
    'attaching',
    'waking',
    'arming',
    'ready',
    'paused',
    'observing',
    'completed',
    'failed',
  ] as const
  // Act
  const all = phases.map((phase) => statusItem({ phase }))
  // Assert
  assert.equal(statusItem({ phase: 'observing' }), 'Reading the result…')
  assert.equal(
    all.some((text) => /save/i.test(text)),
    false,
  )
})

// Value: protects=DR10: a failure reads its sentence and then the fixed next-step line of its kind; fails_when=a line is swapped between kinds; no_claim=the sentence text (error tests)
test('words a failure with its sentence and the next-step line of its kind', () => {
  // Act
  const lines = (['before-launch', 'refused-click', 'ended'] as const).map(
    (failureKind) =>
      statusItem({
        phase: 'failed',
        failureSentence: 'The extension surface closed or left the extension.',
        failureKind,
      }),
  )
  // Assert
  assert.deepEqual(lines, [
    'The extension surface closed or left the extension. The chat can explain this part from source.',
    'The extension surface closed or left the extension. Nothing was clicked; ask the chat to retry or stop.',
    'The extension surface closed or left the extension. Start a new run to try again.',
  ])
})
