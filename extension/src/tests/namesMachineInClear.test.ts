import assert from 'node:assert/strict'
import { test } from 'node:test'

import { namesMachineInClear } from '../utils/namesMachineInClear'
import type { RecordedOwner } from '../utils/readRecordedOwner'

// Value: protects=a record of private storage is told from one of a project folder, which decides whether a pid namespace keeps it from being judged and whether its machine is compared by digests; fails_when=a host name alone or a machine id alone does not count as a machine in clear, so a lock an earlier build or a remote window wrote is treated like a marker in a project folder; why_new=the two rules share this question since row 65; seam=none
test('a record with a host name or an editor’s machine id names its machine in clear', () => {
  // Act
  const withHostName = namesMachineInClear({ hostname: 'workstation' }),
    withMachineId = namesMachineInClear({ machineId: 'machine-a' }),
    withBoth = namesMachineInClear({
      hostname: 'workstation',
      machineId: 'machine-a',
    })
  // Assert
  assert.equal(withHostName, true)
  assert.equal(withMachineId, true)
  assert.equal(withBoth, true)
})

// Value: protects=the Wiki update marker and its claim, which must not name the computer, keep the rule of records in a project folder; fails_when=digests count as a machine in clear, so a marker of another pid namespace is probed here and a live window's marker is removed (Cycle 0046 row 65); why_new=the two rules share this question since row 65; seam=none
test('a record with digests alone, or with nothing, names no machine in clear', () => {
  // Arrange: a record as the Wiki update marker's claim has it, and one of a build up to 0.2.28.
  const recordOfAProjectFolder: RecordedOwner = {
      pid: 4242,
      machineKey: 'f9c8c7ddcf3d5f56',
      hostKey: 'd195d36bd79da7df',
    },
    recordWithAProcessIdAlone: RecordedOwner = { pid: 4242 }
  // Act
  const withDigests = namesMachineInClear(recordOfAProjectFolder),
    withNothing = namesMachineInClear(recordWithAProcessIdAlone)
  // Assert
  assert.equal(withDigests, false)
  assert.equal(withNothing, false)
})
