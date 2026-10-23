import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isTransientFileError } from '../utils/isTransientFileError'

/** A failed file call as Node throws it, with its system error code. */
function fileError(code: string): Error {
  return Object.assign(new Error(`${code}: open 'events.jsonl'`), { code })
}

// Value: protects=which failed reads of a test history's summary are read again at the next refresh instead of being remembered until a file changes (F63): a descriptor shortage, a busy or held file and a disk error pass, a missing file, a parse error and a thrown non-error stay (F245); fails_when=a missing or corrupt history is read again at every 250 ms refresh, or a transient failure is remembered as unavailable; why_new=only EMFILE was reached, through the summary test, so the other codes and the false cases were asserted nowhere; seam=none; no_claim=the seal's retry list, which drops EIO (constants.ts)
test('a read that failed for too many files, a busy or held file or a disk error is transient, and a missing file, a parse error or a non-error is not', () => {
  // Arrange
  const transient = ['EMFILE', 'ENFILE', 'EBUSY', 'EAGAIN', 'EPERM', 'EIO']
  const lasting: unknown[] = [
    fileError('ENOENT'),
    fileError('EISDIR'),
    new SyntaxError('Unexpected token'),
    'EMFILE',
    undefined,
  ]

  // Act
  const transientAnswers = transient.map((code) =>
    isTransientFileError(fileError(code)),
  )
  const lastingAnswers = lasting.map((failure) => isTransientFileError(failure))

  // Assert
  assert.deepEqual(transientAnswers, [true, true, true, true, true, true])
  assert.deepEqual(lastingAnswers, [false, false, false, false, false])
})
