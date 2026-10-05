import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { isRecordedOwnerGone } from '../utils/isRecordedOwnerGone'
import { readProcessStart } from '../utils/readProcessStart'

import { idleChild } from './utils/idleChild'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

/** A process id that names no process on any system this suite runs on: above Linux's highest id, above macOS's, and no multiple of four as every Windows id is. */
const ID_OF_NO_PROCESS = 2 ** 22 + 1

// Value: protects=a forward clock step never makes a live owner stale on a system without a kernel boot id; fails_when=the boot time still decides for a record that carries its owner's start, so a window that computes its boot 90 s later takes the lock of a live window (Cycle 0046 row 9, PL-1); why_new=the judgement by the process start is new; seam=the injected identities and start reader
test('a live owner is never gone when the clock reads 90 s later, in a macOS-shaped and a Windows-shaped identity', async () => {
  // Arrange: this running process holds a lock; since it wrote the lock the clock was set forward by 90 s, so the boot time computed now is 90 s later.
  const macStart = 'ps:Mon Oct  5 09:12:33 2026',
    windowsStart = 'win:2026-10-05T09:12:33.1234567Z'
  // Act
  const isMacOwnerGone = await isRecordedOwnerGone(
    {
      pid: process.pid,
      hostname: 'laptop.local',
      machineId: 'machine-a',
      boot: { startedAtMs: 1_790_000_000_000 },
      processStart: macStart,
    },
    {
      hostname: 'laptop.local',
      machineId: 'machine-a',
      boot: { startedAtMs: 1_790_000_090_000 },
    },
    async () => macStart,
  )
  const isWindowsOwnerGone = await isRecordedOwnerGone(
    {
      pid: process.pid,
      hostname: 'DESKTOP-A',
      machineId: 'machine-b',
      boot: { startedAtMs: 1_790_000_000_000 },
      processStart: windowsStart,
    },
    {
      hostname: 'DESKTOP-A',
      machineId: 'machine-b',
      boot: { startedAtMs: 1_790_000_090_000 },
    },
    async () => windowsStart,
  )
  // Assert
  assert.equal(isMacOwnerGone, false)
  assert.equal(isWindowsOwnerGone, false)
})

// Value: protects=the same judgement with the system's own answer for a real process; fails_when=the start read for a live process differs from the one recorded for it a moment before, or the boot time decides; why_new=only a real read shows it (decision D6); seam=none (a real child process)
test('a real running process recorded with its start is not gone when the clock reads 90 s later', async (context) => {
  // Arrange: a live process recorded with the start the system names for it, and a boot time computed 90 s later than the recorded one.
  const owner = await idleChild(context)
  const recorded = {
    pid: owner.pid!,
    hostname: 'workstation',
    boot: { startedAtMs: 1_790_000_000_000 },
    processStart: await readProcessStart(owner.pid!),
  }
  // Act
  const isGone = await isRecordedOwnerGone(recorded, {
    hostname: 'workstation',
    boot: { startedAtMs: 1_790_000_090_000 },
  })
  // Assert
  assert.equal(typeof recorded.processStart, 'string')
  assert.equal(isGone, false)
})

// Value: protects=a killed holder's reused pid is not taken for it; fails_when=the start is not compared, so a lock or claim stays for as long as any process has its owner's id (Cycle 0046 row 2, LK-F1); why_new=the judgement by the process start is new; seam=the injected start reader, then none (real child processes)
test('an owner whose pid is used by another process is gone, and so is one whose process has ended', async (context) => {
  // Arrange: a record of a killed window whose id a live process of this test has now, and a record of a process that has ended.
  const processWithTheReusedId = await idleChild(context)
  const ended = spawnSync(process.execPath, ['-e', ''])
  const identity = { hostname: 'workstation', boot: { id: 'boot-1' } }
  const startsAsked: number[] = []
  // Act
  const isGoneByAnInjectedStart = await isRecordedOwnerGone(
    {
      pid: process.pid,
      hostname: 'workstation',
      boot: { id: 'boot-1' },
      processStart: 'linux:100',
    },
    identity,
    async (pid) => {
      startsAsked.push(pid)
      return 'linux:200'
    },
  )
  const isGoneByTheRealStart = await isRecordedOwnerGone(
    {
      pid: processWithTheReusedId.pid!,
      hostname: 'workstation',
      boot: { id: 'boot-1' },
      processStart: startOfKilledWindow(),
    },
    identity,
  )
  const isEndedProcessGone = await isRecordedOwnerGone(
    {
      pid: ended.pid,
      hostname: 'workstation',
      boot: { id: 'boot-1' },
      processStart: startOfKilledWindow(),
    },
    identity,
  )
  // Assert
  assert.equal(isGoneByAnInjectedStart, true)
  assert.deepEqual(startsAsked, [process.pid])
  assert.equal(isGoneByTheRealStart, true)
  assert.equal(isEndedProcessGone, true)
})

