import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WikiUpdateRun, type WikiUpdateEnd } from '../utils/wikiUpdateRun'

const fixedClock = (): Date => new Date('2026-10-03T12:00:00.000Z')
const output = {
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}

test('a second Wiki update start is refused while the first run is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000, false)

  // Act
  const secondStartWasAccepted = run.begin('cursor', output, 900_000, false)

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
  run.begin('cursor', output, 900_000, false)

  // Act
  run.end({
    state: 'succeeded',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
  })
  const published = run.status()
  const nextStartWasAccepted = run.begin('cursor', output, 900_000, false)

  // Assert
  assert.deepEqual(published, {
    state: 'succeeded',
    host: 'cursor',
    finishedAt: '2026-10-03T12:00:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  assert.equal(nextStartWasAccepted, true)
})

test('a failed Wiki update says whether the site on disk was kept or replaced', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000, false)

  // Act
  run.end({
    state: 'failed',
    reason: 'The published Wiki does not match the source.',
    site: 'replaced',
  })

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
  run.begin('vscode', output, 900_000, false)

  // Act
  run.end({ state: 'cancelled', site: 'kept' })

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
  run.begin('cursor', output, 900_000, false)

  // Act
  run.end({ state: 'timed-out', site: 'kept' })

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
  run.begin('vscode', output, 900_000, false)

  // Act
  run.end({
    state: 'conflict',
    paths: ['notes/mine.md'],
    cause: 'learner-file',
    site: 'kept',
  })

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
  run.begin('vscode', output, 900_000, false)

  // Act
  run.end({ state: 'conflict', paths: [], cause: 'learner-file', site: 'kept' })

  // Assert
  const status = run.status()
  assert.equal(status.state, 'failed')
  assert.equal(
    status.state === 'failed' ? status.reason : undefined,
    'The update was blocked, but no blocking file was named.',
  )
})

test('a start refused for a conflict that names no file is recorded as failed with the sentence a finished update has for it', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.refuseStart('vscode', output, {
    kind: 'conflict',
    paths: [],
    cause: 'edited-page',
  })

  // Assert
  const status = run.status()
  assert.equal(status.state, 'failed')
  assert.equal(
    status.state === 'failed' ? status.reason : undefined,
    'The update was blocked, but no blocking file was named.',
  )
  assert.equal(
    status.state === 'failed' ? status.isCodebookSentence : undefined,
    true,
  )
  assert.equal(status.state === 'failed' ? status.site : undefined, 'kept')
})

test('a late result after a run ended cannot overwrite the newer state', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000, false)
  run.end({ state: 'cancelled', site: 'kept' })

  // Act
  run.end({
    state: 'succeeded',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
  })

  // Assert
  assert.equal(run.status().state, 'cancelled')
})

test('an update that finds the Wiki already current records that and starts no run', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.alreadyCurrent(
    output,
    {
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
    },
    false,
  )

  // Assert
  assert.deepEqual(run.status(), {
    state: 'already-current',
    finishedAt: '2026-10-03T12:00:00.000Z',
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  assert.equal(run.isRunning(), false)
})

test('an already-current check of a project without a Git repository records that added files were not checked', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)

  // Act
  run.alreadyCurrent(
    output,
    { identity: 'no-revision+0f9e8d7c', index: '0f9e8d7c' },
    true,
  )

  // Assert
  assert.deepEqual(run.status(), {
    state: 'already-current',
    finishedAt: '2026-10-03T12:00:00.000Z',
    addedFilesUnchecked: true,
    identity: 'no-revision+0f9e8d7c',
    index: '0f9e8d7c',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
})

test('an already-current note never replaces a run that is active', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000, false)

  // Act
  run.alreadyCurrent(
    output,
    { identity: 'a1b2c3d4e5f6+0f9e8d7c', index: '0f9e8d7c' },
    false,
  )

  // Assert
  assert.equal(run.status().state, 'running')
})

test('a staged candidate is noted on the running state so the page can say work is under way', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000, false)

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
  run.begin('vscode', output, 900_000, false)
  run.end({ state: 'timed-out', site: 'kept' })

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
  run.begin('vscode', output, 900_000, false)

  // Act
  run.refuseStart('vscode', output, { kind: 'failed', reason: 'Too late.' })

  // Assert
  assert.equal(run.status().state, 'running')
})

