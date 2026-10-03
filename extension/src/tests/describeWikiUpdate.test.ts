import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeWikiUpdate } from '../utils/describeWikiUpdate'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

const place = {
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}
const finishedAt = '2026-10-03T12:10:00.000Z'
const wording = {
  formatTime: (): string => '21:10',
  pathLimit: 3,
  reasonLimitChars: 200,
}

/** Joins what the learner reads as one sentence. */
const sentenceOf = (
  described: ReturnType<typeof describeWikiUpdate>,
): string | undefined => described && described.lead + described.rest

test('an idle Wiki shows no update sentence', () => {
  // Arrange
  const status = { state: 'idle' } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(described, undefined)
})

test('a running VS Code update sends the learner to the chat and names the 15 minute watch', () => {
  // Arrange
  const status = {
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, {
    ...wording,
    formatTime: () => '21:03',
  })

  // Assert
  assert.deepEqual(described, {
    lead: 'Updating LLM Wiki…',
    rest: ' The request went to the VS Code chat at 21:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable.',
    detail: [],
    output: 'Output: .codebook/wiki',
    offerReload: false,
  })
})

test('a running update whose agent has staged a candidate says a new site is being prepared', () => {
  // Arrange
  const running = {
    state: 'running',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: true,
    ...place,
  } as const
  const at2103 = { ...wording, formatTime: (): string => '21:03' }

  // Act
  const inVsCode = describeWikiUpdate({ ...running, host: 'vscode' }, at2103)
  const inCursor = describeWikiUpdate({ ...running, host: 'cursor' }, at2103)

  // Assert
  assert.equal(
    sentenceOf(inVsCode),
    'Updating LLM Wiki… The VS Code chat is preparing a new site (request sent 21:03). Approve the steps it asks for. Codebook watches for the publish for up to 15 minutes. This site stays readable.',
  )
  assert.equal(
    sentenceOf(inCursor),
    'Updating LLM Wiki… Cursor Agent is preparing a new site (started 21:03, up to 15 minutes). Cancel it from the notification in Cursor. This site stays readable.',
  )
})

test('a running Cursor update names the agent, its bound and where to cancel it', () => {
  // Arrange
  const status = {
    state: 'running',
    host: 'cursor',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, {
    ...wording,
    formatTime: () => '21:03',
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'Updating LLM Wiki… Cursor Agent started at 21:03 and may take up to 15 minutes. Cancel it from the notification in Cursor. This site stays readable.',
  )
})

test('a published update names its time, revision and index, and offers a reload only to a page that is older than it', () => {
  // Arrange
  const status = {
    state: 'succeeded',
    host: 'vscode',
    finishedAt,
    identity: 'a1b2c3d4e5f6+0f9e8d7c',
    ...place,
  } as const
  const finishedAtMs = Date.parse(finishedAt)

  // Act
  const onOlderPage = describeWikiUpdate(status, {
    ...wording,
    pageLoadedAtMs: finishedAtMs - 60_000,
  })
  const onReloadedPage = describeWikiUpdate(status, {
    ...wording,
    pageLoadedAtMs: finishedAtMs + 1_000,
  })
  const inEditor = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(onOlderPage),
    'Updated at 21:10 to revision a1b2c3d4e5f6 (index 0f9e8d7c).',
  )
  assert.equal(onOlderPage?.offerReload, true)
  assert.equal(onReloadedPage?.offerReload, false)
  assert.equal(inEditor?.offerReload, false)
})

test('a published update of a project without a Git revision says so instead of showing a placeholder', () => {
  // Arrange
  const status = {
    state: 'succeeded',
    host: 'cursor',
    finishedAt,
    identity: 'no-revision+0f9e8d7c',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Updated at 21:10 (index 0f9e8d7c; no Git revision recorded).',
  )
})

test('an already-current check says when it was made and that no update started', () => {
  // Arrange
  const status = { state: 'already-current', finishedAt, ...place } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Already current (checked 21:10): this Wiki matches the source, so no update started.',
  )
})

test('a failure that left the site alone says the last usable site is kept', () => {
  // Arrange
  const status = {
    state: 'failed',
    host: 'cursor',
    finishedAt,
    reason: 'Cursor Agent stopped with exit code 1 before finishing.',
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update failed at 21:10: Cursor Agent stopped with exit code 1 before finishing. The last usable site is kept.',
  )
})

test('a failure after the site was replaced says so and never claims the old site is kept', () => {
  // Arrange
  const status = {
    state: 'failed',
    host: 'vscode',
    finishedAt,
    reason:
      'The editor agent published a new Wiki, but 2 source files changed while it worked (first: app/lib/actions.ts). Press Update LLM Wiki again.',
    site: 'replaced',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update needs another run (21:10): The editor agent published a new Wiki, but 2 source files changed while it worked (first: app/lib/actions.ts). Press Update LLM Wiki again. This run replaced the site on disk.',
  )
})

test('a failure reason without a full stop still reads as its own sentence', () => {
  // Arrange
  const status = {
    state: 'failed',
    host: 'vscode',
    finishedAt,
    reason: 'Chat is unavailable',
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update failed at 21:10: Chat is unavailable. The last usable site is kept.',
  )
})

