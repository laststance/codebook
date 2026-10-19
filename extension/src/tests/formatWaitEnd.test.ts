import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatClockTime } from '../utils/formatClockTime'
import { formatWaitEnd } from '../utils/formatWaitEnd'

// Value: protects=the learner who presses Update again at the time a refusal names (the end of the wait for an earlier chat, the end of the refusal beside a marker file that stays unreadable); fails_when=an end within a minute is named as that minute, so a press at the named time is refused again for up to 59 seconds, or an end on a whole minute is named as the minute after it; why_new=Cycle 0047 rows 85 and 90 (ADV-8, SM-4): the rounding of two sentences became one utility; seam=none; no_claim=the sentences that name it (findUnacknowledgedWikiLeftover.test.ts, describeOtherWikiWindow.test.ts)
test('the end of a wait is named as the first whole minute at or after it: an end at 12:23:30 as 12:24, an end at 12:23:00 as 12:23', () => {
  // Act
  const endAtHalfAMinute = formatWaitEnd(Date.UTC(2026, 9, 3, 12, 23, 30))
  const endOnAWholeMinute = formatWaitEnd(Date.UTC(2026, 9, 3, 12, 23, 0))

  // Assert: the times as the host writes 12:24 and 12:23 UTC, with the zone.
  assert.equal(
    endAtHalfAMinute,
    formatClockTime(Date.UTC(2026, 9, 3, 12, 24, 0), {}),
  )
  assert.equal(
    endOnAWholeMinute,
    formatClockTime(Date.UTC(2026, 9, 3, 12, 23, 0), {}),
  )
})