test('the status snapshot cannot change the run when a caller edits it', () => {
  // Arrange
  const run = new WikiUpdateRun(fixedClock)
  run.begin('vscode', output, 900_000, false)
  run.end({
    state: 'conflict',
    paths: ['notes/mine.md'],
    cause: 'learner-file',
    site: 'kept',
  })
  const snapshot = run.status()

  // Act
  if (snapshot.state === 'conflict') snapshot.paths.push('injected.md')

  // Assert
  const status = run.status()
  assert.deepEqual(status.state === 'conflict' ? status.paths : undefined, [
    'notes/mine.md',
  ])
})

test('each ending the classifier can return is recorded with its own fields through one entry', () => {
  // Arrange
  const endings: WikiUpdateEnd[] = [
    {
      state: 'succeeded',
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
    },
    {
      state: 'failed',
      reason: 'Cursor Agent stopped with exit code 1 before finishing.',
      site: 'replaced',
    },
    { state: 'cancelled', site: 'kept' },
    { state: 'timed-out', site: 'kept' },
    {
      state: 'conflict',
      paths: ['notes/mine.md'],
      cause: 'learner-file',
      site: 'kept',
    },
  ]

  // Act
  const recorded = endings.map((ending) => {
    const run = new WikiUpdateRun(fixedClock)
    run.begin('cursor', output, 900_000, false)
    run.end(ending)
    return run.status()
  })

  // Assert
  const ended = {
    host: 'cursor',
    finishedAt: '2026-10-03T12:00:00.000Z',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }
  assert.deepEqual(recorded, [
    {
      ...ended,
      state: 'succeeded',
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
    },
    {
      ...ended,
      state: 'failed',
      reason: 'Cursor Agent stopped with exit code 1 before finishing.',
      site: 'replaced',
    },
    { ...ended, state: 'cancelled', site: 'kept' },
    // Only a timeout carries the bound the run began with.
    { ...ended, state: 'timed-out', site: 'kept', timeoutMs: 900_000 },
    {
      ...ended,
      state: 'conflict',
      paths: ['notes/mine.md'],
      cause: 'learner-file',
      site: 'kept',
    },
  ])
})

// Value: protects=the page and the notice of a start that was refused because somebody is still updating the Wiki, and of a run that ended while its chat may still publish; fails_when=the recorded state loses the mark, so both say "The last usable site is kept." under which that somebody publishes; why_new=Cycle 0046 row 341; seam=none
test('a start refused because somebody is still updating the Wiki, and a run that ended while its chat may still publish, are recorded as failed with the mark that the site may be replaced after', () => {
  // Arrange
  const refusedWindow = new WikiUpdateRun(fixedClock)
  const endedWindow = new WikiUpdateRun(fixedClock)
  endedWindow.begin('vscode', output, 900_000, false)

  // Act
  refusedWindow.refuseStart('vscode', output, {
    kind: 'failed',
    reason:
      'Another editor window is starting an update of this Wiki. Wait a moment and try again.',
    isCodebookSentence: true,
    mayBeReplacedLater: true,
  })
  endedWindow.end({
    state: 'failed',
    reason: 'The request may still be in the chat.',
    isCodebookSentence: true,
    mayBeReplacedLater: true,
    site: 'kept',
  })

  // Assert
  assert.deepEqual(refusedWindow.status(), {
    state: 'failed',
    host: 'vscode',
    finishedAt: '2026-10-03T12:00:00.000Z',
    reason:
      'Another editor window is starting an update of this Wiki. Wait a moment and try again.',
    isCodebookSentence: true,
    mayBeReplacedLater: true,
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  })
  assert.deepEqual(endedWindow.status(), {
    host: 'vscode',
    finishedAt: '2026-10-03T12:00:00.000Z',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
    state: 'failed',
    reason: 'The request may still be in the chat.',
    isCodebookSentence: true,
    mayBeReplacedLater: true,
    site: 'kept',
  })
})
