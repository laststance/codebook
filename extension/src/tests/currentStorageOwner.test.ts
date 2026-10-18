import assert from 'node:assert/strict'
import os, { hostname } from 'node:os'
import { test } from 'node:test'

import {
  currentStorageOwner,
  useEditorMachineId,
} from '../utils/currentStorageOwner'
import { isRecordedOwnerGone } from '../utils/isRecordedOwnerGone'
import type { ProcessStartInputs } from '../utils/readProcessStart'

import { answerKernelBootId } from './utils/answerKernelBootId'

/** The text of this process's `/proc/<pid>/stat` as a test hands it to the start reader: a process named "node" that began at clock tick 16362446. */
const STAT_OF_THIS_PROCESS =
  '4242 (node) S 1 4242 4242 0 -1 4194304 496 0 0 0 0 0 0 0 20 0 11 0 16362446 16637952 1813'

// Value: protects=what every storage lock, takeover claim, connection descriptor and profile marker carries: the machine by the editor's id and by two digests, the boot, and the start of the process, by which another window tells this process from a later one with its id; fails_when=a field is missing (Cycle 0044 row AD-6 for the machine id, Cycle 0046 rows 2 and 9 for the start, ER-3 for the digests) or a digest is taken from the wrong name; why_new=the old test deep-equalled the shape without start and digests; seam=the host name, the kernel boot id file and the injected start reader
test('a local window records the editor’s machine id, the host name, both digests of the machine, the boot and the start of this process', async (context) => {
  // Arrange: a local window of the editor that calls this machine "machine-a", on the host "workstation", under the kernel boot "boot-of-this-test"; this process began at clock tick 16362446 in the pid namespace 4026531836.
  context.after(() => useEditorMachineId(undefined, undefined))
  context.mock.method(os, 'hostname', () => 'workstation')
  answerKernelBootId(context, 'boot-of-this-test')
  useEditorMachineId('machine-a', undefined)
  // Act
  const owner = await currentStorageOwner({
    ownStart: {},
    platform: 'linux',
    readLink: () => 'pid:[4026531836]',
    readFile: async () => STAT_OF_THIS_PROCESS,
  })
  // Assert: the digests are the first 16 hex characters of the SHA-256 of "machine-a" and of "workstation".
  assert.deepEqual(owner, {
    hostname: 'workstation',
    machineId: 'machine-a',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-this-test' },
    processStart: 'linux@4026531836:16362446',
  })
})

// Value: protects=a storage lock does not start a query (a spawned ps or PowerShell) for this process's own start each time it is taken; fails_when=the self read repeats at every look, or two looks at once start two reads; why_new=the process start is new (ER-1, decision D7); seam=the injected start reader
test('the start of this process is read once, however often and however close together the owner is named', async () => {
  // Arrange
  let reads = 0
  const startInputs: ProcessStartInputs = {
    ownStart: {},
    platform: 'linux',
    readLink: () => 'pid:[4026531836]',
    readFile: async () => {
      reads += 1
      return STAT_OF_THIS_PROCESS
    },
  }
  // Act: two looks at the same moment, then a third.
  const [first, second] = await Promise.all([
    currentStorageOwner(startInputs),
    currentStorageOwner(startInputs),
  ])
  const third = await currentStorageOwner(startInputs)
  // Assert
  assert.deepEqual(
    [first.processStart, second.processStart, third.processStart],
    [
      'linux@4026531836:16362446',
      'linux@4026531836:16362446',
      'linux@4026531836:16362446',
    ],
  )
  assert.equal(reads, 1)
})

// Value: protects=a machine whose start query fails (PowerShell blocked, a slow start) is neither asked at every storage lock nor left without a start for good; fails_when=a failed read is repeated at once, is kept for good, or a start that was read is read again; why_new=the process start is new (ER-1); seam=the injected start reader and clock
test('a failed read of this process’s start is made again after 60 s, and a start that was read is kept', async () => {
  // Arrange: the first read fails; every later one answers. The clock is the test's own.
  let reads = 0,
    clockMs = 5_000
  const startInputs: ProcessStartInputs = {
    ownStart: {},
    platform: 'linux',
    readLink: () => 'pid:[4026531836]',
    now: () => clockMs,
    readFile: async () => {
      reads += 1
      if (reads === 1) throw new Error('EACCES: permission denied')
      return STAT_OF_THIS_PROCESS
    },
  }
  const look = async (): Promise<{ start?: string; reads: number }> => ({
    start: (await currentStorageOwner(startInputs)).processStart,
    reads,
  })
  // Act
  const atTheFailure = await look()
  clockMs = 64_999
  const justBefore60s = await look()
  clockMs = 65_000
  const after60s = await look()
  clockMs = 3_600_000
  const anHourLater = await look()
  // Assert
  assert.deepEqual(atTheFailure, { start: undefined, reads: 1 })
  assert.deepEqual(justBefore60s, { start: undefined, reads: 1 })
  assert.deepEqual(after60s, { start: 'linux@4026531836:16362446', reads: 2 })
  assert.deepEqual(anHourLater, {
    start: 'linux@4026531836:16362446',
    reads: 2,
  })
})

