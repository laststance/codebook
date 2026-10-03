import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isProcessGroupGone } from '../utils/isProcessGroupGone'

test('a process group that still has a live member is not reported gone', (context) => {
  // Arrange
  const probe = context.mock.method(process, 'kill', (): true => true)
  // Act
  const isGone = isProcessGroupGone(4242)
  // Assert
  assert.equal(isGone, false)
  assert.deepEqual(probe.mock.calls[0]?.arguments, [-4242, 0])
})

test('a process group that no longer exists is reported gone', (context) => {
  // Arrange
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
  })
  // Act
  const isGone = isProcessGroupGone(4242)
  // Assert
  assert.equal(isGone, true)
})

test('a process group whose exited members are not reaped yet is not reported gone on macOS', (context) => {
  // Arrange
  context.mock.property(process, 'platform', 'darwin')
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
  })
  // Act
  const isGone = isProcessGroupGone(4242)
  // Assert
  assert.equal(isGone, false)
})

test('a probe that fails for another reason is reported instead of a guess about the group', (context) => {
  // Arrange
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EINVAL'), { code: 'EINVAL' })
  })
  // Act
  const probing = () => isProcessGroupGone(4242)
  // Assert
  assert.throws(probing, { message: 'kill EINVAL', code: 'EINVAL' })
})

test('a probe failure without a system error name is reported unchanged', (context) => {
  // Arrange
  context.mock.method(process, 'kill', (): true => {
    throw new Error('probe interrupted')
  })
  // Act
  const probing = () => isProcessGroupGone(4242)
  // Assert
  assert.throws(probing, { message: 'probe interrupted' })
})

// Cycle 0044 (0041-F3): red while a Linux EPERM probe was read as "not gone yet", so the release waited silently until its timeout.
test('a probe answered EPERM outside macOS is reported instead of read as a group that is still exiting', (context) => {
  // Arrange
  context.mock.property(process, 'platform', 'linux')
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
  })
  // Act
  const probing = () => isProcessGroupGone(4242)
  // Assert
  assert.throws(probing, { message: 'kill EPERM', code: 'EPERM' })
})

// Cycle 0044 (0041-F8 / 0041-OCR1): red while group id 1 was probed, which asks about every process of the user.
test('probing process group id 1 is refused before any probe is sent', (context) => {
  // Arrange
  const probe = context.mock.method(process, 'kill', (): true => true)
  // Act
  const probing = () => isProcessGroupGone(1)
  // Assert
  assert.throws(probing, {
    name: 'RangeError',
    message: 'Process group id 1 does not name one owned process group',
  })
  assert.equal(probe.mock.callCount(), 0)
})
