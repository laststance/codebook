import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  stopListedProcesses,
  type ProcessStopper,
} from '../runtimeSupport/utils/stopListedProcesses'
import { stopperGuardedByStart } from '../runtimeSupport/utils/stopperGuardedByStart'

/** The start the saved session's marker recorded for its Chrome. */
const RECORDED_START = 'ps:Mon Nov  2 10:00:00 2026'

/**
 * A stand-in Chrome of a saved session that keeps running until SIGKILL or `taskkill` ends it, with a stopper that notes every real signal and pause, and a start reader that answers the given starts in turn (the last one again once they run out) and counts its reads.
 * @param platform - The system the stop acts for.
 * @param starts - What each read of the start answers.
 */
function savedSessionChrome(
  platform: NodeJS.Platform,
  starts: readonly (string | undefined)[],
) {
  const sent: string[] = []
  const counts = { reads: 0, pauses: 0 }
  let alive = true
  const stopper: ProcessStopper = {
    platform,
    signal: (pid, signal): void => {
      if (signal === 0) {
        if (!alive) throw new Error('kill ESRCH')
        return
      }
      sent.push(`${signal} ${pid}`)
      if (signal === 'SIGKILL') alive = false
    },
    taskkill: async (pid): Promise<void> => {
      sent.push(`taskkill ${pid}`)
      alive = false
    },
    sleep: async (): Promise<void> => {
      counts.pauses += 1
    },
  }
  const readStart = async (): Promise<string | undefined> => {
    counts.reads += 1
    return starts[Math.min(counts.reads, starts.length) - 1]
  }
  const guarded = stopperGuardedByStart(
    stopper,
    { pid: 4242, processStart: RECORDED_START },
    readStart,
  )
  return { guarded, sent, counts }
}

// Value: protects=OCR 41 (the saved-session start refuses a stop in seconds, not minutes, under the folder's lock); fails_when=a Windows stop whose start read failed (a cold PowerShell over its 3 s bound) still sends taskkill, or keeps reading the start at every exit poll of the 5 s grace; no_claim=the real PowerShell timing (readProcessStart tests) and the store's refusal wording
test('a saved-session stop on Windows whose Chrome start cannot be read sends no taskkill and ends its exit wait after that one read', async () => {
  // Arrange
  const chrome = savedSessionChrome('win32', [undefined, RECORDED_START])

  // Act
  await stopListedProcesses([4242], chrome.guarded)

  // Assert
  assert.deepEqual(chrome.sent, [])
  assert.deepEqual(chrome.counts, { reads: 1, pauses: 0 })
})

// Value: protects=the start guard (never signal a stranger) and OCR 41; fails_when=a Chrome whose pid shows another start after the first pause gets SIGKILL, a later matching read revives the proof, or the stop polls both graces with a read at every tick; no_claim=the fresh listing that decides the folder's use afterwards (signInProfile tests)
test('a saved-session stop whose Chrome start differs after the first pause sends no SIGKILL and makes no further read or pause', async () => {
  // Arrange
  const chrome = savedSessionChrome('darwin', [
    'ps:Mon Nov  2 10:05:00 2026',
    RECORDED_START,
  ])

  // Act
  await stopListedProcesses([4242], chrome.guarded)

  // Assert
  assert.deepEqual(chrome.sent, ['SIGTERM 4242'])
  assert.deepEqual(chrome.counts, { reads: 1, pauses: 1 })
})

// Value: protects=ER18 for the saved session (an orphan Chrome that ignores SIGTERM still ends); fails_when=the guard withholds SIGKILL from a Chrome whose start still matches after the grace; no_claim=real signals (removeOrphanBrowser and signInProfile tests)
test('a saved-session Chrome that ignores SIGTERM and keeps its recorded start gets SIGKILL after the grace', async () => {
  // Arrange
  const chrome = savedSessionChrome('linux', [RECORDED_START])

  // Act
  const stopped = await stopListedProcesses([4242], chrome.guarded)

  // Assert
  assert.equal(stopped, true)
  assert.deepEqual(chrome.sent, ['SIGTERM 4242', 'SIGKILL 4242'])
})
