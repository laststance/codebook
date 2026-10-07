import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canJudgeOwnerHere } from '../utils/canJudgeOwnerHere'

import { startOfKilledWindow } from './utils/startOfKilledWindow'

/** A WSL window of the computer "workstation": a Linux process of the pid namespace 4026531836, begun at clock tick 16362446. The digests are the first 16 hex characters of the SHA-256 of "machine-a" and of "workstation". */
const LINUX_WINDOW = {
  hostname: 'workstation',
  machineId: 'machine-a',
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  processStart: 'linux@4026531836:16362446',
}

// Value: protects=what a window of this system left is judged by its owner's process id and start, in private storage and in a project folder; fails_when=a record of this machine and this system is taken for one that cannot be probed here, so a killed window's lock, claim or marker is never taken over (Cycle 0046 row 58); why_new=the predicate is new; seam=none
test('an owner of this machine whose start has this system’s form can be judged here', () => {
  // Act: two records judged by a Linux window (the one of private storage names no pid namespace, which decides nothing for it; the one of a project folder names this window's), and one judged by a Windows window, whose own start says which system it is.
  const ofPrivateStorage = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        machineId: 'machine-a',
        processStart: 'linux:100',
      },
      LINUX_WINDOW,
    ),
    ofAProjectFolder = canJudgeOwnerHere(
      {
        pid: 4242,
        machineKey: '1fb1404a9738d5ed',
        hostKey: 'd195d36bd79da7df',
        processStart: 'linux@4026531836:100',
      },
      LINUX_WINDOW,
    ),
    ofAWindowsWindowJudgedByAnother = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'DESKTOP-A',
        processStart: 'win:2026-10-05T09:12:33.1234567Z',
      },
      {
        hostname: 'DESKTOP-A',
        processStart: 'win:2026-10-05T10:30:00.0000000Z',
      },
    )
  // Assert
  assert.equal(ofPrivateStorage, true)
  assert.equal(ofAProjectFolder, true)
  assert.equal(ofAWindowsWindowJudgedByAnother, true)
})

// Value: protects=a record of 0.2.29.0, or of a window whose start could not be read, keeps the rules it had (the 60 s age rule of a claim, the pid probe and the run expiry of a marker); fails_when=a record without a start counts as one judged by its owner's start, so a claim of a frozen 0.2.29.0 window is never removed by age; why_new=the predicate is new (ER-4, ER-7); seam=none
test('an owner without a process start cannot be judged here', () => {
  // Act
  const ofRelease0229 = canJudgeOwnerHere(
    { pid: 4242, hostname: 'workstation', machineId: 'machine-a' },
    LINUX_WINDOW,
  )
  // Assert
  assert.equal(ofRelease0229, false)
})

// Value: protects=the live window of the other system of one computer (a Windows window beside a WSL window, which share a host name and a project folder): its record is not probed in a space of process ids it does not live in; fails_when=the form of the recorded start is not compared, so the record counts as judgeable and a probe of its process id here calls its live owner gone (Cycle 0046 row 58); why_new=the predicate is new; seam=none
test('an owner whose start has another system’s form cannot be judged here, nor can an owner of another machine', () => {
  // Act
  const ofTheWindowsSideOfThisComputer = canJudgeOwnerHere(
      {
        pid: 4242,
        machineKey: '1fb1404a9738d5ed',
        hostKey: 'd195d36bd79da7df',
        processStart: 'win:2026-10-05T09:12:33.1234567Z',
      },
      LINUX_WINDOW,
    ),
    ofAMac = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        processStart: 'ps:Mon Oct  5 09:12:33 2026',
      },
      LINUX_WINDOW,
    ),
    ofAnotherMachine = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'another-machine',
        machineId: 'machine-b',
        processStart: 'linux:100',
      },
      LINUX_WINDOW,
    )
  // Assert
  assert.equal(ofTheWindowsSideOfThisComputer, false)
  assert.equal(ofAMac, false)
  assert.equal(ofAnotherMachine, false)
})

// Value: protects=a window whose own start could not be read still takes over what a killed window of its system and its pid namespace left: its form is then the one every start it reads here has; fails_when=an identity without a start has no form, or on Linux one without the pid namespace, so every record with a start counts as one of another space and no stale lock is taken over for the 60 s until the own start is read again (Cycle 0046 rows 58 and 65); why_new=the predicate is new; seam=none (the platform and the pid namespace this test runs in)
test('a window whose own start is unknown judges an owner whose start has the form of the platform it runs on, and no other', () => {
  // Arrange: a start in the form every start read in this process has (on Linux with this pid namespace), and one in a form no platform answers. The window knows its host name and its digest, not its own start.
  const windowWithoutItsStart = {
    hostname: 'workstation',
    hostKey: 'd195d36bd79da7df',
  }
  // Act
  const ofPrivateStorage = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        processStart: startOfKilledWindow(),
      },
      windowWithoutItsStart,
    ),
    ofAProjectFolder = canJudgeOwnerHere(
      {
        pid: 4242,
        hostKey: 'd195d36bd79da7df',
        processStart: startOfKilledWindow(),
      },
      windowWithoutItsStart,
    ),
    ofNoPlatform = canJudgeOwnerHere(
      { pid: 4242, hostname: 'workstation', processStart: 'solaris:100' },
      windowWithoutItsStart,
    )
  // Assert
  assert.equal(ofPrivateStorage, true)
  assert.equal(ofAProjectFolder, true)
  assert.equal(ofNoPlatform, false)
})

