import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ERROR_RECOVERY, StudyError } from '../errors'
import { createLearnerSecretAsker } from '../utils/createLearnerSecretAsker'
import { describeOperationFailureDetails } from '../utils/describeOperationFailureDetails'
import { formatRefusalFailure } from '../utils/formatRefusalFailure'
import { refusalFailureOf } from '../utils/refusalFailureOf'

const CHAT_CODES = [
  'OPTION_NOT_AVAILABLE',
  'INPUT_NOT_ACCEPTED',
  'CONTROL_KIND_NOT_SUPPORTED',
  'SECRET_INPUT_FROM_CHAT',
  'SECRET_INPUT_VISIBLE',
  'NAVIGATION_BEFORE_LAST_OPERATION',
  'NAVIGATION_NOT_SETTLED',
  'OPERATION_AFTER_NOT_MET',
  'RUN_FAILED_UNEXPECTEDLY',
] as const

// protects=DES-7: every operation code names its audience and a non-empty recovery, the learner for OPERATIONS_NOT_CONFIRMED and the chat for the configuration and failure codes; fails_when=a code has no audience, no recovery, or the wrong audience; no_claim=the wording is helpful (reviewed in the DX phase)
test('every operation code names its audience and a recovery', () => {
  // Arrange, Act
  const learner = ERROR_RECOVERY.OPERATIONS_NOT_CONFIRMED
  // Assert
  assert.match(learner, /^Audience: learner\. .{40,}/)
  for (const code of CHAT_CODES)
    assert.match(ERROR_RECOVERY[code], /^Audience: chat\. .{40,}/, code)
})

// protects=DX-5: OPERATION_AFTER_NOT_MET carries the exact recovery sentences of the contract; fails_when=any of the four sentences changes; no_claim=none beyond protects
test('the OPERATION_AFTER_NOT_MET recovery is the contract text', () => {
  // Arrange, Act, Assert
  assert.equal(
    ERROR_RECOVERY.OPERATION_AFTER_NOT_MET,
    "Audience: chat. Operation <n> was sent, but its result could not be confirmed. Changes the app made are not undone. Read the run's operation record and save the partial replay if useful. Do not run the flow again unless the learner asks. See codebook://help/repository-browser#OPERATION_AFTER_NOT_MET.",
  )
})

// protects=a run's coded failure text restores the operation code, its message and the static recovery; fails_when=a code is not restored, so an agent reads RUNTIME_FAILED; no_claim=none beyond protects
test('a run failure led by an operation code is restored as that code', () => {
  for (const code of CHAT_CODES) {
    // Arrange
    const text = formatRefusalFailure(
      code,
      'Operation 2 (Amount) was not sent.',
    )
    // Act
    const restored = refusalFailureOf(text)
    // Assert
    assert.deepEqual(restored, {
      code,
      message: 'Operation 2 (Amount) was not sent.',
    })
  }
})

// protects=DX-5: the error fields an agent decides a retry by: run, operation, configuration path, sent, side effects, a retry rule matching what was sent and the log id; fails_when=a field is missing or a sent operation is told to be retried; no_claim=the Output line (run tests)
test('the failure fields give the retry rule that matches what was sent', () => {
  // Arrange
  const notSent = {
    code: 'OPTION_NOT_AVAILABLE',
    operationIndex: 1,
    path: 'operations[0].value',
    sent: 'not-sent',
    sideEffects: 'none',
    logId: 'run-1#1',
  } as const
  // Act
  const fixable = describeOperationFailureDetails(notSent, 'codebook://run/1')
  const sent = describeOperationFailureDetails(
    { ...notSent, sent: 'sent', sideEffects: 'unknown' },
    'codebook://run/1',
  )
  // Assert
  assert.deepEqual(fixable, {
    runUri: 'codebook://run/1',
    operationIndex: 1,
    path: 'operations[0].value',
    sent: 'not-sent',
    sideEffects: 'none',
    retry: 'Fix the configuration, then start one new run.',
    logId: 'run-1#1',
  })
  assert.equal(sent.retry, 'Never retry automatically; ask the learner.')
  assert.equal(sent.sideEffects, 'unknown')
})

// protects=the describe() of a StudyError shows its details beside the code and leaves an error without details as before; fails_when=details are dropped or appear on every error; no_claim=none beyond protects
test('a StudyError shows its details only when it has some', () => {
  // Arrange
  const plain = new StudyError('BUSY', 'Busy.')
  const detailed = new StudyError(
    'BUSY',
    'Busy.',
    'Busy.',
    undefined,
    undefined,
    {
      reason: 'action-mismatch',
    },
  )
  // Act, Assert
  assert.equal('details' in plain.describe(), false)
  assert.deepEqual(detailed.describe().details, { reason: 'action-mismatch' })
})

// protects=DX-3: the learner is asked in a masked input box titled with the repository and the operation, kept open when focus moves, and the box closes when the wait ends; fails_when=the box is not masked, is titled otherwise, stays open after an abort, or is shown for an already aborted wait; no_claim=the editor's real input box (a stand-in is injected)
test('the secret question is a masked input box titled repository and operation that closes when the wait aborts', async () => {
  // Arrange
  const shown: { password: true; title: string; ignoreFocusOut: true }[] = []
  let cancelled = 0
  let disposed = 0
  let answer: (value: string | undefined) => void = () => {}
  const ask = createLearnerSecretAsker(
    (options) => {
      shown.push(options)
      return new Promise<string | undefined>((resolve) => {
        answer = resolve
      })
    },
    () => ({
      token: 'token',
      cancel: (): void => {
        cancelled++
        answer(undefined)
      },
      dispose: (): void => {
        disposed++
      },
    }),
  )
  const question = {
    runId: 'r1',
    repository: 'nextjs-dashboard',
    title: 'Password',
  }
  // Act
  const typed = ask(question, new AbortController().signal)
  answer('typed-by-learner')
  const controller = new AbortController()
  const abandoned = ask(question, controller.signal)
  controller.abort()
  const alreadyAborted = await ask(question, AbortSignal.abort())
  // Assert
  assert.equal(await typed, 'typed-by-learner')
  assert.equal(await abandoned, undefined)
  assert.equal(alreadyAborted, undefined)
  assert.equal(shown.length, 2)
  assert.deepEqual(
    {
      maskedBox: shown[0]?.password,
      title: shown[0]?.title,
      ignoreFocusOut: shown[0]?.ignoreFocusOut,
    },
    {
      maskedBox: true,
      title: 'nextjs-dashboard · Password',
      ignoreFocusOut: true,
    },
  )
  assert.equal(cancelled, 1)
  assert.equal(disposed, 2)
})
