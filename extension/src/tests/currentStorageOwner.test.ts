import assert from 'node:assert/strict'
import { hostname } from 'node:os'
import { test } from 'node:test'

import {
  currentStorageOwner,
  useEditorMachineId,
} from '../utils/currentStorageOwner'

// Value: protects=a storage lock and a connection descriptor of a local window name the machine by the editor's id, which does not change with the network; fails_when=the id the editor gave is not recorded, so a lock is judged by the host name alone (Cycle 0044 row AD-6); why_new=the owner identity is new; seam=none
test('a local window records the editor’s machine id with the host name and the boot of this process', async (context) => {
  // Arrange
  context.after(() => useEditorMachineId(undefined, undefined))
  useEditorMachineId('machine-a', undefined)
  // Act
  const owner = await currentStorageOwner(),
    ownerAskedAgain = await currentStorageOwner()
  // Assert: the boot is read once, so every lock of this process names the same one.
  assert.equal(owner.hostname, hostname())
  assert.equal(owner.machineId, 'machine-a')
  assert.ok(owner.boot !== undefined)
  assert.deepEqual(ownerAskedAgain, owner)
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
