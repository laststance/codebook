import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isFromEarlierBoot } from '../utils/isFromEarlierBoot'

// Value: protects=an owner is called one of an earlier boot only on certain ground; fails_when=a missing boot, or a boot id compared with a boot time, counts as another boot, so the lock of a running writer of an earlier build or of another kind of host is taken over; why_new=the boot identity is new (engineering review ER-20); seam=none
test('an owner without a recorded boot, or with a boot of another kind than this process’s, is not from an earlier boot', () => {
  // Act
  const withoutRecordedBoot = isFromEarlierBoot(undefined, { id: 'boot-2' }),
    withoutOwnBoot = isFromEarlierBoot({ id: 'boot-1' }, undefined),
    timeAgainstId = isFromEarlierBoot(
      { startedAtMs: 1_790_000_000_000 },
      { id: 'boot-2' },
    ),
    idAgainstTime = isFromEarlierBoot(
      { id: 'boot-1' },
      { startedAtMs: 1_790_000_000_000 },
    )
  // Assert
  assert.equal(withoutRecordedBoot, false)
  assert.equal(withoutOwnBoot, false)
  assert.equal(timeAgainstId, false)
  assert.equal(idAgainstTime, false)
})

// Value: protects=a lock is never called stale because two clocks disagree; fails_when=a recorded boot time that lies after this boot's counts as another boot, although a restart can only put this boot later; why_new=the boot identity is new (engineering review ER-20); seam=none
test('a recorded boot time later than this boot’s, by whatever amount, is not an earlier boot', () => {
  // Act: the owner recorded a boot time one hour after the one this process computes.
  const isEarlier = isFromEarlierBoot(
    { startedAtMs: 1_790_003_600_000 },
    { startedAtMs: 1_790_000_000_000 },
  )
  // Assert
  assert.equal(isEarlier, false)
})

// Value: protects=the boot time rule holds exactly at its bound; fails_when=the tolerance is compared with "at least" instead of "more than", or is another amount than 60 s; why_new=the boot identity is new; seam=none
test('a recorded boot time exactly the tolerance before this boot’s is the same boot, and one millisecond more is an earlier boot', () => {
  // Act
  const atTheTolerance = isFromEarlierBoot(
      { startedAtMs: 1_790_000_000_000 },
      { startedAtMs: 1_790_000_060_000 },
    ),
    pastTheTolerance = isFromEarlierBoot(
      { startedAtMs: 1_790_000_000_000 },
      { startedAtMs: 1_790_000_060_001 },
    )
  // Assert
  assert.equal(atTheTolerance, false)
  assert.equal(pastTheTolerance, true)
})

// Value: protects=a record of this boot on macOS, whose boot session id stands beside a boot time the clock moves; fails_when=a boot time moved by a correction of the clock makes a record of the same boot session one of an earlier boot, so a live owner's lock is taken over (S4); why_new=Cycle 0046 third review S4: macOS names its boot by its session, with the boot time beside it; seam=none
test('two equal boot ids are one boot whatever boot times stand beside them, and two that differ are two', () => {
  // Act
  const judged = {
    sameSessionTimesTenMinutesApart: isFromEarlierBoot(
      { id: 'session-1', startedAtMs: 1_790_000_000_000 },
      { id: 'session-1', startedAtMs: 1_790_000_600_000 },
    ),
    otherSessionSameTime: isFromEarlierBoot(
      { id: 'session-1', startedAtMs: 1_790_000_000_000 },
      { id: 'session-2', startedAtMs: 1_790_000_000_000 },
    ),
    timeAloneOfAnEarlierBoot: isFromEarlierBoot(
      { startedAtMs: 1_790_000_000_000 },
      { id: 'session-2', startedAtMs: 1_790_000_600_000 },
    ),
  }
  // Assert
  assert.deepEqual(judged, {
    sameSessionTimesTenMinutesApart: false,
    otherSessionSameTime: true,
    timeAloneOfAnEarlierBoot: true,
  })
})
