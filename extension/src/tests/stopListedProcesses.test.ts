import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PollBudget } from '../runtimeSupport/utils/pollBudget'
import {
  stopListedProcesses,
  type ProcessStopper,
} from '../runtimeSupport/utils/stopListedProcesses'

/** A stopper whose process ends `pollsUntilGone` null-signal checks after it was signalled; records every signal. */
function stopperEndingAfter(
  platform: NodeJS.Platform,
  pollsUntilGone: number,
): { stopper: ProcessStopper; signalled: [number, NodeJS.Signals | 0][] } {
  const signalled: [number, NodeJS.Signals | 0][] = []
  let isEnding = platform === 'win32'
  let checksLeft = pollsUntilGone
  return {
    signalled,
    stopper: {
      platform,
      signal: (pid, signal): void => {
        signalled.push([pid, signal])
        if (signal === 'SIGTERM' || signal === 'SIGKILL') isEnding = true
        if (signal === 0 && isEnding) {
          if (checksLeft <= 0) throw new Error('ESRCH')
          checksLeft -= 1
        }
      },
      // taskkill returns at once; the process is still exiting.
      taskkill: async () => undefined,
      sleep: async () => undefined,
    },
  }
}

// Value: protects=CR-B3 (Windows taskkill returns before the process is gone); fails_when=a process that needs a few polls to exit after taskkill is reported as left; no_claim=real taskkill
test('on Windows a process that is still exiting right after taskkill counts as stopped once it is gone within the grace time', async () => {
  // Arrange
  const { stopper } = stopperEndingAfter('win32', 3)
  // Act
  const stopped = await stopListedProcesses([4242], stopper)
  // Assert
  assert.equal(stopped, true)
})

// Value: protects=CR-B3; fails_when=a process that never exits is reported as stopped on Windows; no_claim=real taskkill
test('on Windows a process that never exits after taskkill is reported as left', async () => {
  // Arrange
  const { stopper } = stopperEndingAfter('win32', Number.POSITIVE_INFINITY)
  // Act
  const stopped = await stopListedProcesses([4242], stopper)
  // Assert
  assert.equal(stopped, false)
})

// Value: protects=B8; fails_when=a group leader is signalled through its pid only, or a plain process through a group id; no_claim=real process groups
test('a group leader is signalled through its group and other processes through their pid', async () => {
  // Arrange
  const { stopper, signalled } = stopperEndingAfter('linux', 0)
  // Act
  await stopListedProcesses([4242, 4243], stopper, { groupLeaders: [4242] })
  // Assert
  assert.deepEqual(
    signalled.filter(([, signal]) => signal === 'SIGTERM'),
    [
      [-4242, 'SIGTERM'],
      [4243, 'SIGTERM'],
    ],
  )
})

// Value: protects=B8 (fallback); fails_when=a leader without a group of its own is left unsignalled; no_claim=real groups
test('a group leader whose group does not exist is signalled through its pid', async () => {
  // Arrange
  const signalled: number[] = []
  const stopper: ProcessStopper = {
    platform: 'linux',
    signal: (pid, signal): void => {
      if (signal === 0) throw new Error('ESRCH')
      signalled.push(pid)
      // No group with this id: only the plain pid can be signalled.
      if (pid < 0) throw new Error('ESRCH')
    },
    taskkill: async () => undefined,
    sleep: async () => undefined,
  }
  // Act
  await stopListedProcesses([4242], stopper, { groupLeaders: [4242] })
  // Assert
  assert.deepEqual(signalled, [-4242, 4242])
})

// Value: protects=B6 (the bound counts request time); fails_when=time spent inside a measured request does not reduce the budget; no_claim=the real clock
test('a poll budget counts the time of measured requests and the nominal pauses', async () => {
  // Arrange
  let clock = 0
  const budget = new PollBudget(1_000, () => clock)
  // Act
  await budget.measure(async () => {
    clock += 700
  })
  await budget.pause(async () => undefined, 100)
  // Assert
  assert.equal(budget.remainingMs(), 200)
  assert.equal(budget.isSpent(), false)
  await budget.measure(async () => {
    clock += 250
  })
  assert.equal(budget.remainingMs(), 0)
  assert.equal(budget.isSpent(), true)
})
