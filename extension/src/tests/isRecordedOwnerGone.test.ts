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
  // Arrange: this running process holds a lock; since it wrote the lock the clock was set forward by 90 s, so the boot time a second window of the same system computes now is 90 s later.
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
      processStart: 'ps:Mon Oct  5 10:30:00 2026',
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
      processStart: 'win:2026-10-05T10:30:00.0000000Z',
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
    { ...identity, processStart: 'linux:16362446' },
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
  const workstation = {
    hostname: 'workstation',
    boot: { id: 'boot-2' },
    processStart: 'linux:16362446',
  }
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

// Value: protects=the lock, claim or marker of a live window in the other system of one computer: a Windows window and a WSL window share a host name and can open one project folder, while a process id of one names another process, or none, in the other; fails_when=a record that matches this machine by its host-name digest is probed here whatever system wrote it, so the live owner counts as gone because no process has its id here, and its marker is removed under it (Cycle 0046 row 58); why_new=found while implementing Cycle 0046 rows 2 and 9; seam=the injected identity of a Linux window and the start reader, which must not be asked
test('an owner whose start has another system’s form is never gone here, although no process has its process id here, or another one has', async () => {
  // Arrange: two records a Windows window wrote into a project folder, naming its machine by digests alone, judged by a WSL window of the same computer (one host-name digest, another machine id digest). No Linux process has the first record's process id; this test process has the second's.
  const linuxWindow = {
    hostname: 'workstation',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-linux-kernel' },
    processStart: 'linux:16362446',
  }
  const startsAsked: number[] = []
  const readStart = async (pid: number): Promise<string> => {
    startsAsked.push(pid)
    return 'linux:200'
  }
  // Act
  const isGoneWithoutAProcessHere = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    },
    linuxWindow,
    readStart,
  )
  const isGoneWithAnotherProcessHere = await isRecordedOwnerGone(
    {
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    },
    linuxWindow,
    readStart,
  )
  // Assert
  assert.equal(isGoneWithoutAProcessHere, false)
  assert.equal(isGoneWithAnotherProcessHere, false)
  assert.deepEqual(startsAsked, [])
})

// Value: protects=the takeover of what a killed window of this system left in a project folder: a record that names its machine by digests and its start in this system's form is still judged by its process id; fails_when=every record that matches by a digest counts as one that cannot be probed here, so a killed window's marker or claim is never called gone (Cycle 0046 row 58, the other side of the rule); why_new=the rule of the process space is new; seam=the injected identity of a Linux window
test('an owner whose start has this system’s form and whose process id names no process is gone', async () => {
  // Arrange: the same record as a Linux window of this computer wrote it; no process has its process id.
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      processStart: 'linux:100',
    },
    {
      hostname: 'workstation',
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-of-the-linux-kernel' },
      processStart: 'linux:16362446',
    },
  )
  // Assert
  assert.equal(isGone, true)
})

/** A window in one WSL distribution of the computer "workstation": a Linux process of the pid namespace 4026531836 under the kernel boot "boot-of-the-shared-kernel". The digests are the first 16 hex characters of the SHA-256 of "machine-a" and of "workstation". */
const WINDOW_IN_NAMESPACE_4026531836 = {
  hostname: 'workstation',
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  boot: { id: 'boot-of-the-shared-kernel' },
  processStart: 'linux@4026531836:16362446',
}

// Value: protects=the marker or claim of a live window in another WSL distribution of one computer (or in a container beside its host): the two share the host name, the kernel and its boot id, while a process id of one names another process, or none, in the other; fails_when=a Linux start names no pid namespace, or the namespace is not compared, so the record is probed here and its live owner counts as gone because no process has its id in this namespace (Cycle 0046 row 65); why_new=row 58 told systems apart, not namespaces; seam=the injected identity of a window in another namespace, and the start reader, which must not be asked
test('an owner of another pid namespace under the same kernel boot is never gone here, although no process has its process id here, or another one has', async () => {
  // Arrange: two records a window of the pid namespace 4026532214 wrote into a project folder both distributions open, under the same kernel boot. No process of this namespace has the first record's process id; this test process has the second's.
  const startsAsked: number[] = []
  const readStart = async (pid: number): Promise<string> => {
    startsAsked.push(pid)
    return 'linux@4026531836:200'
  }
  const recordOfTheOtherNamespace = {
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-shared-kernel' },
    processStart: 'linux@4026532214:100',
  }
  // Act
  const isGoneWithoutAProcessHere = await isRecordedOwnerGone(
    { pid: ID_OF_NO_PROCESS, ...recordOfTheOtherNamespace },
    WINDOW_IN_NAMESPACE_4026531836,
    readStart,
  )
  const isGoneWithAnotherProcessHere = await isRecordedOwnerGone(
    { pid: process.pid, ...recordOfTheOtherNamespace },
    WINDOW_IN_NAMESPACE_4026531836,
    readStart,
  )
  // Assert
  assert.equal(isGoneWithoutAProcessHere, false)
  assert.equal(isGoneWithAnotherProcessHere, false)
  assert.deepEqual(startsAsked, [])
})

// Value: protects=the takeover of what a killed window of this pid namespace left: a record with this namespace's form is still judged by its process id; fails_when=every record that names a namespace counts as one that cannot be probed here (Cycle 0046 row 65, the other side of the rule); why_new=the form names the namespace since row 65; seam=the injected identity
test('an owner of this pid namespace whose process id names no process is gone', async () => {
  // Arrange: the same record as a window of this pid namespace wrote it; no process has its process id.
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-of-the-shared-kernel' },
      processStart: 'linux@4026531836:100',
    },
    WINDOW_IN_NAMESPACE_4026531836,
  )
  // Assert
  assert.equal(isGone, true)
})

