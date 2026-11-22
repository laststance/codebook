import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPathReadGate } from '../utils/shareReceiptRead'

import { defer } from './utils/defer'
import { within } from './utils/within'

const RECEIPT_KEY = 'receipt:/storage/devin-mcp/receipt.json'
const OTHER_RECEIPT_KEY = 'receipt:/storage/devin-skill/receipt.json'

// Value: protects=a caller that asks while a read is in flight gets a read that began after its call, so a decision taken after a removal never accepts the older read's `installed` (Cycle 0146 task 1d, Codex finding 7); fails_when=the caller joins the read already in flight and answers with its older result, or two reads of the file run at once; no_claim=real file reads (the reads are deferred stand-ins)
test('a caller that asks while a read is in flight gets the answer of a fresh read started after it', async () => {
  // Arrange
  const reads = createPathReadGate()
  const firstRead = defer<string>()
  let starts = 0,
    inFlight = 0,
    mostInFlight = 0
  const start = (): Promise<string> => {
    starts += 1
    inFlight += 1
    mostInFlight = Math.max(mostInFlight, inFlight)
    const answer = starts === 1 ? firstRead.promise : Promise.resolve('removed')
    return answer.finally(() => {
      inFlight -= 1
    })
  }
  const earlier = reads.read(RECEIPT_KEY, start)
  const later = reads.read(RECEIPT_KEY, start)
  // Act
  firstRead.resolve('installed')
  const answers = await within(Promise.all([earlier, later]), 2_000)
  // Assert
  assert.deepEqual(answers, ['installed', 'removed'])
  assert.equal(starts, 2)
  assert.equal(mostInFlight, 1)
})

// Value: protects=a read of a stalled storage that never returns holds one thread of the file pool however many callers ask (Cycle 0146 task 1d); fails_when=each caller starts a read of its own, so four callers fill libuv's four pool threads; no_claim=what the callers answer meanwhile (each bounds its own wait)
test('a read that never returns starts once however many callers ask for it', async (context) => {
  // Arrange
  const reads = createPathReadGate()
  const held = defer<string>()
  context.after(() => held.resolve('released'))
  let starts = 0
  const start = (): Promise<string> => {
    starts += 1
    return held.promise
  }
  // Act
  const answers = [1, 2, 3, 4].map(() => reads.read(RECEIPT_KEY, start))
  const firstAnswer = await within(answers[0]!, 100)
  // Assert
  assert.equal(firstAnswer, 'still waiting')
  assert.equal(starts, 1)
})

// Value: protects=callers behind a hung read end in their own deadlines and a read of another file is not held by it (Cycle 0146 task 1d); fails_when=a hung read under one key blocks reads under other keys, or the joined callers never get a fresh read once the hung one settles; no_claim=the length of any caller's deadline
test('a hung read holds only the callers of its own file, and they read afresh once it ends', async () => {
  // Arrange
  const reads = createPathReadGate()
  const held = defer<string>()
  let starts = 0
  const start = (): Promise<string> => {
    starts += 1
    return starts === 1 ? held.promise : Promise.resolve('fresh')
  }
  void reads.read(RECEIPT_KEY, start)
  const joined = reads.read(RECEIPT_KEY, start)
  // Act
  const joinedWhileHung = await within(joined, 100)
  const otherFile = await within(
    reads.read(OTHER_RECEIPT_KEY, async () => 'other file'),
    2_000,
  )
  held.resolve('late')
  const joinedAfterRelease = await within(joined, 2_000)
  // Assert
  assert.equal(joinedWhileHung, 'still waiting')
  assert.equal(otherFile, 'other file')
  assert.equal(joinedAfterRelease, 'fresh')
  assert.equal(starts, 2)
})

// Value: protects=a read that fails gives its callers its own error and the callers behind it still read afresh; fails_when=a failed read poisons the key, so every later caller gets the old error; no_claim=which errors a real read gives
test('a read that fails answers its caller with the error and lets the callers behind it read afresh', async () => {
  // Arrange
  const reads = createPathReadGate()
  const failing = defer<string>()
  let starts = 0
  const start = (): Promise<string> => {
    starts += 1
    return starts === 1 ? failing.promise : Promise.resolve('fresh')
  }
  const failed = reads.read(RECEIPT_KEY, start)
  const behind = reads.read(RECEIPT_KEY, start)
  // Act
  failing.reject(new Error('EIO'))
  const failure = await failed.then(
    () => 'answered',
    (error: unknown) => (error instanceof Error ? error.message : 'other'),
  )
  const behindAnswer = await within(behind, 2_000)
  // Assert
  assert.equal(failure, 'EIO')
  assert.equal(behindAnswer, 'fresh')
  assert.equal(starts, 2)
})

// Value: protects=a read asked after the last one settled starts afresh, so a changed receipt is seen at the next refresh; fails_when=the gate keeps a settled answer and hands it to a later caller; no_claim=reads that overlap
test('a read asked after the previous one settled starts afresh instead of reusing its answer', async () => {
  // Arrange
  const reads = createPathReadGate()
  let starts = 0
  const start = async (): Promise<string> => {
    starts += 1
    return starts === 1 ? 'installed' : 'removed'
  }
  const first = await reads.read(RECEIPT_KEY, start)
  // Act
  const second = await reads.read(RECEIPT_KEY, start)
  // Assert
  assert.equal(first, 'installed')
  assert.equal(second, 'removed')
  assert.equal(starts, 2)
})
