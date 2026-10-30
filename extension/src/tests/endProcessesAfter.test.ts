import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { isProcessGone } from '../utils/isProcessGone'

import {
  endProcesses,
  endProcessesAfter,
  readProcess,
  readProcessIdFiles,
} from './utils/endProcessesAfter'

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
  async (context) => {
    // Arrange: a real child whose reported parent is an unrelated process, started long before the test.
    const child = await startWaitingProcess()
    context.after(() => child.kill('SIGKILL'))
    const signalled: number[] = []

    // Act
    const survivors = await endProcesses([child.pid!], {
      group: true,
      readProcessInfo: () => ({
        state: 'S',
        parentPid: 424242,
        ageSeconds: 86_400,
      }),
      signalProcess: (pid) => {
        signalled.push(pid)
      },
      waitMs: 100,
    })

    // Assert
    assert.deepEqual({ survivors, signalled }, { survivors: [], signalled: [] })
  },
)

// Value: protects=a test's clean-up from killing an id it cannot confirm as its own where `ps` is unavailable (a recycled id could be an unrelated process); fails_when=an unreadable ownership counts as owned, so the id is SIGKILLed; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=endProcesses with an injected process reader that answers 'unreadable' for a running child; no_claim=the Windows listing, which the held handle stands in for
test('a running process whose ownership cannot be read is not signalled and is reported as a survivor', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const pid = child.pid!
  const signalled: number[] = []

  // Act
  const survivors = await endProcesses([pid], {
    readProcessInfo: () => 'unreadable',
    signalProcess: (target) => {
      signalled.push(target)
    },
    waitMs: 100,
  })

  // Assert
  assert.deepEqual(
    { survivors, signalled },
    { survivors: [pid], signalled: [] },
  )
})

test('a child the test holds a handle of is ended although the process reader cannot say whose it is', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const pid = child.pid!

  // Act
  const survivors = await endProcesses([pid], {
    held: [pid],
    readProcessInfo: () => 'unreadable',
    waitMs: 2_000,
  })
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

  // Assert
  assert.deepEqual(survivors, [])
  assert.equal(isProcessGone(pid), true)
})

// Value: protects=the test runner from being killed by its own clean-up; fails_when=the orphan rule owns this process or its parent (a runner that is process 1 of a container, or started just before the test) and a group end kills the runner's group; why_new=Cycle 0064 pt3 review (CodeRabbit minor); seam=endProcesses with a reader that shows every id as a young orphan; no_claim=ancestors above the parent
test('this process and its parent are never signalled, even when they look like a young orphan', async () => {
  // Arrange
  const signalled: number[] = []

  // Act
  const survivors = await endProcesses([process.pid, process.ppid], {
    group: true,
    readProcessInfo: () => ({ state: 'S', parentPid: 1, ageSeconds: 0 }),
    signalProcess: (pid) => {
      signalled.push(pid)
    },
    waitMs: 100,
  })

  // Assert
  assert.deepEqual({ survivors, signalled }, { survivors: [], signalled: [] })
})

test('a pid file that cannot be read fails the clean-up, and the held child is ended', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const pid = child.pid!
  const hooks: Array<() => Promise<void>> = []
  const fakeContext = {
    after: (hook: () => Promise<void>) => hooks.push(hook),
  } as unknown as TestContext
  endProcessesAfter(
    fakeContext,
    () =>
      Promise.reject(
        Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        }),
      ),
    { held: () => [pid] },
  )

  // Act
  const error = await hooks[0]!().then(
    () => undefined,
    (failure: unknown) => failure,
  )
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

  // Assert
  assert.match(String(error), /EACCES/)
  assert.equal(isProcessGone(pid), true)
})

// Value: protects=the clean-up from taking an unreadable pid file for "no pids"; fails_when=every read failure answers no ids; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=readProcessIdFiles with a real file made unreadable; no_claim=Windows, where chmod does not deny a read
test(
  'a pid file the test cannot read fails the read instead of answering no ids, and a missing file answers none',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'pid-files-'))
    context.after(() => rm(folder, { recursive: true, force: true }))
    const unreadable = join(folder, 'unreadable.pid')
    await writeFile(unreadable, '4242\n')
    await chmod(unreadable, 0o000)

    // Act
    const missing = await readProcessIdFiles([join(folder, 'missing.pid')])
    const failure = await readProcessIdFiles([unreadable]).then(
      () => undefined,
      (error: unknown) => error,
    )

    // Assert
    assert.deepEqual(missing, [])
    assert.match(String(failure), /EACCES/)
  },
)

test('a ps failure other than exit status 1 is unreadable, so a live process is not taken for gone', () => {
  // Arrange
  const failWith = (properties: object) => () => {
    throw Object.assign(new Error('ps failed'), properties)
  }

  // Act
  const noProcess = readProcess(4242, failWith({ status: 1 }))
  const noPs = readProcess(4242, failWith({ code: 'ENOENT' }))
  const outOfProcesses = readProcess(4242, failWith({ code: 'EAGAIN' }))
  const crashed = readProcess(4242, failWith({ status: 2 }))

  // Assert
  assert.equal(noProcess, undefined)
  assert.equal(noPs, 'unreadable')
  assert.equal(outOfProcesses, 'unreadable')
  assert.equal(crashed, 'unreadable')
})
