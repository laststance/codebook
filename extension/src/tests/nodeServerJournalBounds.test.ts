import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_EVENTS, MAX_RETAINED_EVENT_BYTES } from '../constants'
import { createNodeServerJournal } from '../utils/createNodeServerJournal'
import type { JournaledEvent } from '../utils/createNodeServerJournal'

/** One output chunk of the largest size the journal keeps whole. */
const bigChunk = {
  sequence: 1,
  elapsedMs: 0,
  channel: 'stdout',
  text: 'a'.repeat(4_096),
}

// protects=the journal's total byte bound ends it with one marker long before the event count would; fails_when=the retained-bytes bound is not enforced so the journal grows to the count bound or past the bytes; no_claim=the per-event byte bound
test('the journal ends with one marker once the retained bytes reach the byte bound', () => {
  // Arrange
  const events: JournaledEvent[] = []
  const record = createNodeServerJournal(events, { sanitize: (text) => text })
  // Act
  for (let index = 0; index < 2_000; index += 1)
    record('node-server.output', bigChunk)
  // Assert
  const markers = events.filter(
    (event) => event.type === 'node-server.events-truncated',
  )
  const keptBytes = events
    .filter((event) => event.type === 'node-server.output')
    .reduce(
      (total, event) => total + Buffer.byteLength(JSON.stringify(event.detail)),
      0,
    )
  assert.equal(markers.length, 1)
  assert.equal(events.at(-1)?.type, 'node-server.events-truncated')
  assert.ok(events.length < MAX_EVENTS / 2)
  assert.equal(keptBytes, 4_190_377)
  assert.ok(keptBytes <= MAX_RETAINED_EVENT_BYTES)
})

// protects=a run that outputs after the journal ended does no per-chunk work, while a request outcome still reaches the Output channel; fails_when=a chunk after the truncation is whitelisted, sanitized or reported again, or a non-output event stops reaching its listener; no_claim=the Output line wording
test('output chunks after the journal ended cost no sanitizing or listener call, other events still reach the listener', () => {
  // Arrange
  const events: JournaledEvent[] = []
  let sanitized = 0
  const heard: string[] = []
  const record = createNodeServerJournal(events, {
    sanitize: (text) => {
      sanitized += 1
      return text
    },
    onEvent: (type) => heard.push(type),
  })
  for (let index = 0; index < 2_000; index += 1)
    record('node-server.output', bigChunk)
  const sanitizedAtEnd = sanitized
  const heardAtEnd = heard.length
  const eventsAtEnd = events.length
  // Act
  for (let index = 0; index < 500; index += 1)
    record('node-server.output', bigChunk)
  const sanitizedAfterChunks = sanitized
  const heardAfterChunks = heard.length
  record('node-server.failure', { code: 'REQUEST_FAILED', cause: 'reset' })
  // Assert
  assert.equal(sanitizedAfterChunks, sanitizedAtEnd)
  assert.equal(heardAfterChunks, heardAtEnd)
  assert.deepEqual(heard.slice(heardAtEnd), ['node-server.failure'])
  assert.equal(events.length, eventsAtEnd)
})
