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
  msPerMinute: 60_000,
  recoveryRequest:
    '/codebook Recover the unfinished LLM Wiki publish for this project',
  outsideOutputApprovalsNote:
    'This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.',
  refusedStepAdvice: 'If you refuse a step of the chat, press Cancel',
  freshnessLabelPlace: 'above',
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

// Value: protects=the learner who started an update from the browser, stays on the page and refuses a step of the chat in the editor; fails_when=the running line says only to approve the steps, so nothing on the page tells them that Codebook goes on watching until Cancel is pressed in the editor's notification; why_new=Cycle 0046 row 223; seam=none
test('the running line of a VS Code update ends with what to do after a refused step, in the advice it is handed and with the watch’s own bound, also once a candidate is staged; Cursor’s line has no such sentence', () => {
  // Arrange: a watch of 10 minutes, so the bound in the sentence is seen to be the run's.
  const running = {
    state: 'running',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 600_000,
    ...place,
  } as const
  const editorWording = {
    ...wording,
    formatTime: (): string => '21:03',
    refusedStepAdvice: 'After a refused step press Cancel',
  }

  // Act
  const requested = describeWikiUpdate(
    { ...running, host: 'vscode', candidateStaged: false },
    editorWording,
  )
  const staged = describeWikiUpdate(
    { ...running, host: 'vscode', candidateStaged: true },
    editorWording,
  )
  const inCursor = describeWikiUpdate(
    { ...running, host: 'cursor', candidateStaged: false },
    editorWording,
  )

  // Assert
  assert.equal(
    sentenceOf(requested),
    'Updating LLM Wiki… The request went to the VS Code chat at 21:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 10 minutes. This site stays readable. After a refused step press Cancel in the editor’s status bar; otherwise Codebook keeps watching for the whole 10 minutes.',
  )
  assert.equal(
    sentenceOf(staged),
    'Updating LLM Wiki… The VS Code chat is preparing a new site (request sent 21:03). Approve the steps it asks for. Codebook watches for the publish for up to 10 minutes. This site stays readable. After a refused step press Cancel in the editor’s status bar; otherwise Codebook keeps watching for the whole 10 minutes.',
  )
  assert.equal(
    sentenceOf(inCursor),
    'Updating LLM Wiki… Cursor Agent started at 21:03 and may take up to 10 minutes. Cancel it from the notification in Cursor. This site stays readable.',
  )
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
    rest: ' The request went to the VS Code chat at 21:03. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. If you refuse a step of the chat, press Cancel in the editor’s status bar; otherwise Codebook keeps watching for the whole 15 minutes.',
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
    'Updating LLM Wiki… The VS Code chat is preparing a new site (request sent 21:03). Approve the steps it asks for. Codebook watches for the publish for up to 15 minutes. This site stays readable. If you refuse a step of the chat, press Cancel in the editor’s status bar; otherwise Codebook keeps watching for the whole 15 minutes.',
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
    revision: 'a1b2c3d4e5f6',
    index: '0f9e8d7c',
    ...place,
  } as const

  // Act
  const onOlderPage = describeWikiUpdate(status, {
    ...wording,
    isPageOlderThanSite: true,
  })
  const onReloadedPage = describeWikiUpdate(status, {
    ...wording,
    isPageOlderThanSite: false,
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
    index: '0f9e8d7c',
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Updated at 21:10 (index 0f9e8d7c; no Git revision recorded, so added files are not checked).',
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

// Value: protects=the learner of a project without Git who added a source file and pressed Update; fails_when=the refusal says "this Wiki matches the source" although added files were never looked for, and names no way to get the new file into the Wiki; why_new=Cycle 0045 local review wiki-1 #4; seam=none
test('an already-current check in a folder without a Git repository says that added files are not checked and what to do for a new file', () => {
  // Arrange
  const status = {
    state: 'already-current',
    finishedAt,
    addedFilesUnchecked: true,
    ...place,
  } as const

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Already current (checked 21:10): every indexed source matches, so no update started. Added files are not checked because this folder has no Git repository; ask the editor chat to update the Wiki for a new file.',
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
    // The limit falls inside "explanation"; the cut is made at the space before that word.
    reasonLimitChars: 30,
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update failed at 21:10: The agent wrote a long… The last usable site is kept.',
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

// Value: protects=a learner who reads the end of a VS Code watch in a notice the editor keeps on screen while the chat goes on; fails_when=the sentence says in the present that nothing has been replaced, which a later publish of the chat makes untrue, or leaves out the chat that still works and can still publish, or tells the learner to press Update LLM Wiki to start again although Codebook refuses that press while it waits for the chat; why_new=Cycle 0046 row 330 (native run in VS Code 1.140.0: the chat published two minutes after the watch's bound); seam=none
test('a VS Code watch that ran out says what held when it stopped in words a later publish leaves true, and names a step for a chat that waits, one that still works and one that stopped', () => {
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
    'No new site appeared within 15 minutes, so Codebook stopped watching at 21:18. Nothing had been replaced by then. Check the VS Code chat: answer it if it waits for you; let it finish if it is still working (it can still publish, and the Wiki page says when it has). If it stopped or reported a problem, press Update LLM Wiki, then Update anyway in the editor’s notification if Codebook still waits for that chat.',
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

// Value: protects=a learner whose VS Code chat staged a site that would overwrite a file of theirs: Codebook stopped watching, the chat was not stopped; fails_when=the sentence tells them only to move the file and press again, so they start a second chat beside the first, or says in the past of the whole update that nothing was replaced although that chat can still publish; why_new=Cycle 0046 row 343; seam=none
test('a conflict over a learner’s file in VS Code tells the learner to move the file, names the chat that was not stopped and what to do with it, and what the press answers while Codebook waits for that chat', () => {
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
    'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). Nothing was replaced. Move or rename the file. The VS Code chat was not stopped: answer it and it can publish, or stop it and press Update LLM Wiki, then Update anyway if Codebook still waits for it.',
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
    'Update not started (21:10): the Wiki’s manifest (codebook-wiki.json) was changed after it was published, and the publisher will not replace it. Keep a copy of your change, ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
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
    'Update not started (21:10): an earlier publish did not finish (wiki.publish-journal.json). Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  )
})

// Value: protects=the learner who reads on the Wiki page or in the editor's notice why an update did not start while a publish holds the Wiki's publish lock; fails_when=the sentence says that an earlier publish did not finish and sends the learner to the recovery although that publish may still run, which the recovery then refuses, or leaves out the recovery a stopped one needs; why_new=Cycle 0047 row 253 (P3OCR2a1-2 = P3CLA-8): the lock had the sentence of an unfinished publish; seam=none
test('a publish lock that blocks the start is named with the wait for a publish that still runs and the recovery of one that was stopped', () => {
  // Arrange
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['wiki.publish-lock.json'],
    cause: 'held-publish-lock',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): a publish of this Wiki holds its publish lock (wiki.publish-lock.json). It may still be running: press Update LLM Wiki again once it ends. If it was stopped, ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project" once its process exits, then press Update LLM Wiki again.',
  )
})

// Value: protects=one recovery request in the page's sentences, the editor's notice and the failure reasons, which all take it from one constant; fails_when=the embedded sentence writer keeps its own copy of the request, so a change of the constant makes page and failure reason name different requests; why_new=Cycle 0045 local review wiki-1 #12; seam=none
test('the recovery request a refused start names is the one its caller hands over', () => {
  // Arrange
  const status: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['wiki.publish-journal.json'],
    cause: 'unfinished-publish',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(status, {
    ...wording,
    recoveryRequest: '/codebook Finish the stopped LLM Wiki publish',
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): an earlier publish did not finish (wiki.publish-journal.json). Ask the editor chat "/codebook Finish the stopped LLM Wiki publish", then press Update LLM Wiki again.',
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

// Value: protects=the status line of a page that is older than its extension; fails_when=a state this version does not know, which need not carry an output or a time, is worded as "Output: undefined" or has its missing time formatted; why_new=Cycle 0045 local review wiki-1 #11; seam=none
test('a state from a newer extension that names no output and no time is shown as unknown with an empty output line, and no time is formatted', () => {
  // Arrange
  const fromNewerExtension = JSON.parse('{"state":"paused"}')
  const formattedTimes: unknown[] = []

  // Act
  const described = describeWikiUpdate(fromNewerExtension, {
    ...wording,
    formatTime: (isoTimestamp: string): string => {
      formattedTimes.push(isoTimestamp)
      return '21:10'
    },
  })

  // Assert
  assert.deepEqual(described, {
    lead: 'Update status unknown',
    rest: '.',
    detail: [],
    output: '',
    offerReload: false,
  })
  assert.deepEqual(formattedTimes, [])
})

test('the bound a running update names is counted in the minute length its caller gives', () => {
  // Arrange
  const running: WikiUpdateStatus = {
    state: 'running',
    host: 'cursor',
    startedAt: '2026-10-03T12:00:00.000Z',
    timeoutMs: 3_000,
    candidateStaged: false,
    ...place,
  }

  // Act
  const described = describeWikiUpdate(running, {
    ...wording,
    msPerMinute: 1_000,
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    'Updating LLM Wiki… Cursor Agent started at 21:10 and may take up to 3 minutes. Cancel it from the notification in Cursor. This site stays readable.',
  )
})

test('a published update whose state carries no revision says no Git revision was recorded, whatever its display identity reads', () => {
  // Arrange
  const published: WikiUpdateStatus = {
    state: 'succeeded',
    host: 'vscode',
    finishedAt,
    identity: 'main+0f9e8d7c',
    index: '0f9e8d7c',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(published, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Updated at 21:10 (index 0f9e8d7c; no Git revision recorded, so added files are not checked).',
  )
})

test('a watch that ran out, a Cursor run past its bound and a file conflict that came after the site was replaced say so and never claim it was kept', () => {
  // Arrange
  const replaced = { finishedAt, site: 'replaced', ...place } as const

  // Act
  const watchThatRanOut = describeWikiUpdate(
    { state: 'timed-out', host: 'vscode', timeoutMs: 900_000, ...replaced },
    wording,
  )
  const cursorPastItsBound = describeWikiUpdate(
    { state: 'timed-out', host: 'cursor', timeoutMs: 900_000, ...replaced },
    wording,
  )
  const fileConflict = describeWikiUpdate(
    {
      state: 'conflict',
      host: 'cursor',
      paths: ['notes/mine.md'],
      cause: 'learner-file',
      ...replaced,
    },
    wording,
  )

  // Assert
  assert.equal(
    sentenceOf(watchThatRanOut),
    'No new site appeared within 15 minutes, so Codebook stopped watching at 21:10. The site on disk changed during the watch; check the freshness label above.',
  )
  assert.equal(
    sentenceOf(cursorPastItsBound),
    'Update timed out: Cursor Agent did not finish within 15 minutes and was stopped at 21:10 after it replaced the site on disk; check the freshness label above.',
  )
  assert.equal(
    sentenceOf(fileConflict),
    'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). The site on disk changed during the run; check the freshness label above. Move or rename the file, then press Update LLM Wiki again.',
  )
})

test('a missing generated page names how to get past it', () => {
  // Arrange
  const refused: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['index.html'],
    cause: 'missing-page',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(refused, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): a generated page is missing (index.html). Restore it from Git or the editor’s local history; if you cannot, move the Wiki folder aside and ask the editor chat "/codebook Generate the LLM Wiki for this project".',
  )
})

test('a link or special file in the Wiki folder is named with the step that lets the publisher go on', () => {
  // Arrange
  const refused: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['assets/shared.css'],
    cause: 'special-file',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(refused, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): the Wiki folder holds a link or special file (assets/shared.css), which the publisher refuses. Move it out of the Wiki folder, then press Update LLM Wiki again.',
  )
})

// Value: protects=the learner whose Wiki folder is itself a link or a file (a repository that carries `.codebook/wiki` as a link); fails_when=the refusal has no sentence, so the page shows "Update stopped: it would overwrite your own file in the Wiki folder (wiki)", or it reuses the sentence of a link inside the folder and tells the learner to move the Wiki folder out of the Wiki folder (row 185), or it reads otherwise than its sibling refusals of a link on the Wiki's path; why_new=Cycle 0046 row 185: a cause of its own; /ship repeat review D1b: the three refusals of the same kind read alike; repeat design review PD5: the sentence names a folder that leads out of the project and gives both ways on, as its siblings do; seam=none
test('a Wiki folder that is itself a link or a file, or leads out of the project, is named as the reason no update started, with the two ways to give the publisher a folder of its own', () => {
  // Arrange
  const refused: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['wiki'],
    cause: 'not-a-folder',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(refused, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): the Wiki folder itself (wiki) is a link or a file, or leads out of the project, and the publisher refuses anything there but a folder of its own. Replace it with a real folder (if it is a link to your Wiki’s folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then press Update LLM Wiki again.',
  )
})

// Value: protects=the learner whose repository carries a folder on the Wiki folder's path, `.codebook` for the default output, as a link; fails_when=the refusal has no sentence of its own, so the page shows "Update stopped: it would overwrite your own file in the Wiki folder (.codebook)", or it reuses the sentence of the Wiki folder itself and names the wrong folder, or it lacks the advice for a link to the learner's own Wiki folder; why_new=Cycle 0046 /ship finding F1: the start check refuses a link on the path with a cause of its own; repeat review D1: the sentence gained that advice and plainer words; repeat design review PD6: the advice names a folder of the learner's, which the link above the Wiki folder leads to; seam=none
test('a link on the Wiki folder’s path in the project is named as the reason no update started, with the two ways to give the publisher a folder of its own', () => {
  // Arrange
  const refused: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['.codebook'],
    cause: 'linked-parent',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(refused, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): the Wiki folder’s path in the project passes through a link or a file (.codebook), and the publisher writes only into the project’s own folders, so nothing was written. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then press Update LLM Wiki again.',
  )
})

test('a manifest Codebook cannot read is named as the reason no update started, with the chat request that recovers it', () => {
  // Arrange
  const refused: WikiUpdateStatus = {
    state: 'conflict',
    host: 'vscode',
    finishedAt,
    paths: ['codebook-wiki.json'],
    cause: 'unreadable-manifest',
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(refused, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update not started (21:10): Codebook cannot read the Wiki’s manifest (codebook-wiki.json). Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  )
})

test('a refusal Codebook wrote itself is shown whole with its next step, however long it is', () => {
  // Arrange
  const reason =
    'An earlier chat or another editor window appears to be updating this Wiki (candidate wiki.stage-3f6c2b1e-7a4d-4c0f-9b51-2d6e8f0a1c37, written 21:05 GMT+9). Codebook waits for it until 21:20 GMT+9. If that chat was stopped, choose Update anyway in the editor’s notification.'
  const refused: WikiUpdateStatus = {
    state: 'failed',
    host: 'vscode',
    finishedAt,
    reason,
    isCodebookSentence: true,
    // The start check marks a refusal that names somebody who is still updating.
    mayBeReplacedLater: true,
    site: 'kept',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(refused, {
    ...wording,
    reasonLimitChars: 160,
  })

  // Assert
  assert.equal(
    sentenceOf(described),
    `Update failed at 21:10: ${reason} Nothing had been replaced by then.`,
  )
  assert.deepEqual(described?.detail, [])
})

test('a Wiki that is gone after an interrupted publish is not said to be kept or replaced', () => {
  // Arrange
  const missing: WikiUpdateStatus = {
    state: 'failed',
    host: 'vscode',
    finishedAt,
    reason:
      'The Wiki is missing after a publish that did not finish. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
    isCodebookSentence: true,
    site: 'missing',
    ...place,
  }

  // Act
  const described = describeWikiUpdate(missing, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Update failed at 21:10: The Wiki is missing after a publish that did not finish. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  )
})

test('the running line of a VS Code update whose output lies outside the project says the chat will ask to approve each step there', () => {
  // Arrange
  const running: WikiUpdateStatus = {
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:00:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    isOutputOutsideProject: true,
    outputDirectory: '/srv/wiki',
    outputLabel: '/srv/wiki',
  }

  // Act
  const described = describeWikiUpdate(running, wording)

  // Assert
  assert.equal(
    sentenceOf(described),
    'Updating LLM Wiki… The request went to the VS Code chat at 21:10. Follow it there and approve the steps it asks for. Codebook watches for the new site for up to 15 minutes. This site stays readable. This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none. If you refuse a step of the chat, press Cancel in the editor’s status bar; otherwise Codebook keeps watching for the whole 15 minutes.',
  )
})

// Value: protects=a learner who reads a failed end or a refused start in a notice the editor keeps on screen while a chat or another window can still publish; fails_when=such an end says "The last usable site is kept.", which the later publish makes untrue, or an end after which nobody can publish loses that sentence, or the mark changes what is said of a replaced or a missing site; why_new=Cycle 0046 row 341 (met natively with row 335: the refusal said the site is kept two minutes before the chat replaced it); Cycle 0047 row 84 (TEST-9): the end after which nobody can publish is the sentence the product prints for a request the chat never held; seam=none
test('a failed end after which somebody can still publish says that nothing had been replaced by then, every other failed end with a kept site says that the last usable site is kept, and a replaced or a missing site is worded as before', () => {
  // Arrange
  const failed = {
    state: 'failed',
    host: 'vscode',
    finishedAt,
    isCodebookSentence: true,
    ...place,
  } as const
  const stillInTheChat =
    'Codebook saw no sign of the update in the editor chat within 30 seconds and left its request in the chat without running any chat command on it, so the request may still be there. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.'
  const neverHeld =
    'Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry.'

  // Act
  const sentences = [
    describeWikiUpdate(
      {
        ...failed,
        reason: stillInTheChat,
        mayBeReplacedLater: true,
        site: 'kept',
      },
      wording,
    ),
    describeWikiUpdate({ ...failed, reason: neverHeld, site: 'kept' }, wording),
    describeWikiUpdate(
      {
        ...failed,
        reason: stillInTheChat,
        mayBeReplacedLater: true,
        site: 'replaced',
      },
      wording,
    ),
    describeWikiUpdate(
      {
        ...failed,
        reason: stillInTheChat,
        mayBeReplacedLater: true,
        site: 'missing',
      },
      wording,
    ),
  ].map(sentenceOf)

  // Assert
  assert.deepEqual(sentences, [
    'Update failed at 21:10: Codebook saw no sign of the update in the editor chat within 30 seconds and left its request in the chat without running any chat command on it, so the request may still be there. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat. Nothing had been replaced by then.',
    'Update failed at 21:10: Codebook saw no sign of the update in the editor chat within 30 seconds and the chat holds no request of it, so no update is running. Check that Copilot Chat is enabled and signed in, then retry. The last usable site is kept.',
    'Update needs another run (21:10): Codebook saw no sign of the update in the editor chat within 30 seconds and left its request in the chat without running any chat command on it, so the request may still be there. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat. This run replaced the site on disk.',
    'Update failed at 21:10: Codebook saw no sign of the update in the editor chat within 30 seconds and left its request in the chat without running any chat command on it, so the request may still be there. Stop or remove it in the Chat view, check that Copilot Chat is enabled and signed in, then retry, with Update anyway if Codebook still waits for that chat.',
  ])
})

// Value: protects=the two hosts' sentences for a learner's file in the way: Cursor's agent is a process that has ended, VS Code's chat goes on; fails_when=Cursor's sentence names a chat that is not there, or VS Code's sentence for several files or for a site that changed during the run loses the chat and the press that Codebook answers with the wait; why_new=Cycle 0046 row 343; seam=none
test('a conflict over learner files in Cursor keeps its sentence, and in VS Code names the chat for one file, for several and for a site that changed during the run', () => {
  // Arrange
  const conflict = {
    state: 'conflict',
    finishedAt,
    cause: 'learner-file',
    ...place,
  } as const

  // Act
  const sentences = [
    describeWikiUpdate(
      { ...conflict, host: 'cursor', paths: ['notes/mine.md'], site: 'kept' },
      wording,
    ),
    describeWikiUpdate(
      {
        ...conflict,
        host: 'vscode',
        paths: ['a.html', 'b.html'],
        site: 'kept',
      },
      wording,
    ),
    describeWikiUpdate(
      {
        ...conflict,
        host: 'vscode',
        paths: ['notes/mine.md'],
        site: 'replaced',
      },
      wording,
    ),
  ].map(sentenceOf)

  // Assert
  assert.deepEqual(sentences, [
    'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). Nothing was replaced. Move or rename the file, then press Update LLM Wiki again.',
    'Update stopped at 21:10: it would overwrite your own files in the Wiki folder (a.html, b.html). Nothing was replaced. Move or rename them. The VS Code chat was not stopped: answer it and it can publish, or stop it and press Update LLM Wiki, then Update anyway if Codebook still waits for it.',
    'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). The site on disk changed during the run; check the freshness label above. Move or rename the file. The VS Code chat was not stopped: answer it and it can publish, or stop it and press Update LLM Wiki, then Update anyway if Codebook still waits for it.',
  ])
})
