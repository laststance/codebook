import assert from 'node:assert/strict'
import { test } from 'node:test'

import { managedProfileRoot } from '../runtimeSupport/utils/managedProfileRoot'

// Value: protects=where the managed browser profiles of each system live: the user's own temp folder on Windows, which has no user id to judge another user's folder by, and the shared, short /tmp on macOS and Linux, where the sweep compares the folder's owner; fails_when=Windows uses `<drive>:\tmp`, a folder at a drive root every user may change, or macOS and Linux lose the fixed /tmp that Chrome and the debugger resolve (SC3, Cycle 0046 repeat review); why_new=the root was one constant for every system; seam=the system and the user temp folder the function is given
test('managed browser profiles live in the user’s own temp folder on Windows and in /tmp on macOS and Linux', () => {
  // Arrange
  const userTemporaryDirectory = (): string =>
    'C:\\Users\\a b\\AppData\\Local\\Temp'
  // Act
  const roots = {
    windows: managedProfileRoot('win32', userTemporaryDirectory),
    macOS: managedProfileRoot('darwin', userTemporaryDirectory),
    linux: managedProfileRoot('linux', userTemporaryDirectory),
  }
  // Assert
  assert.deepEqual(roots, {
    windows: 'C:\\Users\\a b\\AppData\\Local\\Temp',
    macOS: '/tmp',
    linux: '/tmp',
  })
})
