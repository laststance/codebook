import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ExtensionOutputJournal } from '../chromeExtensionOutputJournal'

// The scripted secrets are made-up opaque strings; they are split so no scanner reads them as a real credential.
const COOKIE_VALUE = ['SESSION', 'COOKIE', 'VALUE', 'opaque', '8f3a91c2'].join(
  '-',
)
const BASIC_CREDENTIAL = ['dXNlcjpT', 'M2NyZXRQ', 'YXNz'].join('')

/**
 * Makes a journal over a recording function and returns both ends.
 * @returns The journal and the events it recorded, in order.
 * @example const { journal, events } = createJournal()
 */
function createJournal(): {
  journal: ExtensionOutputJournal
  events: { type: string; detail: unknown }[]
} {
  const events: { type: string; detail: unknown }[] = []
  const journal = new ExtensionOutputJournal(
    (type, detail) => events.push({ type, detail }),
    { storage: [] },
  )
  return { journal, events }
}

// protects=a popup or service worker that prints a cookie or an Authorization value to its console (Cycle 0073 task 0 review: `console.log(document.cookie)` was journaled whole); fails_when=the journal masks only credential prefixes, so a cookie header or a Basic value reaches the history; no_claim=a credential with none of these shapes
test('the extension console journal masks a printed document.cookie and a printed Authorization value', () => {
  // Arrange
  const { journal, events } = createJournal()

  // Act
  journal.add('page', `sid=${COOKIE_VALUE}; theme=dark\n`)
  journal.add('service-worker', `Authorization: Basic ${BASIC_CREDENTIAL}\n`)
  journal.add('service-worker', 'View mode: Popup\n')

  // Assert
  assert.deepEqual(events, [
    {
      type: 'chrome-extension.output',
      detail: { context: 'page', text: '[masked]\n' },
    },
    {
      type: 'chrome-extension.output',
      detail: { context: 'service-worker', text: 'Authorization: [masked]\n' },
    },
    {
      type: 'chrome-extension.output',
      detail: { context: 'service-worker', text: 'View mode: Popup\n' },
    },
  ])
})

// protects=a header list printed over two console events keeps its name and value pairing per context; fails_when=the element after 'Cookie' in the next event is journaled, or one context's header name masks the other context's next element; no_claim=a list whose name and value are separated by other elements
test('the extension console journal masks the element that follows a header name printed in the previous event of the same context only', () => {
  // Arrange
  const { journal, events } = createJournal()

  // Act
  journal.add('page', "[\n  'Host',\n  'x',\n  'Cookie',\n")
  journal.add('service-worker', "  'ready',\n")
  journal.add('page', `  'sid=${COOKIE_VALUE}; theme=dark',\n]\n`)

  // Assert
  assert.deepEqual(
    events.map((event) => event.detail),
    [
      { context: 'page', text: "[\n  'Host',\n  'x',\n  'Cookie',\n" },
      { context: 'service-worker', text: "  'ready',\n" },
      { context: 'page', text: '  [masked],\n]\n' },
    ],
  )
})
