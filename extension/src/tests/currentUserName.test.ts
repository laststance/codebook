import assert from 'node:assert/strict'
import { test } from 'node:test'

import { currentUserName } from '../utils/currentUserName'

// Value: protects=the user a managed browser profile's marker names, by which the sweep of every other user leaves the folder; fails_when=the name is not the system's user name, or a process whose user has no entry in the system's user list (os.userInfo throws there) fails its launch instead of writing a marker without a user; why_new=CX7, /ship Codex adversarial review (markers name their user); seam=the reader of the user the function is given
test('the current user is named as the system names it, and a process without a user entry names none instead of failing', () => {
  // Arrange
  const userOfTheSystem = (): { username: string } => ({ username: 'learner' })
  const userWithoutEntry = (): { username: string } => {
    throw Object.assign(
      new Error('A system error occurred: uv_os_get_passwd returned ENOENT'),
      { code: 'ERR_SYSTEM_ERROR' },
    )
  }
  // Act
  const names = {
    named: currentUserName(userOfTheSystem),
    withoutEntry: currentUserName(userWithoutEntry),
  }
  // Assert
  assert.deepEqual(names, { named: 'learner', withoutEntry: undefined })
})
