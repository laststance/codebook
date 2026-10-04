import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'

/** The real timer, kept from before a test fakes `setTimeout`, so a test can let real time pass. */
const realSetTimeout = setTimeout

/** The real clock, kept from before a test fakes `performance.now()`, so a test can measure real time. */
const realNow = performance.now.bind(performance)

// Value: protects=every deadline a fake-clock test measures staying under the test's control, as a product wait reads its deadline from performance.now(); fails_when=the faked performance.now() adds real time again, so a slow machine reaches a product deadline the test never advanced to; why_new=Cycle 0045 D-M1 and ST-13 (the faked clock was the real clock plus the advanced time); seam=none
test('the faked clock does not move while real time passes', async (context) => {
  // Arrange
  enableFakeClock(context)
  const firstReadMs = performance.now()

  // Act: 30 real ms pass on the timer kept from before the clock was faked.
  await new Promise<void>((resolve) => realSetTimeout(resolve, 30))
  const movedMs = performance.now() - firstReadMs
  resetFakeClock(context)

  // Assert
  assert.equal(movedMs, 0)
})

// Value: protects=the fake time a test leaves for the product's own timers when storage is slow; fails_when=advanceClockUntil moves the clock after a fixed number of real turns although a file request is still pending, so slow file work uses up fake time; why_new=Cycle 0045 D-M1 (50 fake ms passed per five real turns, whatever was pending); seam=none
test('a wait spends no fake time while a real file read is pending', async (context) => {
  // Arrange: real file reads follow one another for 30 real ms, so one is pending at every event-loop turn.
  enableFakeClock(context)
  const fakedAtMs = performance.now()
  const readingStartedMs = realNow()
  let filesRead = false
  const reading = (async () => {
    while (realNow() - readingStartedMs < 30) await readFile(__filename)
    filesRead = true
  })()

  // Act
  const waitedMs = await advanceClockUntil(context, () => filesRead, 1_000)
  const movedMs = performance.now() - fakedAtMs
  resetFakeClock(context)
  await reading

  // Assert
  assert.equal(waitedMs, 0)
  assert.equal(movedMs, 0)
})
