import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeServerRequestClaim,
  describeServerResponseState,
  describeServerStop,
  NODE_SERVER_REPLAY_TEXT,
} from '../utils/describeNodeServerReplay'

// protects=the replay claims a request was sent only when its bytes left; fails_when=a withdrawn attempt reads as sent, or the refusal code is dropped; no_claim=whether the server received the request
test('the request region says Request sent by Codebook only for a sent attempt and names the code of a withdrawn one', () => {
  // Arrange
  const sent = { sent: true }
  const withdrawn = { sent: false, withdrawnCode: 'RUN_BUSY' }
  const unmarked = { sent: false }

  // Act
  const words = [sent, withdrawn, unmarked].map(describeServerRequestClaim)

  // Assert
  assert.deepEqual(words, [
    'Request sent by Codebook',
    'Request not sent: RUN_BUSY',
    'Request not sent: unknown',
  ])
})

// protects=the response region words each state of the selected moment; fails_when=a 4xx or 5xx reads as a success word, an earlier moment shows a later response, or a failure drops its code; no_claim=colors
test('the response region words the moment before the response, a 404, a failed request and a history that ended with no answer', () => {
  // Arrange
  const before = { reached: false }
  const notFound = {
    reached: true,
    response: { status: 404, contentType: 'text/plain' },
  }
  const failed = { reached: true, failureCode: 'REQUEST_TIMEOUT' }
  const stopped = {
    reached: true,
    noResponseReason:
      'No response was recorded: the run was stopped before the server answered.',
  }

  // Act
  const words = [before, notFound, failed, stopped].map(
    describeServerResponseState,
  )

  // Assert
  assert.deepEqual(words, [
    'No response recorded yet at this moment.',
    'Response 404 · text/plain',
    'Request failed: REQUEST_TIMEOUT',
    'No response was recorded: the run was stopped before the server answered.',
  ])
})

// protects=a stop hit more than once reads Stop <n> · hit <k>; fails_when=the hit number is dropped for a repeated stop or added to a single hit; no_claim=the stop's position in the list
test('a stop reads Stop 2 · hit 3 only when its declared stop was hit more than once', () => {
  // Arrange / Act
  const single = describeServerStop(2, 1, false)
  const repeated = describeServerStop(2, 3, true)

  // Assert
  assert.equal(single, 'Stop 2')
  assert.equal(repeated, 'Stop 2 · hit 3')
})

// protects=no server word of the catalog says test; fails_when=a catalog entry reuses the test replay's wording; no_claim=the Study pane's own labels
test('the server catalog never uses the word test', () => {
  // Arrange
  const words = Object.values(NODE_SERVER_REPLAY_TEXT)

  // Act
  const withTest = words.filter((word) => /\btests?\b/i.test(word))

  // Assert
  assert.deepEqual(withTest, [])
})
