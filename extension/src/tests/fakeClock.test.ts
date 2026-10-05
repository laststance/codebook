import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import type * as FakeClockModule from './utils/fakeClock'
import {
  advanceClock,
  advanceClockUntil,
  enableFakeClock,
  resetFakeClock,
} from './utils/fakeClock'
import { loadModule } from './utils/loadModule'

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

// Value: protects=the faked time a test stands at when it reads the product's state before a bound that begins after file work (a read, then a deadline); fails_when=advanceClock takes one 50 ms step per real turn whatever is pending, so the product sets its timer after the clock has already moved and the test reads its state far earlier than it means to; why_new=Cycle 0045 H1-F1 (studyWorkspaceEntryObstacles read its state about 1,050 faked ms before the bound it named); seam=none
test('advancing the fake clock spends no fake time while a real file read is pending', async (context) => {
  // Arrange: work under the clock reads files for 30 real ms and then sets a 200 ms timer, as product code sets a deadline after its storage work.
  enableFakeClock(context)
  const fakedAtMs = performance.now()
  const readingStartedMs = realNow()
  const timer: { setAfterMs?: number; firedAfterMs?: number } = {}
  const working = (async () => {
    while (realNow() - readingStartedMs < 30) await readFile(__filename)
    timer.setAfterMs = Math.round(performance.now() - fakedAtMs)
    setTimeout(() => {
      timer.firedAfterMs = Math.round(performance.now() - fakedAtMs)
    }, 200)
  })()

  // Act
  await advanceClock(context, 200)
  await working
  resetFakeClock(context)

  // Assert: the timer was set before any fake time passed, and fired when the advance reached the time it was due.
  assert.deepEqual(timer, { setAfterMs: 0, firedAfterMs: 200 })
})

// Value: protects=the faked time a test stands at when the product sets a bound after a child process (the three git reads of a repository source, then the focus wait); fails_when=the clock moves while a child process is still running, so the product sets its timer after 50 to 100 faked ms have already passed and a test that reads its state 50 ms before the bound is no control of that bound; why_new=Cycle 0045 H1-F1, second half (studyWorkspaceEntryObstacles stood 100 to 150 faked ms before the 10 s bound, and its control with a 100 ms shorter wait was red in 3 of 8 runs); seam=none
test('advancing the fake clock spends no fake time while a child process the work started is still running', async (context) => {
  // Arrange: work under the clock runs a child process for about 60 real ms and then sets a 200 ms timer, as the product sets its focus wait after its git reads.
  enableFakeClock(context)
  const fakedAtMs = performance.now()
  const timer: { setAfterMs?: number; firedAfterMs?: number } = {}
  const working = new Promise<void>((resolve, reject) => {
    execFile(process.execPath, ['-e', 'setTimeout(() => {}, 60)'], (error) => {
      if (error) return reject(error)
      timer.setAfterMs = Math.round(performance.now() - fakedAtMs)
      setTimeout(() => {
        timer.firedAfterMs = Math.round(performance.now() - fakedAtMs)
      }, 200)
      resolve()
    })
  })

  // Act
  await advanceClock(context, 200)
  await working
  resetFakeClock(context)

  // Assert: the timer was set before any fake time passed, and fired when the advance reached the time it was due.
  assert.deepEqual(timer, { setAfterMs: 0, firedAfterMs: 200 })
})

// Value: protects=a fake-clock test that hangs on real work failing with a sentence that says which work; fails_when=the turn limit's error names neither the pending resource nor what it is, so a child process that outlives the test reads like a slow disk; why_new=review of Cycle 0045, tests-1 #8 (the limit said only "Real file or child-process work"); seam=the helper loaded with a turn that costs no real time and with the process's active resources answered by the test
test('a wait that gives up on pending real work names the resources that were still pending and what each is', async (context) => {
  // Arrange: a child process and a file handle's close never finish; a socket and a timer are active too and do not count.
  const fakeClock = await loadModule<typeof FakeClockModule>(
    join(__dirname, 'utils', 'fakeClock.js'),
    {},
    {
      setTimeout: (callback: () => void) => setImmediate(callback),
      process: {
        getActiveResourcesInfo: () => [
          'Timeout',
          'ProcessWrap',
          'TCPSocketWrap',
          'CloseReq',
          'ProcessWrap',
        ],
      },
    },
  )

  // Act
  const waiting = fakeClock.advanceClockUntil(context, () => false, 50)

  // Assert
  await assert.rejects(waiting, {
    message:
      'Real file or child-process work was still pending after 10000 event-loop turns (ProcessWrap: a child process that has not exited, CloseReq: a file handle being closed); the faked clock was not moved.',
  })
})
