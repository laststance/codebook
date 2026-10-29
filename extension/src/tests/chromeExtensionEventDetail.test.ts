import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CHROME_EXTENSION_EVENT_TYPES,
  chromeExtensionEventDetail,
} from '../utils/chromeExtensionEventDetail'
import type { JournaledEvent } from '../utils/createBoundedEventJournal'
import { createChromeExtensionJournal } from '../utils/createChromeExtensionJournal'

// Value: protects=SR32: each whitelisted event publishes only its fields, masked and root-hidden; fails_when=an extra field, a path or a bearer token reaches the journal; no_claim=journal bounds (bounded journal tests)
test('publishes only the whitelisted fields of each chrome-extension event', () => {
  // Arrange
  const sanitize = (text: string): string =>
    text.replaceAll('/Users/ada', '<home>')
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    [
      'chrome-extension.click',
      { clickIndex: 2, selector: '#go', cwd: '/x' },
      { clickIndex: 2, selector: '#go' },
    ],
    [
      'chrome-extension.output',
      {
        context: 'service-worker',
        text: 'at /Users/ada/a.js Bearer abcdefgh12345',
        extra: 1,
      },
      { context: 'service-worker', text: 'at <home>/a.js Bearer [masked]' },
    ],
    [
      'chrome-extension.prepare-pause',
      { path: 'popup.js', line: 3, context: 'page' },
      { path: 'popup.js', line: 3, context: 'page' },
    ],
    [
      'chrome-extension.repeat-hit',
      { stopIndex: 1, path: 'popup.js', line: 3 },
      { stopIndex: 1, path: 'popup.js', line: 3 },
    ],
    ['chrome-extension.surface-lost', { surface: 'page' }, { surface: 'page' }],
    [
      'chrome-extension.context-mismatch',
      { stopIndex: 2, context: 'service-worker' },
      { stopIndex: 2, context: 'service-worker' },
    ],
    [
      'chrome-extension.intervention',
      { kind: 'stop-all-workers', time: '2026-10-29T00:00:00.000Z' },
      { kind: 'stop-all-workers', time: '2026-10-29T00:00:00.000Z' },
    ],
    [
      'chrome-extension.phase',
      { name: 'waking', elapsedMs: 1200 },
      { name: 'waking', elapsedMs: 1200 },
    ],
    [
      'chrome-extension.dialog',
      { clickIndex: 1, type: 'confirm', answer: 'accept', message: 'Delete?' },
      { clickIndex: 1, type: 'confirm', answer: 'accept', message: 'Delete?' },
    ],
    [
      'chrome-extension.dialog',
      { type: 'alert', answer: 'dismiss', message: 'Hi' },
      { type: 'alert', answer: 'dismiss', message: 'Hi' },
    ],
    [
      'chrome-extension.debugger-error',
      { message: 'failed in /Users/ada/x' },
      { message: 'failed in <home>/x' },
    ],
    ['chrome-extension.output-dropped', { count: 7 }, { count: 7 }],
  ]
  // Act
  const published = cases.map(([type, detail]) =>
    chromeExtensionEventDetail(type, detail, sanitize),
  )
  // Assert
  assert.deepEqual(
    published,
    cases.map(([, , expected]) => expected),
  )
})

// Value: protects=SR32: an event type without a row reads omitted, and the exported type list names every row; fails_when=an unlisted type publishes its fields or the list drifts from the table; no_claim=the help text generated from the list
test('omits an unlisted event type and lists every whitelisted type', () => {
  // Act
  const unknown = chromeExtensionEventDetail('chrome-extension.surprise', {
    secret: 'x',
  })
  // Assert
  assert.deepEqual(unknown, { omitted: true })
  assert.deepEqual(CHROME_EXTENSION_EVENT_TYPES, [
    'chrome-extension.click',
    'chrome-extension.output',
    'chrome-extension.output-dropped',
    'chrome-extension.prepare-pause',
    'chrome-extension.repeat-hit',
    'chrome-extension.surface-lost',
    'chrome-extension.context-mismatch',
    'chrome-extension.intervention',
    'chrome-extension.phase',
    'chrome-extension.dialog',
    'chrome-extension.debugger-error',
    'chrome-extension.view-unavailable',
  ])
})

// Value: protects=SR32: the journal factory whitelists each event before it is kept and sequences them; fails_when=a raw field is kept or sequences skip; no_claim=truncation (bounded journal tests)
test('the chrome-extension journal keeps whitelisted events in sequence', () => {
  // Arrange
  const events: JournaledEvent[] = []
  const record = createChromeExtensionJournal(events, {
    sanitize: (text) => text,
  })
  // Act
  record('chrome-extension.click', { clickIndex: 1, selector: '#go', raw: 'x' })
  record('chrome-extension.unknown', { raw: 'x' })
  // Assert
  assert.deepEqual(events, [
    {
      sequence: 1,
      type: 'chrome-extension.click',
      detail: { clickIndex: 1, selector: '#go' },
    },
    {
      sequence: 2,
      type: 'chrome-extension.unknown',
      detail: { omitted: true },
    },
  ])
})
