import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  confirmLaunchedGroup,
  type ConfirmLaunchedGroupInput,
} from '../utils/confirmLaunchedGroup'

/** A launched leader as read at launch, with the two readers answering what a test names. */
function leader(
  now: { startedAt?: string; cwd?: string },
  overrides: Partial<ConfirmLaunchedGroupInput> = {},
): ConfirmLaunchedGroupInput {
  return {
    pid: 4242,
    startedAt: 'start-1',
    leaderExited: false,
    readProcessStart: async () => now.startedAt,
    readProcessCwd: async () => now.cwd,
    isGroupGone: () => false,
    isProcessGone: () => false,
    ...overrides,
  }
}

// protects=a retried stop signals the group only while its leader still has the launch start time and folder; fails_when=a leader that matches is refused; no_claim=real ps/lsof reads (the launcher test)
test('a leader with the launch start time and folder is the launched group', async () => {
  // Arrange
  const input = leader({ startedAt: 'start-1', cwd: '/repo/apps/api' })
  // Act
  const verdict = await confirmLaunchedGroup(input)
  // Assert
  assert.equal(verdict, 'launched')
})

// protects=a group id reused by another process is never signalled again; fails_when=a different start time still reads as the launched group; no_claim=the system's id reuse
test('a leader with another start time is a replaced group', async () => {
  // Arrange
  const otherStart = leader({ startedAt: 'start-2', cwd: '/repo/apps/api' })
  // Act
  const verdict = await confirmLaunchedGroup(otherStart)
  // Assert
  assert.equal(verdict, 'replaced')
})

// protects=a server that changed its working folder (process.chdir) is still the launched one while its start time matches, so a retried stop still ends it; fails_when=a folder change alone reads as another process and the retry signals nothing while the server runs on; no_claim=how the folder is read
test('a leader with the launch start time is the launched group after it changed its folder', async () => {
  // Arrange
  const movedFolder = leader({ startedAt: 'start-1', cwd: '/elsewhere' })
  // Act
  const verdict = await confirmLaunchedGroup(movedFolder)
  // Assert
  assert.equal(verdict, 'launched')
})

// protects=a group with no member left is reported gone, which no caller signals, so an id that another group takes between the check and a signal is never hit; a group that may still have members is never signalled on a guess: a failed ps or lsof read looks like an absent process; fails_when=a gone group reads as launched (a permission to signal) or an unreadable leader with members, or a failing probe, reads as launched; no_claim=a real reuse of a process-group id
test('an unreadable leader reads gone when its group has no member left, and unverifiable while it may have members', async () => {
  // Arrange
  const exitedAndGone = leader(
    {},
    { leaderExited: true, isGroupGone: () => true },
  )
  const notSeenToExitAndGone = leader({}, { isGroupGone: () => true })
  const exitedWithMembersPidTaken = leader({}, { leaderExited: true })
  const probeFails = leader(
    {},
    {
      leaderExited: true,
      isGroupGone: () => {
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
      },
    },
  )
  // Act
  const verdicts = [
    await confirmLaunchedGroup(exitedAndGone),
    await confirmLaunchedGroup(notSeenToExitAndGone),
    await confirmLaunchedGroup(exitedWithMembersPidTaken),
    await confirmLaunchedGroup(probeFails),
  ]
  // Assert
  assert.deepEqual(verdicts, ['gone', 'gone', 'unverifiable', 'unverifiable'])
})

// protects=the processes a server started that outlive its leader are ended by a retried stop: once the launcher saw the leader exit and no process has its id, a group that still has members can only be the launched one (an id is not given out while a group holds it); fails_when=those survivors read as unverifiable on every retry, so the stop never ends and holds the run and its port; no_claim=a real leaderless group
test('the survivors of a leader that exited are the launched group while no process has its id', async () => {
  // Arrange
  const survivors = leader(
    {},
    { leaderExited: true, isProcessGone: () => true },
  )
  const exitNotSeen = leader({}, { isProcessGone: () => true })
  // Act
  const verdicts = [
    await confirmLaunchedGroup(survivors),
    await confirmLaunchedGroup(exitNotSeen),
  ]
  // Assert
  assert.deepEqual(verdicts, ['launched', 'unverifiable'])
})

// protects=once the launcher saw its leader exit, a process readable at that pid is another process, so a retried stop leaves its group alone; fails_when=a readable process at an exited leader's pid (same folder, start unreadable or not recorded at launch) reads as the launched group; no_claim=a real reuse of a process id
test('a process readable at the pid of a leader that exited is a replaced group', async () => {
  // Arrange
  const sameFolderStartUnreadable = leader(
    { cwd: '/repo/apps/api' },
    { leaderExited: true },
  )
  const sameFolderNoLaunchStart = leader(
    { startedAt: 'start-9', cwd: '/repo/apps/api' },
    { leaderExited: true, startedAt: undefined },
  )
  // Act
  const verdicts = [
    await confirmLaunchedGroup(sameFolderStartUnreadable),
    await confirmLaunchedGroup(sameFolderNoLaunchStart),
  ]
  // Assert
  assert.deepEqual(verdicts, ['replaced', 'replaced'])
})

// protects=nothing is signalled on a guess: a leader that cannot be read while its group has members, or whose start time cannot be read, is unverifiable, while a readable launch start time identifies the leader with its folder unread; fails_when=an unreadable leader is signalled, or a matching start time is refused for want of the folder; no_claim=the stop's failure text
test('a leader that cannot be read is unverifiable, and its start time alone identifies it', async () => {
  // Arrange
  const unreadableAlive = leader({})
  const startUnreadable = leader({ cwd: '/repo/apps/api' })
  const folderUnreadable = leader({ startedAt: 'start-1' })
  // Act
  const verdicts = [
    await confirmLaunchedGroup(unreadableAlive),
    await confirmLaunchedGroup(startUnreadable),
    await confirmLaunchedGroup(folderUnreadable),
  ]
  // Assert
  assert.deepEqual(verdicts, ['unverifiable', 'unverifiable', 'launched'])
})

// protects=a folder alone never authorizes a signal: a running leader whose launch start time was never recorded is unverifiable even in the launch folder, whatever start it has now, so the retry fails and names the pid instead of signalling a process that may be another; fails_when=a missing launch start plus a matching folder reads as launched; no_claim=how the run reads the start again before it attaches (its own test)
test('without a recorded launch start a running leader in the launch folder is unverifiable', async () => {
  // Arrange
  const sameFolder = leader(
    { startedAt: 'start-9', cwd: '/repo/apps/api' },
    { startedAt: undefined },
  )
  const otherFolder = leader(
    { startedAt: 'start-9', cwd: '/elsewhere' },
    { startedAt: undefined },
  )
  // Act
  const verdicts = [
    await confirmLaunchedGroup(sameFolder),
    await confirmLaunchedGroup(otherFolder),
  ]
  // Assert
  assert.deepEqual(verdicts, ['unverifiable', 'unverifiable'])
})