test('a long failure reason is cut in the sentence and kept whole for the disclosure', () => {
  // Arrange
  const reason = 'The agent wrote a long explanation. '.repeat(10).trim()
  const status = {
    state: 'failed',
    host: 'cursor',
    finishedAt,
    reason,
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, {
    ...wording,
    reasonLimitChars: 34,
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update failed at 21:10: The agent wrote a long explanation… The last usable site is kept.',
  )
  assert.deepEqual(described?.detail, [reason])
})

test('cancelling a VS Code update says only the watch stopped and the chat may still publish', () => {
  // Arrange
  const status = {
    state: 'cancelled',
    host: 'vscode',
    finishedAt,
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Stopped watching at 21:10. The VS Code chat may still be working and can still publish; stop it in the chat to cancel the update itself. Nothing has been replaced so far.',
  )
})

test('cancelling a Cursor update says the agent was stopped and the site is kept', () => {
  // Arrange
  const status = {
    state: 'cancelled',
    host: 'cursor',
    finishedAt,
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.deepEqual(described, {
    lead: 'Update cancelled',
    rest: ' at 21:10. Cursor Agent was stopped. The last usable site is kept.',
    detail: [],
    output: 'Output: .codebook/wiki',
    offerReload: false,
  })
})

test('a cancel that came after the site was replaced does not claim the old site is kept', () => {
  // Arrange
  const cancelled = {
    state: 'cancelled',
    finishedAt,
    site: 'replaced',
    ...place,
  } as const

  // Act
  const inCursor = describeWikiUpdate({ ...cancelled, host: 'cursor' }, wording)
  const inVsCode = describeWikiUpdate({ ...cancelled, host: 'vscode' }, wording)

  // Assert
  assert.equal(
    sentenceOf(inCursor),
    'Update cancelled at 21:10. Cursor Agent was stopped after it replaced the site on disk; check the freshness label above.',
  )
  assert.equal(
    sentenceOf(inVsCode),
    'Stopped watching at 21:10. A new site was published just before; check the freshness label above.',
  )
})

test('a VS Code watch that ran out names its bound and sends the learner to the chat', () => {
  // Arrange
  const status = {
    state: 'timed-out',
    host: 'vscode',
    finishedAt,
    timeoutMs: 900_000,
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, {
    ...wording,
    formatTime: () => '21:18',
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'No new site appeared within 15 minutes, so Codebook stopped watching at 21:18. Nothing has been replaced. Check the VS Code chat: it may be waiting for you or have reported a problem. Press Update LLM Wiki to start again.',
  )
})

test('a Cursor update that ran past its bound says the agent was stopped and the site is kept', () => {
  // Arrange
  const status = {
    state: 'timed-out',
    host: 'cursor',
    finishedAt,
    timeoutMs: 900_000,
    site: 'kept',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, {
    ...wording,
    formatTime: () => '21:18',
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update timed out: Cursor Agent did not finish within 15 minutes and was stopped at 21:18. The last usable site is kept. Press Update LLM Wiki to try again.',
  )
})

test('a conflict tells the learner to move the file and update again', () => {
  // Arrange
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['notes/mine.md'],
    cause: 'learner-file',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). Nothing was replaced. Move or rename the file, then press Update LLM Wiki again.',
  )
  assert.deepEqual(described?.detail, [])
})

test('a conflict with many files names three, counts the rest and keeps the full list for the disclosure', () => {
  // Arrange
  const paths = ['a.html', 'b.html', 'c.html', 'd.html', 'e.html']
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'cursor',
    finishedAt,
    paths,
    cause: 'learner-file',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update stopped at 21:10: it would overwrite your own files in the Wiki folder (a.html, b.html, c.html and 2 more). Nothing was replaced. Move or rename them, then press Update LLM Wiki again.',
  )
  assert.deepEqual(described?.detail, [
    'a.html',
    'b.html',
    'c.html',
    'd.html',
    'e.html',
  ])
})

test('a hand-edited generated page is named as the reason no update started, with the way out', () => {
  // Arrange
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['index.html'],
    cause: 'edited-page',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): a generated page was edited by hand (index.html), and the publisher will not overwrite it. Move your change aside or restore the page, then press Update LLM Wiki again.',
  )
})

test('a manifest changed after its publish is named as the reason no update started, with the recovery that restores it', () => {
  // Arrange
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['codebook-wiki.json'],
    cause: 'edited-manifest',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): the Wiki’s manifest (codebook-wiki.json) was changed after it was published, and the publisher will not replace it. Keep a copy of your change, ask the editor chat to run the Codebook publisher’s recovery, then press Update LLM Wiki again.',
  )
})

test('an unfinished earlier publish is named as the reason no update started, with the recovery', () => {
  // Arrange
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'cursor',
    finishedAt,
    paths: ['wiki.publish-journal.json'],
    cause: 'unfinished-publish',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): an earlier publish did not finish (wiki.publish-journal.json). Ask the editor chat to run the Codebook publisher’s recovery, then press Update LLM Wiki again.',
  )
})

test('a state from a newer extension is shown as unknown instead of as nothing or as a wrong result', () => {
  // Arrange
  const fromNewerExtension = JSON.parse(
    '{"state":"paused","outputDirectory":"/repo/.codebook/wiki","outputLabel":".codebook/wiki"}',
  )

  // Act
  const described = describeWikiUpdate(fromNewerExtension, wording)

  // Assert
  assert.deepEqual(described, {
    lead: 'Update status unknown',
    rest: '.',
    detail: [],
    output: 'Output: .codebook/wiki',
    offerReload: false,
  })
})
