import assert from 'node:assert/strict'
import { test } from 'node:test'

import { paneKeyboardTimeoutMessage } from '../utils/paneKeyboardTimeoutMessage'

// Value: protects=the sentence a learner reads when a Codebook pane did not confirm the keyboard: it names the pane, the time Codebook waited, that nothing else was changed and the next step; fails_when=the sentence loses the pane's name or the next step, or states another time than the reader waited; why_new=Cycle 0046 row 338 (the pane's error line showed "Error: Error: Timed out waiting for owned presentation inner focus"); seam=none
test('the sentence about a pane that did not confirm the keyboard names the pane, the seconds waited and what the learner does', () => {
  // Arrange / Act
  const sentences = [
    paneKeyboardTimeoutMessage('Explanation', 5_000),
    paneKeyboardTimeoutMessage('Application', 2_500),
  ]

  // Assert
  assert.deepEqual(sentences, [
    'Codebook asked the Explanation pane to take the keyboard, and the pane did not confirm it within 5 seconds. The action was stopped there and nothing else was changed. Click into the Explanation pane and repeat the action.',
    'Codebook asked the Application pane to take the keyboard, and the pane did not confirm it within 2.5 seconds. The action was stopped there and nothing else was changed. Click into the Application pane and repeat the action.',
  ])
})
