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

test('signalling a process group whose exited members are not reaped yet is not a failure of the release on macOS', (context) => {
  // Arrange
  context.mock.property(process, 'platform', 'darwin')
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

// Cycle 0044 (0041-F3): outside macOS, EPERM means a live member the user may not signal; red while EPERM was tolerated on every platform.
test('signalling a process group with a member the user may not signal fails the release outside macOS, naming EPERM', (context) => {
  // Arrange
  context.mock.property(process, 'platform', 'linux')
  context.mock.method(process, 'kill', (): true => {
    throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
  })
  // Act
  const signalling = (): void => signalProcessGroup(4242, 'SIGTERM')
  // Assert
  assert.throws(signalling, { message: 'kill EPERM', code: 'EPERM' })
})

// Cycle 0044 (0041-F8 / 0041-OCR1): red while any number reached process.kill, where -1 signals every process of the user and -0 the caller's group.
for (const processGroup of [0, 1, -5, 1.5])
  test(`signalling process group id ${processGroup} is refused before any signal is sent`, (context) => {
    // Arrange
    const kill = context.mock.method(process, 'kill', (): true => true)
    // Act
    const signalling = (): void => signalProcessGroup(processGroup, 'SIGKILL')
    // Assert
    assert.throws(signalling, {
      name: 'RangeError',
      message: `Process group id ${processGroup} does not name one owned process group`,
    })
    assert.equal(kill.mock.callCount(), 0)
  })
