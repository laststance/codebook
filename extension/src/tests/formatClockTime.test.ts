import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatClockTime } from '../utils/formatClockTime'

test('a time the editor writes names its time zone, so a remote host in another zone does not contradict the page', () => {
  // Arrange
  const moment = '2026-10-03T12:10:00.000Z'

  // Act
  const onAHostInTokyo = formatClockTime(moment, { timeZone: 'Asia/Tokyo' })
  const onAHostInUtc = formatClockTime(moment, { timeZone: 'UTC' })

  // Assert: the hour follows the host's zone and the zone is written beside it (a 12-hour locale writes 09:10 PM).
  assert.match(onAHostInTokyo, /^(?:21:10|09:10\s?PM) GMT\+9$/)
  assert.match(onAHostInUtc, /^(?:12:10|12:10\s?PM) UTC$/)
})

test("the time of an update's ending is written without a zone, as the page writes it", () => {
  // Act
  const ending = formatClockTime(Date.UTC(2026, 9, 3, 12, 10))

  // Assert
  assert.match(ending, /^\d{1,2}:10(?:\s?[AP]M)?$/)
})
