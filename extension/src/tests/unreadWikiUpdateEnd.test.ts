import assert from 'node:assert/strict'
import { test } from 'node:test'

import { unreadWikiUpdateEnd } from '../utils/unreadWikiUpdateEnd'

// Value: protects=a learner whose update ended at a moment the Wiki folder could not be read; fails_when=the end claims that the site was kept or replaced although nothing was read, names no next step, or quotes a long cause whole; why_new=Cycle 0046 row 344 (an end whose read threw left the run as running until the window was reloaded); seam=none
test('an update whose end cannot be read from the disk is recorded as failed in a sentence that says so, claims nothing about the site and names the next step, with a long cause cut at 120 characters', () => {
  // Act
  const unread = unreadWikiUpdateEnd({}, 'EIO: i/o error, read')
  const withLongCause = unreadWikiUpdateEnd({}, 'x'.repeat(150))

  // Assert
  assert.deepEqual(unread.end, {
    state: 'failed',
    reason:
      'Codebook could not read the Wiki folder to see how the update ended (EIO: i/o error, read), so it does not say whether the site was replaced. Check the Wiki’s freshness label, then press Update LLM Wiki again.',
    isCodebookSentence: true,
    site: 'missing',
  })
  assert.equal(
    withLongCause.end.state === 'failed' ? withLongCause.end.reason : '',
    `Codebook could not read the Wiki folder to see how the update ended (${'x'.repeat(120)}…), so it does not say whether the site was replaced. Check the Wiki’s freshness label, then press Update LLM Wiki again.`,
  )
})

// Value: protects=the chat of a VS Code watch that stopped before it, when the end of that run could not be read; fails_when=such a run counts as one that simply failed, so the reservation is dropped and the next press starts a second chat beside the first; why_new=Cycle 0046 row 344; seam=none
test('an update whose end cannot be read still says how the run stopped by what it observed itself: cancelled before timed out before files in the way, and failed when it observed none of them', () => {
  // Act
  const stops = [
    unreadWikiUpdateEnd({ cancelled: true, timedOut: true }, 'EIO'),
    unreadWikiUpdateEnd({ timedOut: true, blockingPaths: ['a.html'] }, 'EIO'),
    unreadWikiUpdateEnd({ blockingPaths: ['a.html'] }, 'EIO'),
    unreadWikiUpdateEnd({ cancelled: false, blockingPaths: [] }, 'EIO'),
    unreadWikiUpdateEnd({}, 'EIO'),
  ].map((unread) => unread.stoppedAs)

  // Assert
  assert.deepEqual(stops, [
    'cancelled',
    'timed-out',
    'conflict',
    'failed',
    'failed',
  ])
})
