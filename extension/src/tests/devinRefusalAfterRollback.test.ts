import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE } from '../devinWindowSentences'
import { devinRefusalAfterRollback } from '../utils/devinRefusalAfterRollback'
import { createPathReadGate } from '../utils/shareReceiptRead'

import { within } from './utils/within'

const RECEIPT_PATH = '/storage/devin-mcp/receipt.json'
const REPAIR_SENTENCE = `Make ${RECEIPT_PATH} readable only by you (mode 600)`

// Value: protects=a storage that stops answering after the rollback does not hold the refusal, the setup lock and a removal queued behind it; fails_when=the look at the receipt has no deadline, so the setup never rejects; no_claim=the length of the real bound
test('a refused setup keeps its own sentence when the look at the rolled-back receipt never answers', async () => {
  // Arrange
  const neverAnswers = (): Promise<never> => new Promise(() => undefined)
  // Act
  const sentence = await within(
    devinRefusalAfterRollback(
      REPAIR_SENTENCE,
      RECEIPT_PATH,
      50,
      neverAnswers,
      createPathReadGate(),
    ),
    2_000,
  )
  // Assert
  assert.equal(sentence, REPAIR_SENTENCE)
})

// Value: protects=a receipt the rollback deleted asks only for a setup retry; fails_when=the bound turns an observed absence into the original repair sentence; no_claim=other errors
test('a refused setup asks for a retry when the rolled-back receipt is seen missing within the bound', async () => {
  // Arrange
  const reportsMissing = (): Promise<never> =>
    Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  // Act
  const sentence = await devinRefusalAfterRollback(
    REPAIR_SENTENCE,
    RECEIPT_PATH,
    2_000,
    reportsMissing,
    createPathReadGate(),
  )
  // Assert
  assert.equal(sentence, DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE)
})

// Value: protects=a receipt that is still there keeps the repair instruction; fails_when=the sentence is replaced although the file exists; no_claim=the file's mode
test('a refused setup keeps its repair sentence when the receipt still exists', async () => {
  // Arrange
  const stillThere = (): Promise<object> => Promise.resolve({})
  // Act
  const sentence = await devinRefusalAfterRollback(
    REPAIR_SENTENCE,
    RECEIPT_PATH,
    2_000,
    stillThere,
    createPathReadGate(),
  )
  // Assert
  assert.equal(sentence, REPAIR_SENTENCE)
})

// Value: protects=failed setups on a storage that stops answering hold one look at the rolled-back receipt between them, so repeated failed setups cannot fill the editor's file pool (Cycle 0146 task 1d, the look gate of v2 section 4.1); fails_when=each refusal starts a look of its own (two refusals, two looks), four of which fill libuv's four pool threads; no_claim=the length of the real bound and a real lstat (the look seam stands in for it)
test('two refused setups whose look at the rolled-back receipt never answers start that look once', async () => {
  // Arrange
  const reads = createPathReadGate()
  let looks = 0
  const neverAnswers = (): Promise<never> => {
    looks += 1
    return new Promise(() => undefined)
  }
  // Act
  const first = await within(
    devinRefusalAfterRollback(
      REPAIR_SENTENCE,
      RECEIPT_PATH,
      50,
      neverAnswers,
      reads,
    ),
    2_000,
  )
  const second = await within(
    devinRefusalAfterRollback(
      REPAIR_SENTENCE,
      RECEIPT_PATH,
      50,
      neverAnswers,
      reads,
    ),
    2_000,
  )
  // Assert
  assert.equal(first, REPAIR_SENTENCE)
  assert.equal(second, REPAIR_SENTENCE)
  assert.equal(looks, 1)
})