// Value: protects=the lock of a live window on a system without a kernel boot id whose start query fails; fails_when=such a window records the boot time it computes, so a clock set forward by 90 s makes its own record one of an earlier boot and another window takes its lock (Cycle 0046 row 9); why_new=a record without a start is judged by its boot (ER-1, ER-13); seam=the kernel boot id file, the clock, the uptime and the injected start reader
test('while the start of this process cannot be read its record carries no computed boot time, and a clock set forward by 90 s does not make it stale', async (context) => {
  // Arrange: no kernel boot id, as on macOS and Windows; the machine has been up for 600 s; the start query fails.
  answerKernelBootId(context, undefined)
  let clockMs = 1_790_000_600_000
  context.mock.method(Date, 'now', () => clockMs)
  context.mock.method(os, 'uptime', () => 600)
  const startInputs: ProcessStartInputs = {
    ownStart: {},
    platform: 'win32',
    run: async () => {
      throw new Error('spawn powershell.exe ENOENT')
    },
  }
  // Act: the window writes its record, the clock is set forward by 90 s, and the window judges that record.
  const recorded = await currentStorageOwner(startInputs)
  clockMs += 90_000
  const judgedBy = await currentStorageOwner(startInputs)
  const isOwnRecordStale = await isRecordedOwnerGone(
    { pid: process.pid, ...recorded },
    judgedBy,
  )
  // Assert
  assert.equal(recorded.processStart, undefined)
  assert.equal(recorded.boot, undefined)
  assert.equal(judgedBy.boot, undefined)
  assert.equal(isOwnRecordStale, false)
})

// Value: protects=a record of a window whose start cannot be read is still recognised as one of an earlier boot where the kernel names its boots; fails_when=every boot is dropped while the start is unknown, so a lock from before a restart stays for as long as a process has its id; why_new=the boot is conditional since Cycle 0046 (ER-1); seam=the kernel boot id file and the injected start reader
test('a kernel boot id is recorded also while the start of this process cannot be read', async (context) => {
  // Arrange
  answerKernelBootId(context, 'boot-of-this-test')
  // Act
  const owner = await currentStorageOwner({
    ownStart: {},
    platform: 'linux',
    readLink: () => 'pid:[4026531836]',
    readFile: async () => {
      throw new Error('EACCES: permission denied')
    },
  })
  // Assert
  assert.equal(owner.processStart, undefined)
  assert.deepEqual(owner.boot, { id: 'boot-of-this-test' })
})

// Value: protects=VS Code and Cursor on one computer, whose machine ids differ, still recognise each other by the host name's digest, and a window without an editor's machine id still has a digest to be recognised by; fails_when=both digests are taken from one name, or the host-name digest is kept from an earlier host name; why_new=the digests are new (ER-3, decision D2); seam=the host name
test('the host-name digest follows the host name, and a window without an editor’s machine id has it as both digests', async (context) => {
  // Arrange: a laptop whose host name follows the network.
  context.after(() => useEditorMachineId(undefined, undefined))
  let hostName = 'laptop.local'
  context.mock.method(os, 'hostname', () => hostName)
  // Act
  useEditorMachineId('machine-a', undefined)
  const atHome = await currentStorageOwner()
  hostName = 'laptop.lan'
  const atTheOffice = await currentStorageOwner()
  useEditorMachineId('machine-a', 'ssh-remote')
  const inARemoteWindow = await currentStorageOwner()
  // Assert: the first 16 hex characters of the SHA-256 of "machine-a", "laptop.local" and "laptop.lan".
  assert.deepEqual(
    { machineKey: atHome.machineKey, hostKey: atHome.hostKey },
    { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'e7e22941c1d09491' },
  )
  assert.deepEqual(
    { machineKey: atTheOffice.machineKey, hostKey: atTheOffice.hostKey },
    { machineKey: 'f9c8c7ddcf3d5f56', hostKey: '4def99cf4d783db5' },
  )
  assert.deepEqual(
    {
      machineKey: inARemoteWindow.machineKey,
      hostKey: inARemoteWindow.hostKey,
    },
    { machineKey: '4def99cf4d783db5', hostKey: '4def99cf4d783db5' },
  )
})

