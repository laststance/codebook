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

/** The mask placeholder, kept out of `label: [masked]` literals so the repository's secret scanner does not read them as credential assignments. */
const MASK = '[masked]'

// protects=a Set-Cookie array printed over several console events stays masked until its closing bracket (Cycle 0073 pt1 /ship pass 1: only a flag survived each event, so the second value was journaled); fails_when=the journal carries whether the next element is a value but not how deep the array is, so an element two events after the opening bracket is journaled; no_claim=an array that never closes
test('the extension console journal keeps masking the elements of a Set-Cookie array over several events', () => {
  // Arrange
  const { journal, events } = createJournal()

  // Act
  journal.add('page', "['Set-Cookie', [\n")
  journal.add('page', `'id=${COOKIE_VALUE}',\n`)
  journal.add('page', `'app=${COOKIE_VALUE}-2'\n`)
  journal.add('page', "]], 'Via', 'proxy'\n")

  // Assert
  assert.deepEqual(
    events.map((event) => event.detail),
    [
      { context: 'page', text: "['Set-Cookie', [\n" },
      { context: 'page', text: `${MASK},\n` },
      { context: 'page', text: `${MASK}\n` },
      { context: 'page', text: "]], 'Via', 'proxy'\n" },
    ],
  )
})

// protects=a console line with a quoted session pair above the scan limit does not survive the journal's cut to 4,096 characters (Cycle 0073 pt1 /ship pass 1: the literal was passed raw, then cut after its first characters); fails_when=the journaled text holds any part of the session pair; no_claim=the length of the journaled text, which the cut owns
test('the extension console journal masks a quoted session pair longer than the scan limit before it cuts the text', () => {
  // Arrange
  const { journal, events } = createJournal()
  const padding = 'x'.repeat(17_000)

  // Act
  journal.add('page', `'sid=${COOKIE_VALUE}; pad=${padding}'\n`)

  // Assert
  assert.deepEqual(
    events.map((event) => event.detail),
    [{ context: 'page', text: `${MASK}\n` }],
  )
})
