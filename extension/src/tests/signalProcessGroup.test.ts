import assert from 'node:assert/strict'
import { test } from 'node:test'

import { signalProcessGroup } from '../utils/signalProcessGroup'

test('a signal for an owned process group is sent to the whole group', (context) => {
  // Arrange
  const kill = context.mock.method(process, 'kill', (): true => true)
  // Act
  signalProcessGroup(4242, 'SIGTERM')
  // Assert
  assert.deepEqual(kill.mock.calls[0]?.arguments, [-4242, 'SIGTERM'])
  assert.equal(kill.mock.callCount(), 1)
})

test('signalling a process group that no longer exists is not a failure of the release', (context) => {
  // Arrange
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
  })
  // Act
  const signalling = (): void => signalProcessGroup(4242, 'SIGKILL')
  // Assert
  assert.doesNotThrow(signalling)
})

test('signalling a process group whose exited members are not reaped yet is not a failure of the release', (context) => {
  // Arrange
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
  })
  // Act
  const signalling = (): void => signalProcessGroup(4242, 'SIGTERM')
  // Assert
  assert.doesNotThrow(signalling)
})

test('a signal that fails for another reason is reported to the release', (context) => {
  // Arrange
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EINVAL'), { code: 'EINVAL' })
  })
  // Act
  const signalling = (): void => signalProcessGroup(4242, 'SIGTERM')
  // Assert
  assert.throws(signalling, { message: 'kill EINVAL', code: 'EINVAL' })
})
