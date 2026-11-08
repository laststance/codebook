import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeRenderRunMessage } from '../utils/describeRenderRunMessage'

// Value: protects=F11: an API pause tied to the page's request says the handler holds that request; fails_when=the attributed sentence loses the holding statement; no_claim=the wording of the fact's own sentence
test('an attributed API pause says the paused handler holds the page request', () => {
  // Arrange
  const apiRequest = {
    state: 'attributed',
    method: 'POST',
    path: '/api/rpc/switchTo',
    operation: 1,
    basis: 'time-window',
    sentence: 'Paused in the API for POST /api/rpc/switchTo.',
  } as const
  // Act
  const message = describeRenderRunMessage({
    apiRequest,
    isEntryRenderPaused: false,
  })
  // Assert
  assert.equal(
    message,
    "Paused in the API for POST /api/rpc/switchTo. The paused API handler holds the page's request; continue to let it answer, or stop it with codebook_stop.",
  )
})

// Value: protects=F11: an API pause that could not be tied to a request never claims it holds the page's request; fails_when=the unattributed message says the handler holds the page's request; no_claim=the wording of the fact's own sentence
test('an unattributed API pause does not claim to hold the page request', () => {
  // Arrange
  const apiRequest = {
    state: 'unattributed',
    reason: 'none',
    count: 0,
    sentence: 'No page request could be tied to this pause.',
  } as const
  // Act
  const message = describeRenderRunMessage({
    apiRequest,
    isEntryRenderPaused: false,
  })
  // Assert
  assert.equal(
    message,
    'No page request could be tied to this pause. Continue to let the handler run on, or stop it with codebook_stop.',
  )
})
