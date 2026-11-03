import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NodeServerHistoryEntry } from '../nodeServerHistorySchemas'
import type { NodeTestHistoryEntry } from '../nodeTestHistorySchemas'
import { maskSavedOutputEntries } from '../utils/maskSavedOutputEntries'
import { maskSavedServerEntries } from '../utils/maskSavedServerEntries'

// The values below are what a history saved by 0.2.73.1 or earlier holds: made-up opaque values that only the shape of their line marks as credentials.
const SESSION_VALUE = ['opaque', 'session', 'value', '4f9c2d71'].join('-')
const BASIC_CREDENTIAL = ['dXNlcjpw', 'YXNzd29y', 'ZHZhbHVl'].join('')
const CALLBACK_CODE = ['callback', 'code', '8e1b3a65'].join('-')

/** An output entry of a Node server journal. */
function serverOutput(
  sequence: number,
  channel: 'stdout' | 'stderr',
  text: string,
): NodeServerHistoryEntry {
  return { type: 'output', sequence, elapsedMs: sequence * 10, channel, text }
}

/** An output entry of a Node test journal. */
function testOutput(
  sequence: number,
  channel: 'stdout' | 'stderr',
  text: string,
): NodeTestHistoryEntry {
  return {
    type: 'output',
    sequence,
    elapsedMs: sequence * 10,
    outputSequence: sequence,
    channel,
    text,
  }
}

/** The texts of the output entries, in order. */
function outputTexts(
  entries: readonly (NodeServerHistoryEntry | NodeTestHistoryEntry)[],
): string[] {
  return entries.flatMap((entry) =>
    entry.type === 'output' ? [entry.text] : [],
  )
}

// protects=a Cookie line the process logged in one write and saved in the next entry is masked whole when the history is served; fails_when=each saved entry is masked on its own, so the half of the line in the first entry and the half in the second both stay readable; no_claim=the boundaries between served entries, which move to where the line ends
test('a Cookie line split over two saved output entries is masked whole', () => {
  // Arrange
  const entries = [
    testOutput(1, 'stdout', 'ready\n'),
    testOutput(2, 'stdout', `Cookie: sid=${SESSION_VALUE.slice(0, 8)}`),
    testOutput(3, 'stdout', `${SESSION_VALUE.slice(8)}; theme=dark\nnext\n`),
  ]

  // Act
  const served = maskSavedOutputEntries(entries)

  // Assert
  assert.equal(outputTexts(served).join('').includes(SESSION_VALUE), false)
  assert.equal(outputTexts(served).join(''), 'ready\nCookie: [masked]\nnext\n')
})

// protects=a printed rawHeaders list whose Cookie name and value land in two saved entries is masked; fails_when=the pairing of a quoted secret header name with the next element is lost at the entry boundary; no_claim=lists logged by a different library
test('the element after a quoted Cookie name in the next saved output entry is masked', () => {
  // Arrange
  const entries = [
    serverOutput(
      1,
      'stdout',
      "[\n  'Host',\n  'localhost:3000',\n  'Cookie',\n",
    ),
    serverOutput(
      2,
      'stdout',
      `  'sid=${SESSION_VALUE}',\n  ... 2 more items\n]\n`,
    ),
  ]

  // Act
  const served = maskSavedServerEntries(entries)

  // Assert
  assert.equal(JSON.stringify(served).includes(SESSION_VALUE), false)
  assert.equal(
    outputTexts(served).join(''),
    "[\n  'Host',\n  'localhost:3000',\n  'Cookie',\n  [masked],\n  ... 2 more items\n]\n",
  )
})

