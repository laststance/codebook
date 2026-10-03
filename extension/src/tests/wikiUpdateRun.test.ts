import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WikiUpdateRun } from '../utils/wikiUpdateRun'

const fixedClock = () => new Date('2026-10-03T12:00:00.000Z')

test('a second Wiki update start is refused while the first run is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', '/repo/.codebook/wiki')

  // Act
  const secondStartWasAccepted = run.begin('cursor', '/repo/.codebook/wiki')

  // Assert
  assert.equal(secondStartWasAccepted, false)
  assert.deepEqual(run.status(), {
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:00:00.000Z',
    outputDirectory: '/repo/.codebook/wiki',
  })
})

test('a published Wiki update shows the new identity and lets the next run start', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('cursor', '/repo/.codebook/wiki')

  // Act
  run.succeed('a1b2c3d4e5f6+0f9e8d7c')
  const nextStartWasAccepted = run.begin('cursor', '/repo/.codebook/wiki')

  // Assert
  assert.equal(nextStartWasAccepted, true)
})

test('each ending of a Wiki update run is reported as its own state with the output folder', () => {
  // Arrange
  const outputDirectory = '/repo/.codebook/wiki'
  const endings: Array<[(run: WikiUpdateRun) => void, string]> = [
    [(run): void => run.succeed('a+1'), 'succeeded'],
    [(run): void => run.fail('Cursor Agent exited with code 1'), 'failed'],
    [(run): void => run.cancel(), 'cancelled'],
    [(run): void => run.timeOut(), 'timed-out'],
    [(run): void => run.conflict(['notes/mine.md']), 'conflict'],
  ]

  for (const [end, expectedState] of endings) {
    const run = new WikiUpdateRun(fixedClock)
    run.begin('vscode', outputDirectory)

    // Act
    end(run)

    // Assert
    const status = run.status()
    assert.equal(status.state, expectedState)
    assert.equal(
      status.state === 'idle' ? '' : status.outputDirectory,
      outputDirectory,
    )
  }
})

test('a late result after a run ended cannot overwrite the newer state', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', '/repo/.codebook/wiki')
  run.cancel()

  // Act
  run.succeed('late+publish')
  run.fail('late failure')

  // Assert
  assert.equal(run.status().state, 'cancelled')
})

test('an update that finds the Wiki already current records that and starts no run', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.alreadyCurrent('/repo/.codebook/wiki', 'a1b2c3d4e5f6+0f9e8d7c')

  // Assert
  assert.deepEqual(run.status(), {
    state: 'already-current',
    finishedAt: '2026-10-03T12:00:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    outputDirectory: '/repo/.codebook/wiki',
  })
  assert.equal(run.isRunning(), false)
})

test('an already-current note never replaces a run that is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', '/repo/.codebook/wiki')

  // Act
  run.alreadyCurrent('/repo/.codebook/wiki')

  // Assert
  assert.equal(run.status().state, 'running')
})

test('the status snapshot cannot change the run when a caller edits it', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', '/repo/.codebook/wiki')
  run.conflict(['notes/mine.md'])

  // Act
  const snapshot = run.status()
  if (snapshot.state === 'conflict') snapshot.paths.push('injected.md')

  // Assert
  const again = run.status()
  assert.deepEqual(again.state === 'conflict' ? again.paths : [], [
    'notes/mine.md',
  ])
})
