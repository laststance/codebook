import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CodebookStopLedger } from '../runtimeSupport/codebookStopLedger'

// Value: protects=the chat's keyboard at the stop the run's continuation caused; fails_when=the run's verdict for its own stop is not kept until the editor shows that stop, so the reader takes it for the learner's; why_new=Cycle 0046 decision R7 (the verdict stays with the stop after the window is used up)
test('a stop the run records as caused stays Codebook’s until the session stops again', () => {
  // Arrange
  const ledger = new CodebookStopLedger()
  ledger.openWindow(['live-next-browser'])

  // Act
  ledger.recordStop('live-next-browser', true)

  // Assert
  assert.equal(ledger.isCodebookCausedStop('live-next-browser'), true)
})

// Value: protects=the chat's keyboard at a stop that arrived during the run's continuation; fails_when=recording the queued stop's verdict uses up the window, so the run's second reading of that stop, once the continuation completes, records it as the learner's; why_new=Cycle 0046 decision R7 (the window closes at the next accepted stop, not at the first reading of a queued one)
test('a stop read twice inside its causal window stays Codebook’s', () => {
  // Arrange
  const ledger = new CodebookStopLedger()
  ledger.openWindow(['live-next-browser'])
  ledger.recordStop(
    'live-next-browser',
    ledger.isWindowOpen('live-next-browser'),
  )

  // Act
  ledger.recordStop(
    'live-next-browser',
    ledger.isWindowOpen('live-next-browser'),
  )

  // Assert
  assert.equal(ledger.isCodebookCausedStop('live-next-browser'), true)
})

// Value: protects=the learner's stop after a step, continue or pause of their own; fails_when=a learner's request leaves the run's window open, so the learner's stop is judged the run's; why_new=Cycle 0046 decision R7 (the window closes at the gate invalidation of a resume the run did not make)
test('closing a causal window leaves the session’s next stop to the learner', () => {
  // Arrange
  const ledger = new CodebookStopLedger()
  ledger.openWindow(['live-next-browser', 'live-next-server'])

  // Act
  ledger.closeWindow(['live-next-browser'])

  // Assert
  assert.deepEqual(
    [
      ledger.isWindowOpen('live-next-browser'),
      ledger.isWindowOpen('live-next-server'),
    ],
    [false, true],
  )
})

// Value: protects=the keyboard of a learner whose palette command made the adapter refresh a pause the run caused; fails_when=the refresh's verdict does not replace the earlier caused one, so the refreshed stop keeps the chat's rule; why_new=Cycle 0046 finding 589, C54 round 9f
test('a later stop the run records as not caused replaces the earlier verdict', () => {
  // Arrange
  const ledger = new CodebookStopLedger()
  ledger.recordStop('live-next-browser', true)

  // Act
  ledger.recordStop('live-next-browser', false)

  // Assert
  assert.equal(ledger.isCodebookCausedStop('live-next-browser'), false)
})

// Value: protects=the keyboard at a stop of a debug session the learner started without Codebook; fails_when=a session the ledger never heard of is judged Codebook's, so the paused file never gets the keyboard; why_new=Cycle 0046 decision R7 (every stop of a session that is not a Codebook run is the learner's)
test('a session no Codebook run wrote is not Codebook’s', () => {
  // Arrange
  const ledger = new CodebookStopLedger()

  // Act
  const caused = ledger.isCodebookCausedStop('learner-own-session')

  // Assert
  assert.equal(caused, false)
})

// Value: protects=the keyboard at the stops of an owned Node test run; fails_when=an owned session's stop is judged the learner's and handed to the paused test file; why_new=Cycle 0046 decision R7 (a stop of an owned Node test run is Codebook's)
test('every stop of an owned Node test session is Codebook’s', () => {
  // Arrange
  const ledger = new CodebookStopLedger()

  // Act
  ledger.ownSession('owned-node-test')

  // Assert
  assert.equal(ledger.isCodebookCausedStop('owned-node-test'), true)
})

// Value: protects=a debug session id that ends and is later reused; fails_when=an ended session's window, verdict or ownership decides a later session's stop; why_new=Cycle 0046 decision R7 (cleanup closes the window)
test('forgetting a session drops its window, verdict and ownership', () => {
  // Arrange
  const ledger = new CodebookStopLedger()
  ledger.openWindow(['live-next-browser'])
  ledger.recordStop('live-next-server', true)
  ledger.ownSession('owned-node-test')

  // Act
  ledger.forget('live-next-browser')
  ledger.forget('live-next-server')
  ledger.forget('owned-node-test')

  // Assert
  assert.deepEqual(
    [
      ledger.isWindowOpen('live-next-browser'),
      ledger.isCodebookCausedStop('live-next-server'),
      ledger.isCodebookCausedStop('owned-node-test'),
    ],
    [false, false, false],
  )
})

// Value: protects=reader tests that share the module's one ledger; fails_when=an earlier test's verdict decides a later test's stop; why_new=Cycle 0046 decision R7 (the harness resets the shared ledger)
test('a reset ledger holds no window, verdict or ownership', () => {
  // Arrange
  const ledger = new CodebookStopLedger()
  ledger.openWindow(['live-next-browser'])
  ledger.recordStop('live-next-server', true)
  ledger.ownSession('owned-node-test')

  // Act
  ledger.reset()

  // Assert
  assert.deepEqual(
    [
      ledger.isWindowOpen('live-next-browser'),
      ledger.isCodebookCausedStop('live-next-server'),
      ledger.isCodebookCausedStop('owned-node-test'),
    ],
    [false, false, false],
  )
})