// Value: protects=a lock, claim or marker a killed window left before the machine restarted is taken over although its pid namespace has another number now (WSL gives a distribution its namespace when it starts); fails_when=the namespace is compared before the kernel boot, so every record from before a restart counts as one of another namespace and stays for good (Cycle 0046 row 65); why_new=the form names the namespace since row 65; seam=the injected identity and the start reader, which must not be asked
test('an owner of another pid namespace recorded under another kernel boot id is gone, although a process has its process id here', async () => {
  // Arrange: a record written before the restart, in the namespace the distribution had then; this test process has its process id now.
  const startsAsked: number[] = []
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: process.pid,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-before-the-restart' },
      processStart: 'linux@4026532214:100',
    },
    WINDOW_IN_NAMESPACE_4026531836,
    async (pid) => {
      startsAsked.push(pid)
      return 'linux@4026531836:200'
    },
  )
  // Assert
  assert.equal(isGone, true)
  assert.deepEqual(startsAsked, [])
})

// Value: protects=a storage lock, takeover claim, connection descriptor or profile marker a killed window left is taken over after its WSL distribution alone was restarted (`wsl --terminate` while the virtual machine keeps running): the kernel boot id is the same and the distribution has another pid namespace number; fails_when=a record in private storage, which names its machine in clear and which two process spaces do not share, is treated like a marker in a project folder, so the lock counts as one of another pid namespace, is never judged, and refuses every write until it is removed by hand (a regression of row 65 found while implementing it); why_new=row 65 named the pid namespace in the form; seam=the injected identity
test('an owner that names its machine in clear and another pid namespace under the same kernel boot is gone when no process has its process id', async () => {
  // Arrange: the lock of a killed window, recorded in the pid namespace the distribution had before it was restarted; no process has its process id now.
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
      hostname: 'workstation',
      boot: { id: 'boot-of-the-shared-kernel' },
      processStart: 'linux@4026532214:100',
    },
    WINDOW_IN_NAMESPACE_4026531836,
  )
  // Assert
  assert.equal(isGone, true)
})

// Value: protects=the same lock when a process has its process id: a reused id is told by the clock ticks of the start, which are one clock for every pid namespace of a kernel, and a live owner is never called gone because its record names a namespace number that is no longer this one; fails_when=the two starts are compared with their namespaces, so they always differ and a live window's lock is taken over, or they are not compared at all and a reused id keeps the lock for good; why_new=row 65 named the pid namespace in the form; seam=the injected identity and start reader
test('an owner that names its machine in clear and another pid namespace is gone when the process with its id began at another tick, and not gone when it began at the same tick', async () => {
  // Arrange: a lock recorded at clock tick 100 in the pid namespace 4026532214; this test process has its process id, and this window reads starts in the namespace 4026531836.
  const lockOfTheOtherNamespace = {
    pid: process.pid,
    hostname: 'workstation',
    boot: { id: 'boot-of-the-shared-kernel' },
    processStart: 'linux@4026532214:100',
  }
  // Act
  const isGoneWhenTheIdWasReused = await isRecordedOwnerGone(
    lockOfTheOtherNamespace,
    WINDOW_IN_NAMESPACE_4026531836,
    async () => 'linux@4026531836:200',
  )
  const isGoneWhileItsOwnerRuns = await isRecordedOwnerGone(
    lockOfTheOtherNamespace,
    WINDOW_IN_NAMESPACE_4026531836,
    async () => 'linux@4026531836:100',
  )
  // Assert
  assert.equal(isGoneWhenTheIdWasReused, true)
  assert.equal(isGoneWhileItsOwnerRuns, false)
})

// Value: protects=row 58 for records in private storage too: a lock a Windows window wrote is never probed by a WSL window that reaches the same file, although it names the shared host name in clear; fails_when=a record that names its machine in clear is judged whatever system its start names, so the live Windows window's lock counts as gone because no Linux process has its id; why_new=records that name their machine in clear got a rule of their own; seam=the injected identity and the start reader, which must not be asked
test('an owner that names its machine in clear and whose start has another system’s form is never gone here', async () => {
  // Arrange: a lock a Windows window wrote, judged by a Linux window of the same host name; no Linux process has its process id.
  const startsAsked: number[] = []
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
      hostname: 'workstation',
      processStart: 'win:2026-10-05T09:12:33.1234567Z',
    },
    WINDOW_IN_NAMESPACE_4026531836,
    async (pid) => {
      startsAsked.push(pid)
      return 'linux@4026531836:200'
    },
  )
  // Assert
  assert.equal(isGone, false)
  assert.deepEqual(startsAsked, [])
})

// Value: protects=a record names its owner's start to the reader, which lets a start kept by a sweep confirm it; fails_when=the judgement asks without the recorded start, so a sweep's kept start is never used or, worse, is trusted for a start it does not equal; why_new=the cache rule is new (ER-12); seam=the injected start reader
test('the judgement hands the recorded start to the reader as the start a kept one may confirm', async () => {
  // Arrange
  const expectedStarts: (string | undefined)[] = []
  // Act
  await isRecordedOwnerGone(
    { pid: process.pid, hostname: 'workstation', processStart: 'linux:100' },
    { hostname: 'workstation', processStart: 'linux:16362446' },
    async (_pid, inputs) => {
      expectedStarts.push(inputs?.expectedStart)
      return 'linux:100'
    },
  )
  // Assert
  assert.deepEqual(expectedStarts, ['linux:100'])
})
