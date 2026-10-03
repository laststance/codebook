import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WikiUpdateRun } from '../utils/wikiUpdateRun'

const fixedClock = (): Date => new Date('2026-10-03T12:00:00.000Z')
const output = {
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}

test('a second Wiki update start is refused while the first run is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  const secondStartWasAccepted = run.begin('cursor', output, 900_000)

  // Assert
  assert.equal(secondStartWasAccepted, false)
  assert.deepEqual(run.status(), {
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:00:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('a published Wiki update shows the new identity and its host, and lets the next run start', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('cursor', output, 900_000)

  // Act
  run.succeed('a1b2c3d4e5f6+0f9e8d7c')
  const published = run.status()
  const nextStartWasAccepted = run.begin('cursor', output, 900_000)

  // Assert
  assert.deepEqual(published, {
    state: 'succeeded',
    host: 'cursor',
    finishedAt: '2026-10-03T12:00:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  assert.equal(nextStartWasAccepted, true)
})

test('a failed Wiki update says whether the site on disk was kept or replaced', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.fail('The published Wiki does not match the source.', 'replaced')

  // Assert
  assert.deepEqual(run.status(), {
    state: 'failed',
    host: 'vscode',
    finishedAt: '2026-10-03T12:00:00.000Z',
    reason: 'The published Wiki does not match the source.',
    site: 'replaced',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('a cancelled Wiki update names the host that ran it, so the page can say what was stopped', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.cancel('kept')

  // Assert
  assert.deepEqual(run.status(), {
    state: 'cancelled',
    host: 'vscode',
    finishedAt: '2026-10-03T12:00:00.000Z',
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('a timed-out Wiki update carries the bound that passed', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('cursor', output, 900_000)

  // Act
  run.timeOut('kept')

  // Assert
  assert.deepEqual(run.status(), {
    state: 'timed-out',
    host: 'cursor',
    finishedAt: '2026-10-03T12:00:00.000Z',
    timeoutMs: 900_000,
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('a conflict names the blocking paths and what kind of block it is', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.conflict(['notes/mine.md'], 'learner-file', 'kept')

  // Assert
  assert.deepEqual(run.status(), {
    state: 'conflict',
    host: 'vscode',
    finishedAt: '2026-10-03T12:00:00.000Z',
    paths: ['notes/mine.md'],
    cause: 'learner-file',
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('a conflict with no path is not recorded as a conflict', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.conflict([], 'learner-file', 'kept')

  // Assert
  const status = run.status()
  assert.equal(status.state, 'failed')
  assert.equal(
    status.state === 'failed' ? status.reason : undefined,
    'The update was blocked, but no blocking file was named.',
  )
})

test('a late result after a run ended cannot overwrite the newer state', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)
  run.cancel('kept')

  // Act
  run.succeed('a1b2c3d4e5f6+0f9e8d7c')

  // Assert
  assert.equal(run.status().state, 'cancelled')
})

test('an update that finds the Wiki already current records that and starts no run', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.alreadyCurrent(output, 'a1b2c3d4e5f6+0f9e8d7c')

  // Assert
  assert.deepEqual(run.status(), {
    state: 'already-current',
    finishedAt: '2026-10-03T12:00:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  assert.equal(run.isRunning(), false)
})

test('an already-current note never replaces a run that is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.alreadyCurrent(output)

  // Assert
  assert.equal(run.status().state, 'running')
})

test('a staged candidate is noted on the running state so the page can say work is under way', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.markCandidateStaged()

  // Assert
  const status = run.status()
  assert.equal(
    status.state === 'running' ? status.candidateStaged : undefined,
    true,
  )
})

test('a staged-candidate note after the run ended changes nothing', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)
  run.timeOut('kept')

  // Act
  run.markCandidateStaged()

  // Assert
  assert.equal(run.status().state, 'timed-out')
})

test('a start refused for a hand-edited page is shown as a conflict that kept the site, with no run', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.refuseStart('vscode', output, {
    kind: 'conflict',
    paths: ['index.html'],
    cause: 'edited-page',
  })

  // Assert
  assert.deepEqual(run.status(), {
    state: 'conflict',
    host: 'vscode',
    finishedAt: '2026-10-03T12:00:00.000Z',
    paths: ['index.html'],
    cause: 'edited-page',
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  assert.equal(run.isRunning(), false)
})

test('a start refused for another reason is shown as a failure that kept the site', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.refuseStart('cursor', output, {
    kind: 'failed',
    reason: 'Another editor window appears to be updating this Wiki.',
  })

  // Assert
  assert.deepEqual(run.status(), {
    state: 'failed',
    host: 'cursor',
    finishedAt: '2026-10-03T12:00:00.000Z',
    reason: 'Another editor window appears to be updating this Wiki.',
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('a refused start never replaces a run that is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)

  // Act
  run.refuseStart('vscode', output, { kind: 'failed', reason: 'Too late.' })

  // Assert
  assert.equal(run.status().state, 'running')
})

test('the status snapshot cannot change the run when a caller edits it', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000)
  run.conflict(['notes/mine.md'], 'learner-file', 'kept')
  const snapshot = run.status()

  // Act
  if (snapshot.state === 'conflict') snapshot.paths.push('injected.md')

  // Assert
  const status = run.status()
  assert.deepEqual(status.state === 'conflict' ? status.paths : undefined, [
    'notes/mine.md',
  ])
})
