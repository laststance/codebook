import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isStopCausedByCodebook } from '../runtimeSupport/utils/isStopCausedByCodebook'

// Value: protects=the chat's keyboard at a stop the run's input or continuation caused; fails_when=a stop inside the run's open causal window is judged the learner's, so the reader hands the keyboard from the chat to the paused file; why_new=Cycle 0046 decision R7 (finding 589)
test('a stop inside an open causal window is the run’s', () => {
  // Arrange
  const causes = {
    windowOpen: true,
    isAdapterRefresh: false,
    isRunResumedPageStop: false,
  }

  // Act
  const caused = isStopCausedByCodebook(causes)

  // Assert
  assert.equal(caused, true)
})

// Value: protects=the keyboard of a learner whose palette command made js-debug refresh the stack; fails_when=the refresh's stopped event, read while a window is open, is judged the run's, so the paused file never gets the keyboard; why_new=Cycle 0046 finding 589, C54 round 9f (continued then stopped with no request)
test('an adapter refresh is not the run’s even inside an open causal window', () => {
  // Arrange
  const causes = {
    windowOpen: true,
    isAdapterRefresh: true,
    isRunResumedPageStop: false,
  }

  // Act
  const caused = isStopCausedByCodebook(causes)

  // Assert
  assert.equal(caused, false)
})

// Value: protects=the learner's keyboard at a stop the run did not start; fails_when=a stop read while no window is open (a learner's step or continue closed it) is judged the run's; why_new=Cycle 0046 finding 589, C54 step1 (F11 from the captured source)
test('a stop outside any causal window is not the run’s', () => {
  // Arrange
  const causes = {
    windowOpen: false,
    isAdapterRefresh: false,
    isRunResumedPageStop: false,
  }

  // Act
  const caused = isStopCausedByCodebook(causes)

  // Assert
  assert.equal(caused, false)
})

// Value: protects=the chat's keyboard at a page pause in a server stop's stub that the run resumes itself; fails_when=that pause is judged the learner's because its window opens only with the run's resume, so the reader hands the keyboard to the page stub's file; why_new=Cycle 0046 decision R7 (the run's own resume of a page pause is a Codebook stop)
test('a page pause the run resumes itself is the run’s whatever the window says', () => {
  // Arrange
  const causes = {
    windowOpen: false,
    isAdapterRefresh: false,
    isRunResumedPageStop: true,
  }

  // Act
  const caused = isStopCausedByCodebook(causes)

  // Assert
  assert.equal(caused, true)
})
