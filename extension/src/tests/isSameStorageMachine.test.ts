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
