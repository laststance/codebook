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

// Value: protects=a window whose own start could not be read still takes over what a killed window of its system left: this system's form is then the one its platform's query answers; fails_when=an identity without a start has no form, so every record with a start counts as one of another system and no stale lock is taken over for the 60 s until the own start is read again; why_new=the predicate is new; seam=none (the platform this test runs on)
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