// Value: protects=every judgement that must not change or must stay cheap; fails_when=an unreadable start calls a live owner gone, an earlier kernel boot costs a query, a record of 0.2.29.0 is no longer judged by its pid and boot, or an owner of another machine is judged here; why_new=the function has a new shape (ER-2); seam=the injected identities and start reader
test('an owner whose start cannot be read is not gone, one of an earlier kernel boot is gone without a read, a record without a start is judged by pid and boot as before, and an owner of another machine is not gone', async () => {
  // Arrange: every record names this running process, except where it says that no process has its id.
  const startsAsked: string[] = []
  const answering =
    (name: string, start: string | undefined) =>
    async (): Promise<string | undefined> => {
      startsAsked.push(name)
      return start
    }
  const workstation = { hostname: 'workstation', boot: { id: 'boot-2' } }
  // Act
  const judgements = {
    startCannotBeRead: await isRecordedOwnerGone(
      {
        pid: process.pid,
        hostname: 'workstation',
        boot: { id: 'boot-2' },
        processStart: 'linux:100',
      },
      workstation,
      answering('startCannotBeRead', undefined),
    ),
    earlierKernelBoot: await isRecordedOwnerGone(
      {
        pid: process.pid,
        hostname: 'workstation',
        boot: { id: 'boot-1' },
        processStart: 'linux:100',
      },
      workstation,
      answering('earlierKernelBoot', 'linux:100'),
    ),
    withoutStartAndBootTime61sEarlier: await isRecordedOwnerGone(
      {
        pid: process.pid,
        hostname: 'workstation',
        boot: { startedAtMs: 1_790_000_000_000 },
      },
      { hostname: 'workstation', boot: { startedAtMs: 1_790_000_061_000 } },
      answering('withoutStartAndBootTime61sEarlier', 'linux:100'),
    ),
    withoutStartAndBootTime59sEarlier: await isRecordedOwnerGone(
      {
        pid: process.pid,
        hostname: 'workstation',
        boot: { startedAtMs: 1_790_000_000_000 },
      },
      { hostname: 'workstation', boot: { startedAtMs: 1_790_000_059_000 } },
      answering('withoutStartAndBootTime59sEarlier', 'linux:100'),
    ),
    withoutStartAndNoProcess: await isRecordedOwnerGone(
      { pid: ID_OF_NO_PROCESS, hostname: 'workstation' },
      workstation,
      answering('withoutStartAndNoProcess', 'linux:100'),
    ),
    ofAnotherMachine: await isRecordedOwnerGone(
      {
        pid: ID_OF_NO_PROCESS,
        hostname: 'another-machine',
        boot: { id: 'boot-1' },
        processStart: 'linux:100',
      },
      workstation,
      answering('ofAnotherMachine', 'linux:200'),
    ),
  }
  // Assert
  assert.deepEqual(judgements, {
    startCannotBeRead: false,
    earlierKernelBoot: true,
    withoutStartAndBootTime61sEarlier: true,
    withoutStartAndBootTime59sEarlier: false,
    withoutStartAndNoProcess: true,
    ofAnotherMachine: false,
  })
  assert.deepEqual(startsAsked, ['startCannotBeRead'])
})

// Value: protects=a live owner whose start was read by another system's query is never called gone: a Windows window and a WSL window can share a host name and a project folder while their process ids are of two spaces, and a later build may read starts in another form; fails_when=any two different texts count as "another process", so the record of a live window is taken for a killed one's whenever a process here happens to have its id; why_new=found while implementing Cycle 0046 rows 2 and 9 (the judgement by the process start is new); seam=the injected start reader
test('an owner whose start has another system’s form is not gone, although the process that has its id here began at another time', async () => {
  // Arrange: a record a Windows window wrote, judged where the process with that id is a Linux process.
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: process.pid,
      hostname: 'workstation',
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    },
    { hostname: 'workstation' },
    async () => 'linux:16362446',
  )
  // Assert
  assert.equal(isGone, false)
})

// Value: protects=a record names its owner's start to the reader, which lets a start kept by a sweep confirm it; fails_when=the judgement asks without the recorded start, so a sweep's kept start is never used or, worse, is trusted for a start it does not equal; why_new=the cache rule is new (ER-12); seam=the injected start reader
test('the judgement hands the recorded start to the reader as the start a kept one may confirm', async () => {
  // Arrange
  const expectedStarts: (string | undefined)[] = []
  // Act
  await isRecordedOwnerGone(
    { pid: process.pid, hostname: 'workstation', processStart: 'linux:100' },
    { hostname: 'workstation' },
    async (_pid, inputs) => {
      expectedStarts.push(inputs?.expectedStart)
      return 'linux:100'
    },
  )
  // Assert
  assert.deepEqual(expectedStarts, ['linux:100'])
})