// Value: protects=two windows of one machine without a kernel boot id never take each other's locks because the clock was corrected between their starts; fails_when=a window keeps the boot time it computed first, so after a correction of more than the tolerance it disagrees for good with every window opened later, and each takes the other's live lock for one of an earlier boot; why_new=the boot identity is new (engineering review ER-20); seam=the kernel boot id file, the clock, the uptime and the injected start reader
test('on a system without a kernel boot id the boot time is computed again at every look and follows a corrected clock', async (context) => {
  // Arrange: no kernel boot id; the machine has been up for 600 s and the clock reads 1 790 000 600 000 ms. The start of this process can be read, so the boot time is recorded for the windows of 0.2.29.0.
  answerKernelBootId(context, undefined)
  let clockMs = 1_790_000_600_000
  context.mock.method(Date, 'now', () => clockMs)
  context.mock.method(os, 'uptime', () => 600)
  const startInputs: ProcessStartInputs = {
    ownStart: {},
    platform: 'linux',
    readLink: () => 'pid:[4026531836]',
    readFile: async () => STAT_OF_THIS_PROCESS,
  }
  // Act: the window names its boot, the clock is set forward by 90 s, and the window names its boot again.
  const beforeTheCorrection = await currentStorageOwner(startInputs)
  clockMs += 90_000
  const afterTheCorrection = await currentStorageOwner(startInputs)
  // Assert
  assert.deepEqual(beforeTheCorrection.boot, { startedAtMs: 1_790_000_000_000 })
  assert.deepEqual(afterTheCorrection.boot, { startedAtMs: 1_790_000_090_000 })
})

// Value: protects=two hosts that share a home directory and are opened from one computer never count as one machine; fails_when=a remote window records the editor's machine id, which names the computer the editor's interface runs on, so the lock of a writer on the other host looks like one of an earlier boot and is taken over; why_new=the owner identity is new; seam=none
test('a remote window is identified by its host name and records no machine id', async (context) => {
  // Arrange
  context.after(() => useEditorMachineId(undefined, undefined))
  useEditorMachineId('machine-a', 'ssh-remote')
  // Act
  const owner = await currentStorageOwner()
  // Assert
  assert.equal(owner.machineId, undefined)
  assert.equal(owner.hostname, hostname())
})

// Value: protects=computers whose editor answers one placeholder id for all of them never count as one machine; fails_when=the placeholder is recorded as a machine id; why_new=the owner identity is new; seam=none
test('an editor that answers the placeholder machine id is identified by its host name and records no machine id', async (context) => {
  // Arrange
  context.after(() => useEditorMachineId(undefined, undefined))
  useEditorMachineId('someValue.machineId', undefined)
  // Act
  const owner = await currentStorageOwner()
  // Assert
  assert.equal(owner.machineId, undefined)
  assert.equal(owner.hostname, hostname())
})

// Value: protects=the record of a Mac window whose start query fails: it keeps its boot session's id, which no clock moves, so another window still tells it of an earlier boot after a restart, and still tells it this machine's after a host-name change; fails_when=the whole boot is left out while the start is unknown, so the session's id goes with the boot time beside it (S4); why_new=Cycle 0046 third review S4: macOS names its boot by its session, with the boot time beside it; seam=the kernel boot id file, the system and the runner of the boot session query, and the injected start reader
test('on macOS while the start of this process cannot be read its record keeps the boot session’s id and no computed boot time', async (context) => {
  // Arrange: no kernel boot id, as on macOS; sysctl names the session; the start query fails.
  answerKernelBootId(context, undefined)
  const startInputs: ProcessStartInputs = {
    ownStart: {},
    platform: 'darwin',
    run: async () => {
      throw new Error('ps: process ended')
    },
  }
  // Act
  const recorded = await currentStorageOwner(startInputs, {
    platform: 'darwin',
    run: async () => ({ stdout: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14\n' }),
  })
  // Assert
  assert.deepEqual(
    { processStart: recorded.processStart, boot: recorded.boot },
    {
      processStart: undefined,
      boot: { id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14' },
    },
  )
})
