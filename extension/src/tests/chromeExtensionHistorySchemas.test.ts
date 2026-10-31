import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  extensionHistorySealSchema,
  parseExtensionHistoryEntry,
  parseExtensionHistoryHeader,
} from '../chromeExtensionHistorySchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import {
  acceptExtensionHistoryEntry,
  newExtensionJournalProgress,
} from '../utils/extensionHistoryJournalRules'

import {
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
} from './utils/chromeExtensionHistoryFixture'

const NEWER_TEXT =
  'EXTENSION_HISTORY_FORMAT_NEWER: Recorded by a newer Codebook; update Codebook to open it.'

/** A header as the store writes it. */
function storedHeader() {
  return {
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    formatVersion: 1,
  }
}

/** A `pause-open` entry for the page stop. */
function pauseOpen(overrides: Record<string, unknown> = {}) {
  return {
    type: 'pause-open',
    sequence: 1,
    elapsedMs: 10,
    pauseId: 'run:1:page:1',
    generation: 1,
    context: 'page',
    stopIndex: 1,
    targetUrl: 'chrome-extension://abc/popup.html',
    workerGeneration: 0,
    ...overrides,
  }
}

// protects=a chrome-extension header carries its format version, the question, the extension name and version, the surface kind, the revision and the Chrome; fails_when=a field of the header is dropped or renamed; no_claim=that the store writes it (the repository tests do)
test('a chrome-extension header parses with its format version, extension, surface kind, revision and Chrome', () => {
  // Arrange
  const header = storedHeader()

  // Act
  const parsed = parseExtensionHistoryHeader(header)

  // Assert
  assert.equal(parsed.formatVersion, 1)
  assert.equal(parsed.profile, 'chrome-extension')
  assert.equal(parsed.extension.name, 'Bookmark Notes')
  assert.equal(parsed.extension.version, '1.2.0')
  assert.equal(parsed.surface.kind, 'popup')
  assert.deepEqual(parsed.repositoryRevision, {
    revision: 'abc1234',
    dirty: false,
  })
  assert.equal(parsed.chrome.version, 'Google Chrome 156.0.8078.74')
})

// protects=a header written by a later format version is refused instead of being read as this one; fails_when=formatVersion 2 parses; no_claim=how the store lists a refused header
test('a header with a format version this build does not know is refused', () => {
  // Arrange
  const header = { ...storedHeader(), formatVersion: 2 }

  // Act, Assert
  assert.throws(() => parseExtensionHistoryHeader(header))
})

// protects=a declared stop in a context a later Codebook adds (a content script) makes the history unreadable with the format-newer code; fails_when=the unknown context parses or fails with a schema dump; no_claim=content-script recording, which is a later part
test('a header that declares a stop in an unknown context is refused with the format-newer sentence', () => {
  // Arrange
  const header = storedHeader()
  header.declaredStops[0]!.context = 'content-script'

  // Act, Assert
  assert.throws(() => parseExtensionHistoryHeader(header), {
    message: NEWER_TEXT,
  })
})

// protects=both contexts of this build are journaled by their names; fails_when=page or service-worker is refused; no_claim=other entry types
test('a pause-open entry accepts the page and the service-worker context', () => {
  // Arrange, Act
  const page = parseExtensionHistoryEntry(pauseOpen())
  const worker = parseExtensionHistoryEntry(
    pauseOpen({ context: 'service-worker', workerGeneration: 2 }),
  )

  // Assert
  assert.equal(page.type === 'pause-open' && page.context, 'page')
  assert.equal(worker.type === 'pause-open' && worker.context, 'service-worker')
})

// protects=an entry with an unknown future context makes the whole history unreadable instead of replaying it wrongly; fails_when=the unknown context is accepted; no_claim=the listing wording (the repository test reads it)
test('a pause-open entry with an unknown context is refused with the format-newer sentence', () => {
  // Arrange
  const entry = pauseOpen({ context: 'content-script' })

  // Act, Assert
  assert.throws(() => parseExtensionHistoryEntry(entry), {
    message: NEWER_TEXT,
  })
})

