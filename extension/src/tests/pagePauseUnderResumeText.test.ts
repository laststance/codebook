import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pagePauseUnderResumeText } from '../utils/pagePauseUnderResumeText'

// Cycle 0046 (row 268): the sentences a failure adds for the page pause Codebook itself is resuming; red if the place, the declared stop, the missing answer or the next step were left out, or the text told the agent to declare another line.
test('the text of a page pause at a server stop’s breakpoint whose resume has no answer names the place, the declared stop and the missing answer, and says to keep the declaration', () => {
  // Arrange
  const pause = {
    declared: 'app/lib/actions.ts:27',
    place:
      'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116',
  }
  // Act
  const text = pagePauseUnderResumeText(pause, 'unanswered')
  // Assert
  assert.equal(
    text,
    "The page paused at webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116, at the breakpoint of declared server stop app/lib/actions.ts:27, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and got no answer, so the page stayed paused. Keep the declaration and start a new run.",
  )
})

// Cycle 0046 (row 268): the refused resume quotes what the debugger answered, and a pause the run has not read itself is said as the debugger's report, without a place; red if the refusal were left out or a place were invented.
test('the text of a page pause whose resume the debugger refused quotes the refusal, and says the pause as the debugger’s report when the page’s own pause was not read', () => {
  // Arrange
  const pause = { declared: 'app/lib/actions.ts:27', place: undefined }
  // Act
  const text = pagePauseUnderResumeText(pause, {
    failure: 'Thread is not paused',
  })
  // Assert
  assert.equal(
    text,
    'The debugger reported that the page paused at the breakpoint of declared server stop app/lib/actions.ts:27, which it also sets in the page\'s copy of that module. Codebook asked the debugger to resume the page, and the request failed: "Thread is not paused". Keep the declaration and start a new run.',
  )
})

// Cycle 0046 (row 268): a request the debugger answered is never said to have had no answer; red if the text of a pause whose resume was answered, while the page reported no resume, said "got no answer".
test('the text of a page pause whose resume the debugger answered while the page reported no resume says both, and not that the request had no answer', () => {
  // Arrange
  const pause = {
    declared: 'app/lib/actions.ts:27',
    place:
      'webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116',
  }
  // Act
  const text = pagePauseUnderResumeText(pause, 'answered')
  // Assert
  assert.equal(
    text,
    "The page paused at webpack-internal:///(app-pages-browser)/./app/lib/actions.ts 11:116, at the breakpoint of declared server stop app/lib/actions.ts:27, which the debugger also sets in the page's copy of that module. Codebook asked the debugger to resume the page and the debugger answered, but the page reported no resume. Keep the declaration and start a new run.",
  )
})
