import assert from 'node:assert/strict'
import { test } from 'node:test'

import { canJudgeOwnerHere } from '../utils/canJudgeOwnerHere'

import { startOfKilledWindow } from './utils/startOfKilledWindow'

/** A WSL window of the computer "workstation": a Linux process begun at clock tick 16362446. The digests are the first 16 hex characters of the SHA-256 of "machine-a" and of "workstation". */
const LINUX_WINDOW = {
  hostname: 'workstation',
  machineId: 'machine-a',
  machineKey: 'f9c8c7ddcf3d5f56',
  hostKey: 'd195d36bd79da7df',
  processStart: 'linux:16362446',
}

// Value: protects=what a window of this system left is judged by its owner's process id and start, in private storage and in a project folder; fails_when=a record of this machine and this system is taken for one that cannot be probed here, so a killed window's lock, claim or marker is never taken over (Cycle 0046 row 58); why_new=the predicate is new; seam=none
test('an owner of this machine whose start has this system’s form can be judged here', () => {
  // Act: two records judged by a Linux window, and one judged by a Windows window, whose own start says which system it is.
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
        processStart: 'linux:100',
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
  // Arrange: a start in the form this platform's query answers, and one in a form no platform answers.
  const windowWithoutItsStart = { hostname: 'workstation' }
  // Act
  const ofThisPlatform = canJudgeOwnerHere(
      {
        pid: 4242,
        hostname: 'workstation',
        processStart: startOfKilledWindow(),
      },
      windowWithoutItsStart,
    ),
    ofNoPlatform = canJudgeOwnerHere(
      { pid: 4242, hostname: 'workstation', processStart: 'solaris:100' },
      windowWithoutItsStart,
    )
  // Assert
  assert.equal(ofThisPlatform, true)
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