// protects=standard output and standard error are separate streams: an unfinished line on one channel is not joined with the other channel's text; fails_when=the channels are read as one stream, so a Cookie line broken by a stderr write stays readable or an innocent stderr line is swallowed; no_claim=how the terminal interleaves the two
test('an unfinished Cookie line on stdout is joined across a stderr entry and the stderr text is left as it is', () => {
  // Arrange
  const entries = [
    serverOutput(1, 'stdout', 'Cookie: sid='),
    serverOutput(2, 'stderr', 'warning: slow query\n'),
    serverOutput(3, 'stdout', `${SESSION_VALUE}; theme=dark\n`),
  ]

  // Act
  const served = maskSavedServerEntries(entries)

  // Assert
  assert.equal(JSON.stringify(served).includes(SESSION_VALUE), false)
  assert.equal(
    outputTexts(served).join('|'),
    '|warning: slow query\n|Cookie: [masked]\n',
  )
})

// protects=output that holds no credential is served exactly as it was saved, with its entry boundaries; fails_when=the masking pass moves text between entries or alters a line that only looks like an assignment; no_claim=the shapes it does mask
test('output without a credential keeps its saved text and entry boundaries', () => {
  // Arrange
  const entries = [
    testOutput(1, 'stdout', 'listening on port=30'),
    testOutput(2, 'stdout', '00\nprefs theme=dark\n'),
  ]

  // Act
  const served = maskSavedOutputEntries(entries)

  // Assert
  assert.deepEqual(outputTexts(served), [
    'listening on port=30',
    '00\nprefs theme=dark\n',
  ])
})

// protects=a test result's output tail, which the Study pane prints under the result, is masked; fails_when=the tail is served as stored, with its Authorization line and Cookie line readable; no_claim=the tail's length bound, which the writer owns
test('a test result output tail is masked and its other fields are kept', () => {
  // Arrange
  const entries: NodeTestHistoryEntry[] = [
    {
      type: 'result',
      sequence: 2,
      elapsedMs: 40,
      exitCode: 1,
      signal: null,
      outputTail: `not ok 1\nAuthorization: Basic ${BASIC_CREDENTIAL}\nCookie: sid=${SESSION_VALUE}; theme=dark\n`,
    },
  ]

  // Act
  const served = maskSavedOutputEntries(entries)

  // Assert
  assert.deepEqual(served, [
    {
      type: 'result',
      sequence: 2,
      elapsedMs: 40,
      exitCode: 1,
      signal: null,
      outputTail: 'not ok 1\nAuthorization: [masked]\nCookie: [masked]\n',
    },
  ])
})

// protects=a request path and a redirect location saved before `code` was masked serve no callback code or token; fails_when=maskSavedServerEntries leaves the path or the location as stored; no_claim=the values of other parameters, which stay readable
test('a saved request path and redirect location lose their code and token values', () => {
  // Arrange
  const entries: NodeServerHistoryEntry[] = [
    {
      type: 'request',
      sequence: 1,
      elapsedMs: 5,
      attempt: 1,
      method: 'GET',
      path: `/login/callback?code=${CALLBACK_CODE}&state=xyz`,
      bodyBytes: 0,
    },
    {
      type: 'response',
      sequence: 2,
      elapsedMs: 9,
      status: 302,
      contentType: null,
      body: '',
      bodyBytes: 0,
      readCut: false,
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every served text.
      location: `/welcome?token=${SESSION_VALUE}&page=2`,
      requestDurationMs: 4,
    },
    {
      type: 'response',
      sequence: 3,
      elapsedMs: 10,
      status: 200,
      contentType: null,
      body: '',
      bodyBytes: 0,
      readCut: false,
      location: null,
      requestDurationMs: 4,
    },
  ]

  // Act
  const served = maskSavedServerEntries(entries)

  // Assert
  assert.equal(JSON.stringify(served).includes(CALLBACK_CODE), false)
  assert.equal(JSON.stringify(served).includes(SESSION_VALUE), false)
  assert.deepEqual(
    served.map((entry) =>
      entry.type === 'request'
        ? entry.path
        : entry.type === 'response'
          ? entry.location
          : undefined,
    ),
    [
      '/login/callback?code=[masked]&state=xyz',
      // eslint-disable-next-line browser-security/no-credentials-in-query-params -- a seeded test secret that must stay out of every served text.
      '/welcome?token=[masked]&page=2',
      null,
    ],
  )
})
