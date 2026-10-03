import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withUnannouncedPauses } from '../utils/withUnannouncedPauses'

// Value: protects=every deadline text an agent already knows staying byte for byte the same when no participant is paused without a stop; fails_when=a period or a sentence is added with no pause held; why_new=the utility is new (Cycle 0042 ER6); seam=none
test('a deadline text is unchanged when no participant is paused without a debugger stop', () => {
  // Arrange
  const reason = 'Repository pause hold deadline exceeded'
  // Act
  const text = withUnannouncedPauses(reason, [])
  // Assert
  assert.equal(text, 'Repository pause hold deadline exceeded')
})

// Value: protects=an agent learning why nothing progressed: which participant is still paused and where; fails_when=the sentence is missing, joined without a period, doubles a period the reason already ends with, or names the participants in another order than given; why_new=the utility is new (Cycle 0042 ER6); seam=none
test('a deadline text gains one sentence per participant that is paused without a debugger stop, joined by exactly one period', () => {
  // Arrange
  const server = { participant: 'server', place: 'auth.ts:18' },
    browser = { participant: 'browser', place: 'eval-ca9ab6a4.cdp 1:220' }
  // Act
  const texts = [
    withUnannouncedPauses('Repository input reached no verified pause', [
      server,
    ]),
    withUnannouncedPauses('Repository input reached no verified pause.', [
      server,
    ]),
    withUnannouncedPauses('Repository input reached no verified pause', [
      server,
      browser,
    ]),
  ]
  // Assert
  assert.deepEqual(texts, [
    'Repository input reached no verified pause. The server is paused at auth.ts:18 without a debugger stop.',
    'Repository input reached no verified pause. The server is paused at auth.ts:18 without a debugger stop.',
    'Repository input reached no verified pause. The server is paused at auth.ts:18 without a debugger stop. The browser is paused at eval-ca9ab6a4.cdp 1:220 without a debugger stop.',
  ])
})