/** A window in one WSL distribution of the computer "workstation": a Linux process of the pid namespace 4026531836 under the kernel boot "boot-of-the-shared-kernel". */
const WINDOW_IN_NAMESPACE_4026531836 = {
  hostname: 'workstation',
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  boot: { id: 'boot-of-the-shared-kernel' },
  processStart: 'linux@4026531836:16362446',
}

// Value: protects=the live window of another WSL distribution of one computer keeps the age rule of its claim and the run expiry of its marker, because its record cannot be judged here; fails_when=only the system is compared and not the pid namespace, or a namespace one side could not read counts as the other side's (Cycle 0046 row 65); why_new=the form names the namespace since row 65; seam=none
test('an owner of another pid namespace under the same kernel boot cannot be judged here, nor can one where a namespace or a kernel boot id is missing on either side', () => {
  // Arrange: records of this machine by the host-name digest, each with a Linux start.
  const ofThisMachine = {
    pid: 4242,
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
  }
  // Act
  const ofAnotherNamespace = canJudgeOwnerHere(
      {
        ...ofThisMachine,
        boot: { id: 'boot-of-the-shared-kernel' },
        processStart: 'linux@4026532214:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    ),
    recordNamesNoNamespace = canJudgeOwnerHere(
      {
        ...ofThisMachine,
        boot: { id: 'boot-of-the-shared-kernel' },
        processStart: 'linux:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    ),
    windowNamesNoNamespace = canJudgeOwnerHere(
      {
        ...ofThisMachine,
        boot: { id: 'boot-of-the-shared-kernel' },
        processStart: 'linux@4026532214:100',
      },
      { ...WINDOW_IN_NAMESPACE_4026531836, processStart: 'linux:16362446' },
    ),
    recordNamesNoKernelBoot = canJudgeOwnerHere(
      { ...ofThisMachine, processStart: 'linux@4026532214:100' },
      WINDOW_IN_NAMESPACE_4026531836,
    ),
    windowNamesNoKernelBoot = canJudgeOwnerHere(
      {
        ...ofThisMachine,
        boot: { id: 'boot-before-the-restart' },
        processStart: 'linux@4026532214:100',
      },
      { ...WINDOW_IN_NAMESPACE_4026531836, boot: undefined },
    ),
    windowNamesABootTime = canJudgeOwnerHere(
      {
        ...ofThisMachine,
        boot: { startedAtMs: 1_000 },
        processStart: 'linux@4026532214:100',
      },
      {
        ...WINDOW_IN_NAMESPACE_4026531836,
        boot: { startedAtMs: 1_790_000_000_000 },
      },
    )
  // Assert
  assert.equal(ofAnotherNamespace, false)
  assert.equal(recordNamesNoNamespace, false)
  assert.equal(windowNamesNoNamespace, false)
  assert.equal(recordNamesNoKernelBoot, false)
  assert.equal(windowNamesNoKernelBoot, false)
  assert.equal(windowNamesABootTime, false)
})

// Value: protects=the predicate answers as the judgement does: a record from before a restart is judged (and is gone) whatever space of process ids it names, so the claim of a window killed before the restart is not kept for its 60 s lease as if it could not be judged; fails_when=the form decides before the kernel boot (Cycle 0046 row 65); why_new=the form names the namespace since row 65; seam=none
test('an owner of another pid namespace recorded under another kernel boot id can be judged here, and so can one of this pid namespace', () => {
  // Act
  const ofAnotherNamespaceBeforeTheRestart = canJudgeOwnerHere(
      {
        pid: 4242,
        machineKey: '1fb1404a9738d5ed',
        hostKey: 'd195d36bd79da7df',
        boot: { id: 'boot-before-the-restart' },
        processStart: 'linux@4026532214:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    ),
    ofThisNamespace = canJudgeOwnerHere(
      {
        pid: 4242,
        machineKey: '1fb1404a9738d5ed',
        hostKey: 'd195d36bd79da7df',
        boot: { id: 'boot-of-the-shared-kernel' },
        processStart: 'linux@4026531836:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    )
  // Assert
  assert.equal(ofAnotherNamespaceBeforeTheRestart, true)
  assert.equal(ofThisNamespace, true)
})

// Value: protects=what a killed window left in private storage is judged after its WSL distribution alone was restarted, while a marker in a project folder keeps the rule of the pid namespace; fails_when=the pid namespace decides for a record that names its machine in clear (the lock is never taken over), or the system no longer decides for it (a Windows window's lock is probed on Linux); why_new=records that name their machine in clear got a rule of their own after row 65; seam=none
test('an owner that names its machine in clear can be judged here although its Linux start names another pid namespace, and cannot when its start has another system’s form', () => {
  // Arrange: records of private storage, which name the host or the editor's machine id.
  const sameKernelBoot = { id: 'boot-of-the-shared-kernel' }
  // Act
  const namedByHost = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        boot: sameKernelBoot,
        processStart: 'linux@4026532214:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    ),
    namedByMachineId = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'laptop.lan',
        machineId: 'machine-a',
        boot: sameKernelBoot,
        processStart: 'linux@4026532214:100',
      },
      { ...WINDOW_IN_NAMESPACE_4026531836, machineId: 'machine-a' },
    ),
    recordedWithoutANamespace = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        boot: sameKernelBoot,
        processStart: 'linux:100',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    ),
    ofAWindowsWindow = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        processStart: 'win:2026-10-05T09:12:33.1234567Z',
      },
      WINDOW_IN_NAMESPACE_4026531836,
    )
  // Assert
  assert.equal(namedByHost, true)
  assert.equal(namedByMachineId, true)
  assert.equal(recordedWithoutANamespace, true)
  assert.equal(ofAWindowsWindow, false)
})

// Value: protects=the Wiki update marker and its claim of a live window in another pid namespace of one computer (two containers, or a container and its host, under one host name and one kernel boot) where neither window can read its own pid namespace: their Linux starts then have the same form, `linux`, although a process id of one names another process, or none, in the other; fails_when=two Linux forms without a namespace count as one space of process ids, so the record is probed here and its live owner is called gone (Cycle 0046 row 145, the case rows 65 and 103 left); why_new=every test with a form without a namespace had one on the other side; seam=none
test('an owner that names its machine by digests alone and a Linux start without a pid namespace cannot be judged by a window that names no namespace either, and the same record with its host name in clear is judged as before', () => {
  // Arrange: a Linux window that could not read its own pid namespace, and records of this computer (one host-name digest) under the same kernel boot, written by a window that could not read its own either.
  const windowWithoutItsNamespace = {
    hostname: 'workstation',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
    boot: { id: 'boot-of-the-shared-kernel' },
    processStart: 'linux:16362446',
  }
  const byDigestsAlone = {
    pid: 4242,
    machineKey: '1fb1404a9738d5ed',
    hostKey: 'd195d36bd79da7df',
    processStart: 'linux:100',
  }
  // Act
  const judgeable = {
    underTheSameKernelBoot: canJudgeOwnerHere(
      { ...byDigestsAlone, boot: { id: 'boot-of-the-shared-kernel' } },
      windowWithoutItsNamespace,
    ),
    whereNeitherNamesAKernelBoot: canJudgeOwnerHere(byDigestsAlone, {
      ...windowWithoutItsNamespace,
      boot: undefined,
    }),
    underAnotherKernelBoot: canJudgeOwnerHere(
      { ...byDigestsAlone, boot: { id: 'boot-before-the-restart' } },
      windowWithoutItsNamespace,
    ),
    withItsHostNameInClear: canJudgeOwnerHere(
      {
        ...byDigestsAlone,
        hostname: 'workstation',
        boot: { id: 'boot-of-the-shared-kernel' },
      },
      windowWithoutItsNamespace,
    ),
  }
  // Assert
  assert.deepEqual(judgeable, {
    underTheSameKernelBoot: false,
    whereNeitherNamesAKernelBoot: false,
    underAnotherKernelBoot: true,
    withItsHostNameInClear: true,
  })
})

// Value: protects=the takeover of what a killed window left in a project folder on macOS and on Windows, whose forms name no pid namespace because those systems have one space of process ids each; fails_when=the rule for a Linux form without a namespace is applied to every form without one, so no marker or claim is ever judged on macOS or Windows and each stays until its time rule (Cycle 0046 row 145, the other side); why_new=the rule of the form without a namespace is new; seam=none
test('an owner that names its machine by digests alone is still judged on macOS and on Windows, whose forms name no pid namespace', () => {
  // Act: a record a macOS window wrote judged by another macOS window, and the same for Windows.
  const onMacOS = canJudgeOwnerHere(
      {
        pid: 4242,
        hostKey: 'd195d36bd79da7df',
        processStart: 'ps:Mon Oct  5 09:12:33 2026',
      },
      {
        hostname: 'workstation',
        hostKey: 'd195d36bd79da7df',
        processStart: 'ps:Mon Oct  5 10:30:00 2026',
      },
    ),
    onWindows = canJudgeOwnerHere(
      {
        pid: 4242,
        hostKey: 'd195d36bd79da7df',
        processStart: 'win:2026-10-05T09:12:33.1234567Z',
      },
      {
        hostname: 'workstation',
        hostKey: 'd195d36bd79da7df',
        processStart: 'win:2026-10-05T10:30:00.0000000Z',
      },
    )
  // Assert
  assert.equal(onMacOS, true)
  assert.equal(onWindows, true)
})
