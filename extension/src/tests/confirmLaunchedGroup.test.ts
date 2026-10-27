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
    cwd: '/repo/apps/api',
    leaderExited: false,
    readProcessStart: async () => now.startedAt,
    readProcessCwd: async () => now.cwd,
    isGroupGone: () => false,
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

// protects=a group id reused by another process is never signalled again; fails_when=a different start time or folder still reads as the launched group; no_claim=the system's id reuse
test('a leader with another start time or another folder is a replaced group', async () => {
  // Arrange
  const otherStart = leader({ startedAt: 'start-2', cwd: '/repo/apps/api' })
  const otherFolder = leader({ startedAt: 'start-1', cwd: '/elsewhere' })
  // Act
  const verdicts = [
    await confirmLaunchedGroup(otherStart),
    await confirmLaunchedGroup(otherFolder),
  ]
  // Assert
  assert.deepEqual(verdicts, ['replaced', 'replaced'])
})

// protects=a leader that cannot be read is the launched group's end only when its group has no member left: a read that failed (a ps or lsof timeout) and an absent process read alike, so a group that still has members is never signalled on a guess, also after the launcher saw its leader exit; fails_when=unreadable facts plus an earlier exit read as the launched group while the group id is in use; no_claim=a real reuse of a process-group id
test('an unreadable leader is the launched group only when its group has no member left', async () => {
  // Arrange
  const exitedAndGone = leader(
    {},
    { leaderExited: true, isGroupGone: () => true },
  )
  const exitedWithMembers = leader({}, { leaderExited: true })
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
    await confirmLaunchedGroup(exitedWithMembers),
    await confirmLaunchedGroup(probeFails),
  ]
  // Assert
  assert.deepEqual(verdicts, ['launched', 'unverifiable', 'unverifiable'])
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

// protects=nothing is signalled on a guess: a leader that cannot be read while alive, or whose folder cannot be read, is unverifiable; fails_when=an unreadable leader is signalled; no_claim=the stop's failure text
test('a leader that cannot be read, or half-read, is unverifiable', async () => {
  // Arrange
  const unreadableAlive = leader({})
  const folderUnreadable = leader({ startedAt: 'start-1' })
  // Act
  const verdicts = [
    await confirmLaunchedGroup(unreadableAlive),
    await confirmLaunchedGroup(folderUnreadable),
  ]
  // Assert
  assert.deepEqual(verdicts, ['unverifiable', 'unverifiable'])
})

// protects=a launch whose start could not be read at launch still compares the folder; fails_when=a missing launch start refuses every retry, or a foreign folder passes; no_claim=none
test('without a recorded launch start the folder alone decides', async () => {
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
  assert.deepEqual(verdicts, ['launched', 'replaced'])
})
