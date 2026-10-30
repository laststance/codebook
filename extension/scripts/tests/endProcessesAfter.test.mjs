import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  endProcesses,
  endProcessesAfter,
  processRuns,
  readNotedPids,
  readProcess,
} from './utils/endProcessesAfter.mjs'

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

// Value: protects=a test's clean-up from killing an id it cannot confirm as its own where `ps` is unavailable (a recycled id could be an unrelated process); fails_when=an unreadable ownership counts as owned, so the id is SIGKILLed; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=endProcesses with an injected process reader that answers 'unreadable' for a running child; no_claim=the Windows listing
test('a running process whose ownership cannot be read is not signalled and is reported as a survivor', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const signalled = []

  // Act
  const survivors = await endProcesses([child.pid], {
    readProcessInfo: () => 'unreadable',
    kill: (pid) => signalled.push(pid),
    waitMs: 100,
  })

  // Assert
  assert.deepEqual(
    { survivors, signalled },
    { survivors: [child.pid], signalled: [] },
  )
})

test('a child the test holds a handle of is ended although the process reader cannot say whose it is', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))

  // Act
  const survivors = await endProcesses([child.pid], {
    held: [child.pid],
    readProcessInfo: () => 'unreadable',
    waitMs: 2_000,
  })
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

  // Assert
  assert.deepEqual(survivors, [])
  assert.equal(processRuns(child.pid), false)
})

// Value: protects=the test runner from being killed by its own clean-up; fails_when=the orphan rule owns this process or its parent (a runner that is process 1 of a container, or started just before the test); why_new=Cycle 0064 pt3 review (CodeRabbit minor); seam=endProcesses with a reader that shows every id as a young orphan; no_claim=ancestors above the parent
test('this process and its parent are never signalled, even when they look like a young orphan', async () => {
  // Arrange
  const signalled = []

  // Act
  const survivors = await endProcesses([process.pid, process.ppid], {
    readProcessInfo: () => ({ state: 'S', parentPid: 1, ageSeconds: 0 }),
    kill: (pid) => signalled.push(pid),
    waitMs: 100,
  })

  // Assert
  assert.deepEqual({ survivors, signalled }, { survivors: [], signalled: [] })
})

test('a pid file that cannot be read fails the clean-up, and the held child is ended', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const hooks = []
  const fakeContext = { after: (hook) => hooks.push(hook) }
  endProcessesAfter(
    fakeContext,
    () =>
      Promise.reject(
        Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        }),
      ),
    undefined,
    { held: () => [child.pid] },
  )

  // Act
  const error = await hooks[0]().then(
    () => undefined,
    (failure) => failure,
  )
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

  // Assert
  assert.match(String(error), /EACCES/)
  assert.equal(processRuns(child.pid), false)
})

// Value: protects=the clean-up from taking an unreadable pid file for "no pids"; fails_when=every read failure answers no ids; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=readNotedPids with a real file made unreadable; no_claim=Windows, where chmod does not deny a read
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
    const missing = await readNotedPids(join(folder, 'missing.pid'))
    const failure = await readNotedPids(unreadable).then(
      () => undefined,
      (error) => error,
    )

    // Assert
    assert.deepEqual(missing, [])
    assert.match(String(failure), /EACCES/)
  },
)

// Value: protects=a leaked process from counting as ended when `ps` fails to run (EAGAIN, EMFILE, ENOMEM); fails_when=every `ps` failure but ENOENT reads as "no such process"; why_new=Cycle 0064 pt3 review (CodeRabbit minor); seam=readProcess with an injected exec that throws; no_claim=a real `ps` failure
test('a ps failure other than exit status 1 is unreadable, so a live process is not taken for gone', () => {
  // Arrange
  const failWith = (properties) => () => {
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
