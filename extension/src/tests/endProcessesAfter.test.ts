import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

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
  // The killed child is a zombie until this process reaps it, which its exit event tells.
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

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

// Value: protects=the after-check of every test that starts a process from failing on a child that has exited but is not reaped yet (a zombie), which the signal probe finds like a running process; fails_when=a zombie counts as running, so endProcesses reports it as a survivor; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=endProcesses with a real zombie (a child of a parent whose event loop is blocked, so nobody reaps it); no_claim=Windows, where the process table has no zombie
test(
  'a process that exited and is not reaped yet is not reported as a survivor of a test',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange: the parent starts `true` and then blocks without reading its exit, so `true` stays a zombie.
    const parent = spawn(
      process.execPath,
      [
        '-e',
        [
          "const child = require('node:child_process').spawn('true')",
          'console.log(child.pid)',
          'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000)',
        ].join(';'),
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    context.after(() => parent.kill('SIGKILL'))
    const [chunk] = (await once(parent.stdout, 'data')) as [Buffer]
    const zombiePid = Number(String(chunk))
    const stateOf = (): string =>
      execFileSync('ps', ['-o', 'stat=', '-p', String(zombiePid)], {
        encoding: 'utf8',
      }).trim()
    const until = Date.now() + 10_000
    while (!stateOf().startsWith('Z') && Date.now() < until) await delay(20)

    // Act
    const survivors = await endProcesses([zombiePid], { waitMs: 300 })

    // Assert
    assert.equal(stateOf().startsWith('Z'), true)
    assert.equal(isProcessGone(zombiePid), false)
    assert.deepEqual(survivors, [])
  },
)

// Value: protects=a test's clean-up from killing an unrelated process whose id the test once noted (a recycled id, or with `group` the whole group of it); fails_when=endProcesses signals every running id it is given; why_new=Cycle 0064 pt3 review (OCR low); seam=endProcesses with a running process that is neither a descendant of the test process nor an orphan started after the test began (its own parent process); no_claim=an orphan that started after the test began, which is taken for the test's
test(
  'a running process that is not a descendant of the test is not signalled',
  { skip: process.platform === 'win32' },
  async () => {
    // Arrange: the test runner's parent runs and is no descendant of this process.
    const signalled: number[] = []

    // Act
    const survivors = await endProcesses([process.ppid], {
      group: true,
      signalProcess: (pid) => {
        signalled.push(pid)
      },
      waitMs: 100,
    })

    // Assert
    assert.deepEqual({ survivors, signalled }, { survivors: [], signalled: [] })
  },
)
