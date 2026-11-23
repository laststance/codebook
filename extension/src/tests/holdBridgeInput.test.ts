import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { holdBridgeInput } from '../utils/holdBridgeInput'

/** A stand-in for a bridge's stdin whose chunks the test pushes. */
function standInInput(): Readable {
  return new Readable({ read: () => undefined })
}

/** Reads `stream` from now on, as the bridge's next reader does, and returns the chunks it emits as text, one entry per chunk. */
function readChunks(stream: Readable): string[] {
  const chunks: string[] = []
  stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
  // A stream left paused on purpose does not start again for a new data listener alone.
  stream.resume()
  return chunks
}

// Value: protects=the bridge's next reader (its stdio transport, or the Devin bridge's next attempt) getting every chunk its startup hold read, each whole and in the order it came, ahead of what came after (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=putBack joins the chunks into one, drops one or puts them back in reverse; no_claim=process.stdin's own pause (the bridge child-process tests)
test('a held bridge input gives every chunk it read back whole and in order, ahead of the input that came after', async () => {
  // Arrange
  const input = standInInput()
  const hold = holdBridgeInput(input, () => undefined)
  input.push(Buffer.from('first'))
  input.push(Buffer.from('second'))
  await waitUntil(
    () => input.readableLength === 0,
    'the hold reading both chunks',
    2_000,
    undefined,
    5,
  )
  // Act
  hold.putBack()
  input.push(Buffer.from('third'))
  const chunks = readChunks(input)
  await waitUntil(
    () => chunks.length === 3,
    'the next reader getting the three chunks',
    2_000,
    undefined,
    5,
  )
  // Assert
  assert.deepEqual(chunks, ['first', 'second', 'third'])
})

// Value: protects=a bound on what the bridge keeps from its client before it serves: it stops reading once it holds its limit, keeps the chunk that reached the limit whole, and loses nothing it did not read (Cycle 0146 /ship pass 1, Codex review of the FB design); fails_when=the hold reads on past the limit (memory without bound while the first handshake waits), or splits or drops a chunk at the limit; no_claim=the limit's size (BRIDGE_STARTUP_INPUT_LIMIT_BYTES)
test('a held bridge input stops reading at its limit and loses no chunk', async () => {
  // Arrange
  const input = standInInput()
  const hold = holdBridgeInput(input, () => undefined, 4)
  input.push(Buffer.from('abc'))
  input.push(Buffer.from('de'))
  await waitUntil(
    () => input.isPaused(),
    'the hold stopping at its limit',
    2_000,
    undefined,
    5,
  )
  // Act
  input.push(Buffer.from('fg'))
  const unreadAtLimit = input.readableLength
  hold.putBack()
  const chunks = readChunks(input)
  await waitUntil(
    () => chunks.length === 3,
    'the next reader getting the three chunks',
    2_000,
    undefined,
    5,
  )
  // Assert
  assert.equal(unreadAtLimit, 2)
  assert.deepEqual(chunks, ['abc', 'de', 'fg'])
})

// Value: protects=a stop that began before the hold (an input that already ended) being reported at once, so the bridge starts no first handshake for a client that has gone (Cycle 0146 /ship pass 1, Codex review of the FB design, Q2); fails_when=the hold waits for an end event that was already emitted, so the stop is never seen; no_claim=an end or an error that comes while held (the bridge child-process tests)
test('holding a bridge input that already ended reports its end at once', async () => {
  // Arrange
  const input = standInInput()
  readChunks(input)
  input.push(null)
  await waitUntil(
    () => input.readableEnded,
    'the input ending',
    2_000,
    undefined,
    5,
  )
  let ends = 0
  // Act
  holdBridgeInput(input, () => {
    ends += 1
  })
  // Assert
  assert.equal(ends, 1)
})