// protects=a capture without its debugger snapshot is refused, so a replay never shows a stop with no values; fails_when=the capture parses; no_claim=snapshot contents
test('a capture entry without a debugger snapshot is refused', () => {
  // Arrange
  const entry = {
    type: 'capture',
    sequence: 2,
    elapsedMs: 20,
    pauseId: 'run:1:page:1',
    path: 'popup.js',
    line: 2,
    sourceHash: sha256('x'),
    sourceBytes: 1,
    facts: {},
  }

  // Act, Assert
  assert.throws(() => parseExtensionHistoryEntry(entry))
})

// protects=a frame is a stream frame or a pin of one pause and nothing else; fails_when=another kind parses or a pin loses its pause id field; no_claim=that pins are produced by this build
test('a frame entry accepts the stream and the pin kind and refuses another', () => {
  // Arrange
  const frame = (kind: string, extra: Record<string, unknown> = {}) => ({
    type: 'frame',
    sequence: 3,
    elapsedMs: 40,
    kind,
    hash: sha256('png'),
    byteLength: 30,
    width: 720,
    height: 640,
    capturedAtMs: 30,
    ...extra,
  })

  // Act
  const stream = parseExtensionHistoryEntry(frame('stream'))
  const pin = parseExtensionHistoryEntry(
    frame('pin', { pauseId: 'run:1:page:1' }),
  )

  // Assert
  assert.equal(stream.type === 'frame' && stream.kind, 'stream')
  assert.equal(pin.type === 'frame' && pin.pauseId, 'run:1:page:1')
  assert.throws(() => parseExtensionHistoryEntry(frame('burst')))
})

// protects=a seal is complete exactly when it names no reason; fails_when=a complete seal with a reason parses; no_claim=the reasons' wording
test('a seal that is complete yet names a reason is refused', () => {
  // Arrange
  const seal = {
    version: 1,
    studyId: extensionHistoryHeader(EXTENSION_WORKSPACE_KEY).studyId,
    entryCount: 1,
    journalBytes: 10,
    journalHash: sha256('journal'),
    status: 'complete',
    endedAt: '2026-11-01T00:00:00.000Z',
    reasons: [
      {
        code: 'EXTENSION_HISTORY_RESULT_MISSING',
        params: {},
        text: 'The result of the run was not recorded.',
      },
    ],
    capture: 'complete',
  }

  // Act, Assert
  assert.throws(() => extensionHistorySealSchema.parse(seal))
})

// protects=the journal order rules every reader shares: a capture needs its opened pause, a result is one, time and frames never go back, a pause closes once; fails_when=any of these journals is accepted; no_claim=interleavings of overlapping pauses (the matrix part)
test('the journal rules refuse a capture of an unopened pause, a second result and a time that moves backward', () => {
  // Arrange
  const header = extensionHistoryHeader(EXTENSION_WORKSPACE_KEY)
  const progress = newExtensionJournalProgress()
  acceptExtensionHistoryEntry(
    progress,
    parseExtensionHistoryEntry(pauseOpen()),
    header,
  )
  const capture = parseExtensionHistoryEntry({
    type: 'capture',
    sequence: 2,
    elapsedMs: 20,
    pauseId: 'run:9:page:1',
    path: 'popup.js',
    line: 2,
    sourceHash: sha256('x'),
    sourceBytes: 1,
    debuggerSnapshot: {
      version: 1,
      frames: [],
      variables: [],
      limitations: [],
    },
    facts: {},
  })
  const backward = parseExtensionHistoryEntry({
    type: 'pause-close',
    sequence: 2,
    elapsedMs: 5,
    pauseId: 'run:1:page:1',
    reason: 'continue',
  })
  const result = (sequence: number) =>
    parseExtensionHistoryEntry({
      type: 'result',
      sequence,
      elapsedMs: 30,
      outcome: 'changed',
    })

  // Act, Assert
  assert.throws(
    () => acceptExtensionHistoryEntry(progress, capture, header),
    /never opened/,
  )
  assert.throws(
    () => acceptExtensionHistoryEntry(progress, backward, header),
    /moved backward/,
  )
  acceptExtensionHistoryEntry(progress, result(2), header)
  assert.throws(
    () => acceptExtensionHistoryEntry(progress, result(3), header),
    /two results/,
  )
})
