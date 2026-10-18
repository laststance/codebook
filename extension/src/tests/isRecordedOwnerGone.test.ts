import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, test, type TestContext } from 'node:test'

import { claimWikiUpdateMarker } from '../utils/claimWikiUpdateMarker'
import { isRecordedOwnerGone } from '../utils/isRecordedOwnerGone'
import { readLiveWikiUpdateMarker } from '../utils/readLiveWikiUpdateMarker'

import { idleChild } from './utils/idleChild'
import { ID_OF_NO_PROCESS } from './utils/idOfNoProcess'
import { realProcessStart } from './utils/realProcessStart'
import { startOfKilledWindow } from './utils/startOfKilledWindow'

// The tests with real child processes need the system's answer, which on Windows is a PowerShell that starts cold: the first read is made here, with the tests' own bound, and names its query when it fails.
before(async () => {
  await realProcessStart(process.pid)
})

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
    processStart: await realProcessStart(owner.pid!),
  }
  // Act: the judgement reads the owner's start with the tests' bound.
  const isGone = await isRecordedOwnerGone(
    recorded,
    { hostname: 'workstation', boot: { startedAtMs: 1_790_000_090_000 } },
    realProcessStart,
  )
  // Assert
  assert.equal(typeof recorded.processStart, 'string')
  assert.equal(isGone, false)
})

