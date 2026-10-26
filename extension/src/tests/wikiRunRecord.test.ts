import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentExitOf } from '../utils/agentExitOf'
import { wikiRunRecord } from '../utils/wikiRunRecord'

// Value: protects=AC 12 and Eng decision 81, the Output record a learner copies into an issue; fails_when=the record holds the failure's own text (an agent's reply, a chat's error reply, a thrown error), names no exit code, or shows the home folder in full; no_claim=the notice, which shows the sentence; seam=a seeded fake secret in the reason
test('the record of a failed Cursor generation names its kind, host, times, end, a Codebook summary, the exit code and the folder under ~, and none of the failure’s text', () => {
  // Act
  const record = wikiRunRecord(
    {
      state: 'failed',
      runKind: 'generate',
      host: 'cursor',
      finishedAt: '2026-10-26T05:00:00.000Z',
      reason: 'Cursor Agent said: token=SEEDED-SECRET',
      site: 'kept',
      outputDirectory: '/Users/learner/repo/.codebook/wiki',
      outputLabel: '.codebook/wiki',
    },
    {
      runKind: 'generate',
      startedAt: '2026-10-26T04:30:00.000Z',
      agentExit: { exitCode: 1, exitSignal: null },
    },
    '/Users/learner',
  )

  // Assert
  assert.equal(
    record,
    'LLM Wiki generate ended: host=cursor started=2026-10-26T04:30:00.000Z ended=2026-10-26T05:00:00.000Z end=failed summary="failed; the agent’s or the error’s text is not recorded" exit=1 output=~/repo/.codebook/wiki',
  )
})

// Value: protects=each end's summary in Codebook's own words, also an already current Wiki, a publication that failed a check, one verb per host for a stop (Cycle 0056 tasks 7 and 9), the cause id of a block that only the Output record shows (task 10) and an output folder that is the home folder; fails_when=a summary repeats a reason, an end has no summary, a Cursor stop reads stopped or a VS Code stop reads cancelled, the cause id is lost, or the home folder is shown by name; no_claim=the end's classification (classify tests); seam=none
test('each end of a run is summarized in Codebook’s own words: a refused start without a start time, a signal where the agent had no exit code, a Wiki already current, a publication that failed a check, one verb per host for a stop, the cause id of a block, and the home folder as ~', () => {
  // Arrange
  const shared = {
    host: 'vscode' as const,
    finishedAt: '2026-10-26T05:00:00.000Z',
    outputDirectory: '/elsewhere/wiki',
    outputLabel: '/elsewhere/wiki',
  }

  // Act
  const records = [
    wikiRunRecord(
      {
        ...shared,
        state: 'succeeded',
        identity: 'a+b',
        index: 'b',
        changedSourceCount: 2,
      },
      { runKind: 'generate', startedAt: '2026-10-26T04:00:00.000Z' },
      '/Users/learner',
    ),
    wikiRunRecord(
      {
        ...shared,
        state: 'conflict',
        paths: ['x.md'],
        cause: 'learner-file',
        site: 'kept',
      },
      { runKind: 'update', startedAt: '2026-10-26T04:00:00.000Z' },
      '/Users/learner',
    ),
    wikiRunRecord(
      {
        ...shared,
        state: 'failed',
        reason: 'A refusal Codebook wrote.',
        isCodebookSentence: true,
        site: 'kept',
      },
      { runKind: 'generate' },
      '/Users/learner',
    ),
    wikiRunRecord(
      { ...shared, state: 'timed-out', timeoutMs: 3_300_000, site: 'kept' },
      {
        runKind: 'generate',
        startedAt: '2026-10-26T04:00:00.000Z',
        agentExit: { exitCode: null, exitSignal: 'SIGTERM' },
      },
      '/Users/learner',
    ),
    wikiRunRecord(
      {
        state: 'already-current',
        finishedAt: shared.finishedAt,
        outputDirectory: shared.outputDirectory,
        outputLabel: shared.outputLabel,
      },
      { runKind: 'update' },
      '/Users/learner',
    ),
    wikiRunRecord(
      {
        ...shared,
        state: 'failed',
        reason: 'A publication that failed a check.',
        site: 'replaced',
      },
      { runKind: 'update', startedAt: '2026-10-26T04:00:00.000Z' },
      '/Users/learner',
    ),
    wikiRunRecord(
      { ...shared, state: 'cancelled', site: 'kept' },
      { runKind: 'generate', startedAt: '2026-10-26T04:00:00.000Z' },
      '/Users/learner',
    ),
    wikiRunRecord(
      {
        ...shared,
        state: 'failed',
        reason: 'The folder cannot take a new LLM Wiki.',
        isCodebookSentence: true,
        site: 'kept',
        outputDirectory: '/Users/learner',
        outputLabel: '/Users/learner',
      },
      { runKind: 'generate', blockCause: 'edited-page' },
      '/Users/learner',
    ),
  ]

  // Assert
  assert.deepEqual(records, [
    'LLM Wiki generate ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=succeeded summary="published; 2 source files changed while it ran" output=/elsewhere/wiki',
    'LLM Wiki update ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=conflict summary="stopped by files the publisher will not overwrite (learner-file)" output=/elsewhere/wiki',
    'LLM Wiki generate ended: host=vscode started=not started ended=2026-10-26T05:00:00.000Z end=failed summary="failed; the notice names the cause" output=/elsewhere/wiki',
    'LLM Wiki generate ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=timed-out summary="stopped at its bound" exit=SIGTERM output=/elsewhere/wiki',
    'LLM Wiki update ended: host=unknown started=not started ended=2026-10-26T05:00:00.000Z end=already-current summary="nothing to update: the Wiki matches the source" output=/elsewhere/wiki',
    'LLM Wiki update ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=failed summary="a publication appeared but failed a check" output=/elsewhere/wiki',
    'LLM Wiki generate ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=cancelled summary="stopped watching by the learner or the closing window" output=/elsewhere/wiki',
    'LLM Wiki generate ended: host=vscode started=not started ended=2026-10-26T05:00:00.000Z end=failed summary="failed; the notice names the cause" cause=edited-page output=~',
  ])
})

