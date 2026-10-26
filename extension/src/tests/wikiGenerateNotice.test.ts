import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiGenerateNotice } from '../utils/wikiGenerateNotice'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

/** What every ended generation of these tests shares: a VS Code run on the project's default folder, ended at a fixed time. */
const ENDED = {
  runKind: 'generate' as const,
  host: 'vscode' as const,
  finishedAt: '2026-10-26T05:06:36.000Z',
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}

/** The learner's clock of these tests. */
const at = (): string => '14:06'

// Value: protects=D5, every generation ending the editor tells; fails_when=a sentence calls the generation an update, names no next step, or offers a button that cannot help; no_claim=the page, which shows no line for a generation (describeWikiUpdate tests); seam=none
test('each ended generation is told in its own sentence with the next step, and its buttons start that step', () => {
  // Arrange
  const states: WikiUpdateStatus[] = [
    {
      ...ENDED,
      state: 'succeeded',
      identity: '1936e4191372+0f9e8d7c',
      revision: '1936e4191372',
      index: '0f9e8d7c',
    },
    {
      ...ENDED,
      state: 'succeeded',
      identity: '1936e4191372+0f9e8d7c',
      index: '0f9e8d7c',
      changedSourceCount: 3,
    },
    { ...ENDED, state: 'cancelled', site: 'kept' },
    { ...ENDED, host: 'cursor', state: 'cancelled', site: 'kept' },
    { ...ENDED, state: 'cancelled', site: 'replaced' },
    { ...ENDED, state: 'timed-out', timeoutMs: 3_300_000, site: 'kept' },
    {
      ...ENDED,
      host: 'cursor',
      state: 'timed-out',
      timeoutMs: 3_300_000,
      site: 'kept',
    },
    {
      ...ENDED,
      host: 'cursor',
      state: 'timed-out',
      timeoutMs: 3_300_000,
      site: 'replaced',
    },
    {
      ...ENDED,
      state: 'conflict',
      paths: ['a.md', 'b.md', 'c.md', 'd.md'],
      cause: 'learner-file',
      site: 'kept',
    },
    {
      ...ENDED,
      host: 'cursor',
      state: 'failed',
      reason:
        'Cursor Agent stopped with exit code 1 before finishing. Run "/codebook Generate the LLM Wiki for this project" in Cursor chat to see its own message.',
      site: 'kept',
    },
    {
      ...ENDED,
      state: 'failed',
      reason:
        'The LLM Wiki published in .codebook/wiki does not identify this opened project.',
      isCodebookSentence: true,
      site: 'replaced',
    },
  ]

  // Act
  const notices = states.map((status) => wikiGenerateNotice(status, at))

  // Assert
  assert.deepEqual(notices, [
    {
      severity: 'information',
      message: 'LLM Wiki generated in .codebook/wiki.',
      actions: ['Open in Browser'],
    },
    {
      severity: 'information',
      message:
        'LLM Wiki generated in .codebook/wiki. 3 source files changed while it was written.',
      actions: ['Update LLM Wiki', 'Open in Browser'],
    },
    {
      severity: 'information',
      message:
        'Codebook stopped watching the LLM Wiki generation at 14:06. The chat may still publish; Codebook: Open LLM Wiki in Browser opens the Wiki once it does. To stop it, stop the request in the chat.',
      actions: [],
    },
    {
      severity: 'information',
      message:
        'LLM Wiki generation cancelled at 14:06. Cursor Agent was stopped; nothing was published.',
      actions: [],
    },
    {
      severity: 'information',
      message:
        'The LLM Wiki generation was stopped at 14:06, after an LLM Wiki was published in .codebook/wiki.',
      actions: ['Open in Browser'],
    },
    {
      severity: 'error',
      message:
        'Codebook stopped waiting for the LLM Wiki generation after 55 minutes. The chat may still publish; Codebook: Open LLM Wiki in Browser opens the Wiki once it does. To stop it, stop the request in the chat.',
      actions: [],
    },
    {
      severity: 'error',
      message:
        'Codebook stopped waiting for the LLM Wiki generation after 55 minutes. Cursor Agent was stopped; nothing was published.',
      actions: ['Generate LLM Wiki'],
    },
    {
      severity: 'information',
      message:
        'Codebook stopped waiting for the LLM Wiki generation after 55 minutes, after an LLM Wiki was published in .codebook/wiki.',
      actions: ['Open in Browser'],
    },
    {
      severity: 'error',
      message:
        'LLM Wiki generation stopped at 14:06: the Wiki folder holds files the publisher will not overwrite (a.md, b.md, c.md and 1 more). Move them out of .codebook/wiki, then press Generate LLM Wiki again.',
      actions: ['Generate LLM Wiki'],
    },
    {
      severity: 'error',
      message:
        'LLM Wiki generation failed at 14:06: Cursor Agent stopped with exit code 1 before finishing. Run "/codebook Generate the LLM Wiki for this project" in Cursor chat to see its own message.',
      actions: ['Generate LLM Wiki'],
    },
    {
      severity: 'error',
      message:
        'LLM Wiki generation failed at 14:06: The LLM Wiki published in .codebook/wiki does not identify this opened project.',
      actions: [],
    },
  ])
})

// Value: protects=the split between the two run kinds' words; fails_when=an update's end, a running state or "already current" gets a generation's notice; no_claim=the update's notice (wikiUpdateNotice tests); seam=none
test('an update’s end, a running run and an already current Wiki get no generation notice', () => {
  // Act
  const notices = [
    wikiGenerateNotice(
      { ...ENDED, runKind: undefined, state: 'cancelled', site: 'kept' },
      at,
    ),
    wikiGenerateNotice(
      {
        ...ENDED,
        state: 'running',
        startedAt: ENDED.finishedAt,
        timeoutMs: 3_300_000,
        candidateStaged: false,
      },
      at,
    ),
    wikiGenerateNotice({ state: 'idle' }, at),
  ]

  // Assert
  assert.deepEqual(notices, [undefined, undefined, undefined])
})

// Value: protects=a path or an agent's text that carries link syntax; fails_when=the editor renders it as a link; no_claim=the editor's own rendering; seam=none
test('a generation notice takes link syntax in a reason apart', () => {
  // Act
  const notice = wikiGenerateNotice(
    {
      ...ENDED,
      state: 'failed',
      reason: 'See [the log](command:x).',
      site: 'kept',
    },
    at,
  )

  // Assert
  assert.equal(
    notice?.message,
    'LLM Wiki generation failed at 14:06: See [the log] (command:x).',
  )
})
