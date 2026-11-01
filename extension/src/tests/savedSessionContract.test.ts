import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SIGN_IN_REQUIRED_REASONS } from '../constants'
import { BUSY_PROFILE_IN_USE_RECOVERY, ERROR_RECOVERY } from '../errors'
import { OPERATIONS_ERROR_CODES } from '../operationsHelp'
import { signInPathSchema } from '../repositoryConfigSchemas'
import type { SavedSessionUnusableReason } from '../runtimeSupport/savedSessionTypes'

const LEARNER_CODES = [
  'SIGN_IN_REQUIRED',
  'SIGN_IN_IN_PROGRESS',
  'SIGN_IN_PROFILE_IN_USE',
  'SIGN_IN_PROFILE_UNUSABLE',
] as const

// protects=the saved-session codes tell the chat who speaks to the learner and where the help anchor is; fails_when=a learner code loses its audience or anchor, or SIGN_IN_ORIGIN_REFUSED stops being a chat code; no_claim=the wording is helpful
test('the saved-session codes name their audience and help anchor and sit in the help error table', () => {
  // Arrange, Act, Assert
  for (const code of LEARNER_CODES) {
    assert.match(ERROR_RECOVERY[code], /^Audience: learner\. /, code)
    assert.ok(
      ERROR_RECOVERY[code].endsWith(
        `See codebook://help/repository-browser#${code}.`,
      ),
      code,
    )
    assert.ok(OPERATIONS_ERROR_CODES.includes(code), code)
  }
  assert.match(ERROR_RECOVERY.SIGN_IN_ORIGIN_REFUSED, /^Audience: chat\. /)
  assert.ok(OPERATIONS_ERROR_CODES.includes('SIGN_IN_ORIGIN_REFUSED'))
})

// protects=every SIGN_IN_REQUIRED reason and every unusable reason is explained in the recovery the chat reads; fails_when=a reason is added to the constants or the type without its sentence; no_claim=the recovery of a run (lane tests)
test('the SIGN_IN_REQUIRED and SIGN_IN_PROFILE_UNUSABLE recoveries name every reason', () => {
  // Arrange
  const unusableReasons = [
    'unreadable-record',
    'newer-record',
    'not-a-session-folder',
    'chrome-version',
  ] as const satisfies readonly SavedSessionUnusableReason[]
  // Act, Assert
  for (const reason of SIGN_IN_REQUIRED_REASONS)
    assert.ok(ERROR_RECOVERY.SIGN_IN_REQUIRED.includes(reason), reason)
  for (const reason of unusableReasons)
    assert.ok(ERROR_RECOVERY.SIGN_IN_PROFILE_UNUSABLE.includes(reason), reason)
})

// protects=the BUSY profile-in-use recovery tells the chat not to retry; fails_when=the sentence is dropped; no_claim=the run answers it (lane tests)
test('the BUSY profile-in-use recovery says not to retry the request', () => {
  // Arrange, Act, Assert
  assert.ok(BUSY_PROFILE_IN_USE_RECOVERY.includes('Do not retry this request'))
})

// protects=a sign-in path is a same-origin absolute path without a query; fails_when=a relative path, a query or a protocol-relative path is accepted, or /login is refused; no_claim=matching a landing (lane B)
test('signInPathSchema accepts an absolute path and refuses a query, a relative and a protocol-relative path', () => {
  // Arrange
  const candidates = ['/login', '/en/login?x=1', 'login', '//evil.test/login']
  // Act
  const accepted = candidates.map(
    (candidate) => signInPathSchema.safeParse(candidate).success,
  )
  // Assert
  assert.deepEqual(accepted, [true, false, false, false])
})