// Value: protects=the exit data of a Cursor agent's failure, read by its fields so a stand-in runner is read as the real one; fails_when=a cancel or a plain error is given an exit, or a failure with an exit code loses it; no_claim=the runner's sentence (runCursorWikiUpdate tests); seam=none
test('only a failure that carries the agent process’s exit code or signal yields an exit', () => {
  // Act
  const exits = [
    agentExitOf(
      Object.assign(new Error('stopped'), { exitCode: 1, exitSignal: null }),
    ),
    agentExitOf(
      Object.assign(new Error('stopped'), {
        exitCode: null,
        exitSignal: 'SIGKILL',
      }),
    ),
    agentExitOf(new Error('The Wiki generation was cancelled.')),
    agentExitOf('a thrown text'),
  ]

  // Assert
  assert.deepEqual(exits, [
    { exitCode: 1, exitSignal: null },
    { exitCode: null, exitSignal: 'SIGKILL' },
    undefined,
    undefined,
  ])
})

// Value: protects=AC 12 on Windows, where a path's drive letter or folder may be written in another case than homedir() names it (local CodeRabbit, pt1); fails_when=the record then keeps the learner's account name in the path, or the record changes the case it was written in; no_claim=a path outside the home folder; seam=the platform and the home folder handed to the record
test('on Windows the record shortens the home folder whatever the case of its drive letter, and keeps the rest as written', () => {
  // Act
  const record = wikiRunRecord(
    {
      state: 'cancelled',
      host: 'cursor',
      finishedAt: '2026-10-26T05:00:00.000Z',
      site: 'kept',
      outputDirectory: 'c:\\Users\\Learner\\Repo\\.codebook\\wiki',
      outputLabel: '.codebook\\wiki',
    },
    { runKind: 'update', startedAt: '2026-10-26T04:00:00.000Z' },
    'C:\\Users\\learner',
    'win32',
  )

  // Assert
  assert.equal(
    record,
    'LLM Wiki update ended: host=cursor started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=cancelled summary="cancelled by the learner or the closing window" output=~\\Repo\\.codebook\\wiki',
  )
})

// Value: protects=Step 11 of the /ship review of Cycle 0055 pt1 (Claude adversarial): a folder name with a line break, which a workspace setting can give; fails_when=the record breaks into lines, so a second line can pass for a record of another end; no_claim=the folder's other characters, which stay as written; seam=none
test('a line break or another control character in the folder is written as an escape, so the record stays one line', () => {
  // Act
  const record = wikiRunRecord(
    {
      state: 'cancelled',
      runKind: 'generate',
      host: 'vscode',
      finishedAt: '2026-10-26T05:00:00.000Z',
      site: 'kept',
      outputDirectory:
        '/srv/wiki\nLLM Wiki generate ended: end=succeeded\u007f',
      outputLabel: 'wiki',
    },
    { runKind: 'generate', startedAt: '2026-10-26T04:30:00.000Z' },
    '/Users/learner',
    'darwin',
  )

  // Assert
  assert.deepEqual(
    {
      lines: record.split('\n').length,
      output: record.slice(record.indexOf(' output=')),
    },
    {
      lines: 1,
      output:
        ' output=/srv/wiki\\u000aLLM Wiki generate ended: end=succeeded\\u007f',
    },
  )
})
