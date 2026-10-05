import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSameStorageMachine } from '../utils/isSameStorageMachine'

// Value: protects=a lock an earlier build or a plain Node process left is still judged on the machine that wrote it, and a record that names no machine is never taken for this one; fails_when=a missing machine id on either side counts as another machine, so a lock left by a killed window of the previous version is never taken over after an update, or a missing host name counts as this machine; why_new=the machine id is new (Cycle 0044 row AD-6); seam=none
test('an owner recorded without a machine id, or judged by a process without one, is compared by host name', () => {
  // Act
  const recordedByEarlierBuild = isSameStorageMachine(
      { hostname: 'workstation' },
      { hostname: 'workstation', machineId: 'machine-a' },
    ),
    judgedWithoutMachineId = isSameStorageMachine(
      { hostname: 'workstation', machineId: 'machine-a' },
      { hostname: 'workstation' },
    ),
    recordedOnAnotherHost = isSameStorageMachine(
      { hostname: 'another-machine' },
      { hostname: 'workstation', machineId: 'machine-a' },
    ),
    recordedWithoutAnyMachine = isSameStorageMachine(
      {},
      { hostname: 'workstation' },
    )
  // Assert
  assert.equal(recordedByEarlierBuild, true)
  assert.equal(judgedWithoutMachineId, true)
  assert.equal(recordedOnAnotherHost, false)
  assert.equal(recordedWithoutAnyMachine, false)
})

// Value: protects=a record that must not name the computer (one in a learner's project folder) is still judged on the machine that wrote it, after the editor was switched and after the host name changed; fails_when=only one digest is compared, or a digest is compared with its own kind only, so a window without an editor's machine id never matches; why_new=the digests are new (ER-3, decision D2); seam=none
test('a record without host name and machine id matches by any digest, and one without digests names no machine', () => {
  // Arrange: the digests are the first 16 hex characters of the SHA-256 of "machine-a", "machine-b", "workstation" and "another-machine".
  const thisWindow = {
    hostname: 'workstation',
    machineId: 'machine-a',
    machineKey: 'f9c8c7ddcf3d5f56',
    hostKey: 'd195d36bd79da7df',
  }
  // Act
  const sameEditorAfterTheHostNameChanged = isSameStorageMachine(
      { machineKey: 'f9c8c7ddcf3d5f56', hostKey: '807ae35e0ef0b99a' },
      thisWindow,
    ),
    writtenWithoutAnEditorMachineId = isSameStorageMachine(
      { machineKey: 'd195d36bd79da7df', hostKey: 'd195d36bd79da7df' },
      thisWindow,
    ),
    readWithoutAnEditorMachineId = isSameStorageMachine(
      { machineKey: 'f9c8c7ddcf3d5f56', hostKey: 'd195d36bd79da7df' },
      {
        hostname: 'workstation',
        machineKey: 'd195d36bd79da7df',
        hostKey: 'd195d36bd79da7df',
      },
    ),
    ofAnotherMachine = isSameStorageMachine(
      { machineKey: '1fb1404a9738d5ed', hostKey: '807ae35e0ef0b99a' },
      thisWindow,
    ),
    withoutDigests = isSameStorageMachine({}, thisWindow)
  // Assert
  assert.equal(sameEditorAfterTheHostNameChanged, true)
  assert.equal(writtenWithoutAnEditorMachineId, true)
  assert.equal(readWithoutAnEditorMachineId, true)
  assert.equal(ofAnotherMachine, false)
  assert.equal(withoutDigests, false)
})

// Value: protects=VS Code and Cursor on one computer, whose machine ids differ, judge each other's records by pid and start instead of leaving them for good; fails_when=different machine id digests outweigh an equal host-name digest. This also pins the stated limit: two computers with one host name look like one machine to such a record; why_new=the digests are new (ER-3, ER-13); seam=none
test('a record of the other editor on one computer, with another machine id digest and the same host-name digest, is from this machine', () => {
  // Act
  const isOtherEditorsRecordFromThisMachine = isSameStorageMachine(
    { machineKey: '1fb1404a9738d5ed', hostKey: 'd195d36bd79da7df' },
    {
      hostname: 'workstation',
      machineId: 'machine-a',
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
    },
  )
  // Assert
  assert.equal(isOtherEditorsRecordFromThisMachine, true)
})

// Value: protects=the rule of every record that names its machine in clear (locks, takeover claims, descriptors and profile markers in private storage): two computers with one host name and different machine ids stay two machines; fails_when=a digest match is accepted for a record that carries a host name or a machine id, so the equal host-name digest makes them one machine; why_new=the digests are new (ER-3); seam=none
test('a record that names its host or machine id is not matched by a digest', () => {
  // Act
  const isOtherComputersRecordFromThisMachine = isSameStorageMachine(
    {
      hostname: 'workstation',
      machineId: 'machine-b',
      machineKey: '1fb1404a9738d5ed',
      hostKey: 'd195d36bd79da7df',
    },
    {
      hostname: 'workstation',
      machineId: 'machine-a',
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
    },
  )
  // Assert
  assert.equal(isOtherComputersRecordFromThisMachine, false)
})