// Value: protects=a killed holder's reused pid is not taken for it; fails_when=the start is not compared, so a lock or claim stays for as long as any process has its owner's id (Cycle 0046 row 2, LK-F1); why_new=the judgement by the process start is new; seam=the injected start reader, then none (a real child process, and an id no process has)
test('an owner whose pid is used by another process is gone, and so is one whose process has ended', async (context) => {
  // Arrange: a record of a killed window whose id a live process of this test has now, and a record of a process that has ended: its id is one no process has. The id of a child that just exited would not do, because the system may give it to another process before the judgement asks.
  const processWithTheReusedId = await idleChild(context)
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
    realProcessStart,
  )
  const isEndedProcessGone = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
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
  // Arrange: the same record as a Linux window of this computer and of this pid namespace wrote it, without a kernel boot id; no process has its process id.
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: ID_OF_NO_PROCESS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
      processStart: 'linux@4026531836:100',
    },
    {
      hostname: 'workstation',
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
      boot: { id: 'boot-of-the-linux-kernel' },
      processStart: 'linux@4026531836:16362446',
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
  // Arrange: a record this editor wrote before the restart, in the namespace the distribution had then; this test process has its process id now.
  const startsAsked: number[] = []
  // Act
  const isGone = await isRecordedOwnerGone(
    {
      pid: process.pid,
      machineKey: 'f9c8c7ddcf3d5f56',
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

// Value: protects=the Wiki update marker and its claim of a live window in the other system of one computer whose own process start could not be read (on Windows a PowerShell query that failed or ran longer than its bound): a Windows window and a WSL window share a host name and a project folder, never a process id; fails_when=a record without a start is probed by its process id whatever it names its machine by, so one that matches by its host-name digest counts as gone because no process has its id in this space, the live marker is removed and a second update starts (Cycle 0046 row 103, the defect of rows 58 and 65 for a record without a start); why_new=no test had a record with digests and without a start; seam=the injected identity of a Linux window and the start reader, which must not be asked
test('an owner without a process start that names its machine by digests alone is never gone by its process id, only by another kernel boot id, and the same record with its host name in clear is gone as before', async () => {
  // Arrange: records a window wrote whose own start could not be read, judged by a Linux window of the same computer (one host-name digest; the record of another machine has neither digest of this one). Each names a process id that no process has here, except where it says that this test process has it.
  const startsAsked: number[] = []
  const readStart = async (pid: number): Promise<string> => {
    startsAsked.push(pid)
    return 'linux@4026531836:200'
  }
  const byDigestsAlone = {
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
  }
  const judged = (
    owner: {
      pid: number
      hostname?: string
      machineKey?: string
      hostKey?: string
      boot?: { id: string } | { startedAtMs: number }
    },
    window: {
      hostname: string
      boot: { id: string } | { startedAtMs: number }
    } = WINDOW_IN_NAMESPACE_4026531836,
  ): Promise<boolean> =>
    isRecordedOwnerGone({ ...byDigestsAlone, ...owner }, window, readStart)
  // Act
  const judgements = {
    noProcessHasItsIdHere: await judged({ pid: ID_OF_NO_PROCESS }),
    thisProcessHasItsIdHere: await judged({ pid: process.pid }),
    recordedUnderThisKernelBoot: await judged({
      pid: ID_OF_NO_PROCESS,
      boot: { id: 'boot-of-the-shared-kernel' },
    }),
    // This editor's record from before the restart: the other editor's under another boot id may be another computer with this host name.
    recordedUnderAnotherKernelBoot: await judged({
      pid: process.pid,
      machineKey: 'f9c8c7ddcf3d5f56',
      boot: { id: 'boot-before-the-restart' },
    }),
    recordedWithABootTime: await judged({
      pid: ID_OF_NO_PROCESS,
      boot: { startedAtMs: 1_000 },
    }),
    recordedWithABootTimeLongBeforeThisWindows: await judged(
      { pid: ID_OF_NO_PROCESS, boot: { startedAtMs: 1_000 } },
      {
        ...WINDOW_IN_NAMESPACE_4026531836,
        boot: { startedAtMs: 1_790_000_000_000 },
      },
    ),
    ofAnotherMachineUnderAnotherKernelBoot: await judged({
      pid: ID_OF_NO_PROCESS,
      hostKey: '5f0c1a8d2e3b4a69',
      boot: { id: 'boot-of-the-other-machine' },
    }),
    withItsHostNameInClear: await judged({
      pid: ID_OF_NO_PROCESS,
      hostname: 'workstation',
    }),
    withItsHostNameInClearWhileItsProcessRuns: await judged({
      pid: process.pid,
      hostname: 'workstation',
    }),
  }
  // Assert
  assert.deepEqual(judgements, {
    noProcessHasItsIdHere: false,
    thisProcessHasItsIdHere: false,
    recordedUnderThisKernelBoot: false,
    recordedUnderAnotherKernelBoot: true,
    recordedWithABootTime: false,
    recordedWithABootTimeLongBeforeThisWindows: false,
    ofAnotherMachineUnderAnotherKernelBoot: false,
    withItsHostNameInClear: true,
    withItsHostNameInClearWhileItsProcessRuns: false,
  })
  assert.deepEqual(startsAsked, [])
})

// Value: protects=the Wiki update marker and its claim of a live window on another computer with this host name (two Macs with the default "<User>s-MacBook-Pro", or two Linux computers, on one shared project folder); fails_when=the equal host-name digest makes the record this machine's, so the other computer's boot id reads as an earlier boot of this one, or its process id is probed here, and its live owner is called gone; why_new=Cycle 0046 second ship, red team RT1; seam=the injected identity of a Linux window and the start reader, which must not be asked; no_claim=two computers with one host name where either side names no boot id (Windows) still look like one machine
test('an owner of another computer with this host name, another editor’s machine id and another kernel boot id is never gone here, with or without its process start', async () => {
  // Arrange: records of a window on the other computer, which has this window's host-name digest, its own machine-id digest and its own kernel boot id; no process here has the first and third records' process ids, and this test process has the second's.
  const startsAsked: number[] = []
  const readStart = async (pid: number): Promise<string> => {
    startsAsked.push(pid)
    return 'linux@4026531836:200'
  }
  const ofTheOtherComputer = {
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-other-computer' },
  }
  // Act
  const judgements = {
    withAStartWithoutAProcessHere: await isRecordedOwnerGone(
      {
        pid: ID_OF_NO_PROCESS,
        ...ofTheOtherComputer,
        processStart: 'linux@4026531836:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
      readStart,
    ),
    withAStartWithAnotherProcessHere: await isRecordedOwnerGone(
      {
        pid: process.pid,
        ...ofTheOtherComputer,
        processStart: 'linux@4026531836:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
      readStart,
    ),
    withoutAStart: await isRecordedOwnerGone(
      { pid: ID_OF_NO_PROCESS, ...ofTheOtherComputer },
      WINDOW_IN_NAMESPACE_4026531836,
      readStart,
    ),
  }
  // Assert
  assert.deepEqual(judgements, {
    withAStartWithoutAProcessHere: false,
    withAStartWithAnotherProcessHere: false,
    withoutAStart: false,
  })
  assert.deepEqual(startsAsked, [])
})

/** Makes a project folder with an empty Wiki output folder, removed with the test, and names the Wiki's update marker. @example const wiki = await wikiFolder(context) */
async function wikiFolder(
  context: TestContext,
): Promise<{ outputDirectory: string; markerPath: string }> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-owner-without-start-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const outputDirectory = join(directory, 'wiki')
  await mkdir(outputDirectory)
  return { outputDirectory, markerPath: `${outputDirectory}.update-run.json` }
}

// Value: protects=the running Wiki update of a Windows window whose process start could not be read, beside a WSL window on the same project folder: only one of the two updates the Wiki; fails_when=the marker, which names its machine by digests and no start, is judged by a probe of its process id in the WSL window's space, counts as nobody's and is removed, so a second update starts beside the running one (Cycle 0046 row 103); why_new=no marker test had digests without a start; seam=the injected identity and the clock handed to the look
test('the update marker of a window whose process start could not be read counts until its run marker expires, although no process has its process id here', async (context) => {
  // Arrange: the marker of a Cursor run, written by a window of this computer whose own start could not be read; a Cursor run counts for 15 minutes, 60 s and the clock tolerance of 5 minutes.
  const wiki = await wikiFolder(context)
  await writeFile(
    wiki.markerPath,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      windowId: 'window-without-its-start',
      host: 'cursor',
      startedAtMs: 1_790_000_000_000,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
    }),
  )
  const lookAt = async (nowMs: number): Promise<string> =>
    (
      await readLiveWikiUpdateMarker(wiki.outputDirectory, 'own-window', {
        identity: WINDOW_IN_NAMESPACE_4026531836,
        readStart: async () => undefined,
        nowMs,
      })
    ).kind
  // Act
  const looks = {
    aMinuteIntoTheRun: await lookAt(1_790_000_060_000),
    atItsBound: await lookAt(1_790_001_260_000),
    pastItsBound: await lookAt(1_790_001_260_001),
  }
  // Assert
  assert.deepEqual(looks, {
    aMinuteIntoTheRun: 'live',
    atItsBound: 'live',
    pastItsBound: 'unowned',
  })
})

// Value: protects=the Update button on a Wiki whose repository carries an update marker with a process id no system can have ("pid": 4294967295, as a marker of 0.2.29.0 without digests), and a storage lock or claim that records such an id; fails_when=the id is answered as a process that may still run, because the system's probe refuses the number itself, so the marker refuses every start until the run's longest time has passed (about 21 minutes) and the lock is never taken over (Cycle 0046 row 180); why_new=no record test had an id above the largest a system has; seam=the clock handed to the look
test('an update marker and an owner record that name the process id 4294967295, which no system can have, are nobody’s at once', async (context) => {
  // Arrange: a marker as 0.2.29.0 writes it, without digests, whose run has just begun; and a lock's owner record of this machine as 0.2.29.0 writes it.
  const wiki = await wikiFolder(context)
  await writeFile(
    wiki.markerPath,
    '{"pid":4294967295,"windowId":"window-of-the-repository","host":"cursor","startedAtMs":1790000000000}',
  )
  // Act
  const look = await readLiveWikiUpdateMarker(
    wiki.outputDirectory,
    'own-window',
    {
      identity: WINDOW_IN_NAMESPACE_4026531836,
      readStart: async () => undefined,
      nowMs: 1_790_000_001_000,
    },
  )
  const isOwnerOfTheRecordGone = await isRecordedOwnerGone(
    { pid: 4_294_967_295, hostname: 'workstation' },
    WINDOW_IN_NAMESPACE_4026531836,
  )
  // Assert
  assert.deepEqual(look, { kind: 'unowned' })
  assert.equal(isOwnerOfTheRecordGone, true)
})

// Value: protects=the claim a live Windows window whose process start could not be read holds on the update marker while it removes or replaces it, beside a WSL window on the same project folder; fails_when=the claim, which names its machine by digests and no start, is judged by a probe of its process id in the WSL window's space and removed at once, so two windows change the marker at the same time (Cycle 0046 row 103); and it must still go after 60 s, or a killed window's claim would keep a stale marker for good; why_new=no claim test had digests without a start; seam=the claim file's modification time, the injected identity and the clock handed to the claim
test('a claim on the update marker of a window whose process start could not be read keeps the marker in place for 60 s and is removed after that, although no process has its process id here', async (context) => {
  // Arrange: a killed editor's marker (a marker of 0.2.29.0, whose process no longer exists), and a claim on it that names its machine by digests and no process start, last written at the fixed time.
  const wiki = await wikiFolder(context)
  const claimDirectory = `${wiki.markerPath}.takeover`
  const heldClaim = join(claimDirectory, 'held-by-a-window-without-its-start')
  const markerOfTheKilledEditor = JSON.stringify({
    pid: ID_OF_NO_PROCESS,
    windowId: 'killed-editor',
    host: 'vscode',
    startedAtMs: 1_790_000_000_000,
  })
  await writeFile(wiki.markerPath, markerOfTheKilledEditor)
  await mkdir(claimDirectory)
  await writeFile(
    heldClaim,
    JSON.stringify({
      pid: ID_OF_NO_PROCESS,
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
    }),
  )
  const claimedAt = new Date(1_790_000_000_000)
  await utimes(heldClaim, claimedAt, claimedAt)
  const startAt = (nowMs: number): Promise<string> =>
    claimWikiUpdateMarker(
      wiki.outputDirectory,
      {
        pid: process.pid,
        windowId: 'window-a',
        host: 'vscode',
        startedAtMs: nowMs,
      },
      {
        identity: WINDOW_IN_NAMESPACE_4026531836,
        readStart: async (pid) =>
          pid === process.pid ? 'linux@4026531836:16362446' : undefined,
        now: () => nowMs,
      },
    ).then(
      (claim) => ('release' in claim ? 'runs' : 'does not run'),
      // A start that is not let through answers a refusal or throws the creation's error; either way it does not run.
      () => 'does not run',
    )
  // Act: a start 60 s after the claim was written, and one a millisecond later.
  const after60Seconds = {
    start: await startAt(1_790_000_060_000),
    claims: await readdir(claimDirectory).catch(() => 'no claim folder'),
    marker: await readFile(wiki.markerPath, 'utf8'),
  }
  const aMillisecondLater = {
    start: await startAt(1_790_000_060_001),
    claims: await readdir(claimDirectory).catch(() => 'no claim folder'),
    markerOfWindow: JSON.parse(await readFile(wiki.markerPath, 'utf8'))
      .windowId,
  }
  // Assert
  assert.deepEqual(after60Seconds, {
    start: 'does not run',
    claims: ['held-by-a-window-without-its-start'],
    marker: markerOfTheKilledEditor,
  })
  assert.deepEqual(aMillisecondLater, {
    start: 'runs',
    claims: 'no claim folder',
    markerOfWindow: 'window-a',
  })
})

// Value: protects=the Wiki update marker of a live window in another pid namespace of one computer where neither window can read its own pid namespace (their Linux starts have one form, `linux`); fails_when=two Linux forms without a namespace count as one space of process ids, so the marker is probed here, no process has its id in this space, and its live owner is called gone (Cycle 0046 row 145); why_new=rows 65 and 103 left the case where neither side names a namespace; seam=the injected identity of a Linux window without its namespace and the start reader, which must not be asked for the record of a project folder
test('an owner that names its machine by digests alone and a Linux start without a pid namespace is never gone for a window that names no namespace either, and the same record with its host name in clear is gone as before', async () => {
  // Arrange: a Linux window that could not read its own pid namespace, and a record of this computer under the same kernel boot whose start names no namespace either; no process has its process id here.
  const windowWithoutItsNamespace = {
    hostname: 'workstation',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-shared-kernel' },
    processStart: 'linux:16362446',
  }
  const recordWithoutANamespace = {
    pid: ID_OF_NO_PROCESS,
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-shared-kernel' },
    processStart: 'linux:100',
  }
  const startsAsked: number[] = []
  const readStart = async (pid: number): Promise<string> => {
    startsAsked.push(pid)
    return 'linux:200'
  }
  // Act
  const isGoneInAProjectFolder = await isRecordedOwnerGone(
    recordWithoutANamespace,
    windowWithoutItsNamespace,
    readStart,
  )
  const isGoneWhileAnotherProcessHasItsId = await isRecordedOwnerGone(
    { ...recordWithoutANamespace, pid: process.pid },
    windowWithoutItsNamespace,
    readStart,
  )
  const isGoneInPrivateStorage = await isRecordedOwnerGone(
    { ...recordWithoutANamespace, hostname: 'workstation' },
    windowWithoutItsNamespace,
    readStart,
  )
  // Assert
  assert.equal(isGoneInAProjectFolder, false)
  assert.equal(isGoneWhileAnotherProcessHasItsId, false)
  assert.equal(isGoneInPrivateStorage, true)
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
