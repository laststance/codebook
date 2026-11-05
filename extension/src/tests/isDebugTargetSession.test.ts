import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDebugTargetSession } from '../utils/isDebugTargetSession'

// Value: protects=a parentless js-debug attach root is never a binding candidate, so no binding loop asks the session that never answers `requestCDPProxy`; fails_when=the predicate accepts a session with no parent; why_new=no test names the rule that the page selection and the three binding sites share; seam=none; no_claim=real js-debug session trees (plain objects stand in)
test('a debug session without a parent is not a binding candidate', () => {
  // Arrange
  const attachRoot = { parentSession: undefined }

  // Act
  const isCandidate = isDebugTargetSession(attachRoot)

  // Assert
  assert.equal(isCandidate, false)
})

// Value: protects=the child session that holds the launched process stays a binding candidate; fails_when=the predicate refuses a session with a parent, so no run ever binds; why_new=as above; seam=none; no_claim=real js-debug session trees (plain objects stand in)
test('a debug session with a parent is a binding candidate', () => {
  // Arrange
  const attachRoot = { parentSession: undefined }
  const targetChild = { parentSession: attachRoot }
  const nestedWorker = { parentSession: targetChild }

  // Act
  const childIsCandidate = isDebugTargetSession(targetChild)
  const nestedIsCandidate = isDebugTargetSession(nestedWorker)

  // Assert
  assert.equal(childIsCandidate, true)
  assert.equal(nestedIsCandidate, true)
})
