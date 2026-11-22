import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE } from '../devinWindowSentences'
import { devinRefusalAfterRollback } from '../utils/devinRefusalAfterRollback'

import { within } from './utils/within'

const RECEIPT_PATH = '/storage/devin-mcp/receipt.json'
const REPAIR_SENTENCE = `Make ${RECEIPT_PATH} readable only by you (mode 600)`

// protects=a storage that stops answering after the rollback does not hold the refusal, the setup lock and a removal queued behind it; fails_when=the look at the receipt has no deadline, so the setup never rejects; no_claim=the length of the real bound
test('a refused setup keeps its own sentence when the look at the rolled-back receipt never answers', async () => {
  // Arrange
  const neverAnswers = (): Promise<never> => new Promise(() => undefined)
  // Act
  const sentence = await within(
    devinRefusalAfterRollback(REPAIR_SENTENCE, RECEIPT_PATH, 50, neverAnswers),
    2_000,
  )
  // Assert
  assert.equal(sentence, REPAIR_SENTENCE)
})

// protects=a receipt the rollback deleted asks only for a setup retry; fails_when=the bound turns an observed absence into the original repair sentence; no_claim=other errors
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
  )
  // Assert
  assert.equal(sentence, DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE)
})

// protects=a receipt that is still there keeps the repair instruction; fails_when=the sentence is replaced although the file exists; no_claim=the file's mode
test('a refused setup keeps its repair sentence when the receipt still exists', async () => {
  // Arrange
  const stillThere = (): Promise<object> => Promise.resolve({})
  // Act
  const sentence = await devinRefusalAfterRollback(
    REPAIR_SENTENCE,
    RECEIPT_PATH,
    2_000,
    stillThere,
  )
  // Assert
  assert.equal(sentence, REPAIR_SENTENCE)
})
