import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentExitOf, wikiRunRecord } from '../utils/wikiRunRecord'

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

// Value: protects=each end's summary in Codebook's own words; fails_when=a summary repeats a reason, or an end has no summary; no_claim=the end's classification (classify tests); seam=none
test('each end of a run is summarized in Codebook’s own words, a refused start without a start time and a signal named where the agent had no exit code', () => {
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
  ]

  // Assert
  assert.deepEqual(records, [
    'LLM Wiki generate ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=succeeded summary="published; 2 source files changed while it ran" output=/elsewhere/wiki',
    'LLM Wiki update ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=conflict summary="stopped by files the publisher will not overwrite (learner-file)" output=/elsewhere/wiki',
    'LLM Wiki generate ended: host=vscode started=not started ended=2026-10-26T05:00:00.000Z end=failed summary="failed; the notice names the cause" output=/elsewhere/wiki',
    'LLM Wiki generate ended: host=vscode started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=timed-out summary="stopped at its bound" exit=SIGTERM output=/elsewhere/wiki',
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
    'LLM Wiki update ended: host=cursor started=2026-10-26T04:00:00.000Z ended=2026-10-26T05:00:00.000Z end=cancelled summary="stopped by the learner or the closing window" output=~\\Repo\\.codebook\\wiki',
  )
})
