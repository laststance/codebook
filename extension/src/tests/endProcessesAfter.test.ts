import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'

import { isProcessGone } from '../utils/isProcessGone'

import { endProcesses } from './utils/endProcessesAfter'

/** Starts a Node process that waits until it is killed, and answers it once it runs. */
async function startWaitingProcess() {
  const child = spawn(
    process.execPath,
    ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  await once(child.stdout, 'data')
  return child
}

test('a process that a test leaves running is reported as a survivor, and ending it leaves none', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const pid = child.pid!

  // Act
  const survivorsOfSignalThatKillsNothing = await endProcesses([pid], {
    signalProcess: () => undefined,
    waitMs: 200,
  })
  const survivorsAfterRealEnd = await endProcesses([pid])

  // Assert
  assert.deepEqual(survivorsOfSignalThatKillsNothing, [pid])
  assert.deepEqual(survivorsAfterRealEnd, [])
  assert.equal(isProcessGone(pid), true)
})

test('a process that is gone already is not signalled, so a recycled id is left alone', async () => {
  // Arrange
  const signalled: number[] = []

  // Act
  const survivors = await endProcesses([2 ** 22 + 7], {
    signalProcess: (pid) => {
      signalled.push(pid)
    },
  })

  // Assert
  assert.deepEqual({ survivors, signalled }, { survivors: [], signalled: [] })
})
