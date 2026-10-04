import assert from 'node:assert/strict'
import os, { hostname } from 'node:os'
import { test } from 'node:test'

import {
  currentStorageOwner,
  useEditorMachineId,
} from '../utils/currentStorageOwner'

import { answerKernelBootId } from './utils/answerKernelBootId'

// Value: protects=a storage lock and a connection descriptor of a local window name the machine by the editor's id, which does not change with the network; fails_when=the id the editor gave is not recorded, so a lock is judged by the host name alone (Cycle 0044 row AD-6); why_new=the owner identity is new; seam=none
test('a local window records the editor’s machine id with the host name and the boot of this process', async (context) => {
  // Arrange: a local window of the editor that calls this machine "machine-a", under the kernel boot "boot-of-this-test".
  context.after(() => useEditorMachineId(undefined, undefined))
  answerKernelBootId(context, 'boot-of-this-test')
  useEditorMachineId('machine-a', undefined)
  // Act
  const owner = await currentStorageOwner()
  // Assert
  assert.deepEqual(owner, {
    hostname: hostname(),
    machineId: 'machine-a',
    boot: { id: 'boot-of-this-test' },
  })
})

// Value: protects=two windows of one machine without a kernel boot id never take each other's locks because the clock was corrected between their starts; fails_when=a window keeps the boot time it computed first, so after a correction of more than the tolerance it disagrees for good with every window opened later, and each takes the other's live lock for one of an earlier boot; why_new=the boot identity is new (engineering review ER-20); seam=the kernel boot id file, the clock and the uptime
test('on a system without a kernel boot id the boot time is computed again at every look and follows a corrected clock', async (context) => {
  // Arrange: no kernel boot id; the machine has been up for 600 s and the clock reads 1 790 000 600 000 ms.
  answerKernelBootId(context, undefined)
  let clockMs = 1_790_000_600_000
  context.mock.method(Date, 'now', () => clockMs)
  context.mock.method(os, 'uptime', () => 600)
  // Act: the window names its boot, the clock is set forward by 90 s, and the window names its boot again.
  const beforeTheCorrection = await currentStorageOwner()
  clockMs += 90_000
  const afterTheCorrection = await currentStorageOwner()
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
