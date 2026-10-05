import assert from 'node:assert/strict'
import { test } from 'node:test'

import { wikiUpdateNotice } from '../utils/wikiUpdateNotice'

const OUTPUT = {
  outputDirectory: '/repo/.codebook/wiki',
  outputLabel: '.codebook/wiki',
}
const at2110 = (): string => '21:10'

test('a finished update is an information notice with the page’s sentence and the reload hint, without the output line', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'succeeded',
      host: 'vscode',
      finishedAt: '2026-10-03T12:10:00.000Z',
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    actions: [],
    message:
      'Updated at 21:10 to revision a1b2c3d4e5f6 (index 0f9e8d7c). Reload the browser reader to read the new pages.',
  })
})

test('a Wiki that already matched is an information notice', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'already-current',
      finishedAt: '2026-10-03T12:10:00.000Z',
      identity: 'a1b2c3d4e5f6+0f9e8d7c',
      revision: 'a1b2c3d4e5f6',
      index: '0f9e8d7c',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    actions: [],
    message:
      'Already current (checked 21:10): this Wiki matches the source, so no update started.',
  })
})

// Value: protects=the recovery step in the editor's notice, which takes the request from the constant the failure reasons use; fails_when=the notice hands no request to the sentence writer, so the learner is asked to paste "undefined"; why_new=Cycle 0045 local review wiki-1 #12; seam=none
test('a start refused for an unfinished publish is an error notice that names the recovery request', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'conflict',
      host: 'vscode',
      finishedAt: '2026-10-03T12:10:00.000Z',
      paths: ['wiki.publish-journal.json'],
      cause: 'unfinished-publish',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'Update not started (21:10): an earlier publish did not finish (wiki.publish-journal.json). Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
  })
})

test('a cancelled Cursor update is an information notice, not an error', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'cancelled',
      host: 'cursor',
      finishedAt: '2026-10-03T12:10:00.000Z',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    actions: [],
    message:
      'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept.',
  })
})

test('a watch that reached its bound is an error notice with Open LLM Wiki that sends the learner to the chat', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'timed-out',
      host: 'vscode',
      finishedAt: '2026-10-03T12:10:00.000Z',
      timeoutMs: 900_000,
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'No new site appeared within 15 minutes, so Codebook stopped watching at 21:10. Nothing has been replaced. Check the VS Code chat: it may be waiting for you or have reported a problem. Press Update LLM Wiki to start again.',
  })
})

test('a learner file in the way is an error notice with Open LLM Wiki that names the file and the next step', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'conflict',
      host: 'vscode',
      finishedAt: '2026-10-03T12:10:00.000Z',
      paths: ['notes/mine.md'],
      cause: 'learner-file',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). Nothing was replaced. Move or rename the file, then press Update LLM Wiki again.',
  })
})

test('a learner file whose name is written as a command link is named as plain text, so the editor draws no link in the error notice', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'conflict',
      host: 'vscode',
      finishedAt: '2026-10-03T12:10:00.000Z',
      paths: ['[Fix it](command:workbench.action.terminal.new)'],
      cause: 'learner-file',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'Update stopped at 21:10: it would overwrite your own file in the Wiki folder ([Fix it] (command:workbench.action.terminal.new)). Nothing was replaced. Move or rename the file, then press Update LLM Wiki again.',
  })
})

test('an agent failure text that carries a command link is an error notice without link syntax', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-10-03T12:10:00.000Z',
      reason: 'See [the log](command:workbench.action.openSettings) now.',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'Update failed at 21:10: See [the log] (command:workbench.action.openSettings) now. The last usable site is kept.',
  })
})

test('a failed update is an error notice that says whether the site was kept', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-10-03T12:10:00.000Z',
      reason: 'Cursor Agent stopped with exit code 1 before finishing.',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'Update failed at 21:10: Cursor Agent stopped with exit code 1 before finishing. The last usable site is kept.',
  })
})

test('a run that is still going and a window with no run have no notice', () => {
  // Act
  const idle = wikiUpdateNotice({ state: 'idle' }, at2110)
  const running = wikiUpdateNotice(
    {
      state: 'running',
      host: 'vscode',
      startedAt: '2026-10-03T12:03:00.000Z',
      timeoutMs: 900_000,
      candidateStaged: false,
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.equal(idle, undefined)
  assert.equal(running, undefined)
})

test('a failure reason longer than the page shows is not cut off in the notification, so its next step stays readable', () => {
  // Act
  const notice = wikiUpdateNotice(
    {
      state: 'failed',
      host: 'vscode',
      finishedAt: '2026-10-03T12:10:00.000Z',
      reason:
        'Another editor window or an earlier chat appears to be updating this Wiki (candidate wiki.stage-192c3b82-a251-4581-ad25-3231da4a5fc5, written 21:09). Wait for it to finish, or delete that folder, then press Update LLM Wiki again.',
      site: 'kept',
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'error',
    actions: ['Open LLM Wiki'],
    message:
      'Update failed at 21:10: Another editor window or an earlier chat appears to be updating this Wiki (candidate wiki.stage-192c3b82-a251-4581-ad25-3231da4a5fc5, written 21:09). Wait for it to finish, or delete that folder, then press Update LLM Wiki again. The last usable site is kept.',
  })
})

test('the notification of an update that replaced the site points to the freshness label in the browser reader, not to a label above', () => {
  // Arrange
  const replaced = {
    finishedAt: '2026-10-03T12:10:00.000Z',
    site: 'replaced',
    ...OUTPUT,
  } as const

  // Act
  const messages = [
    wikiUpdateNotice(
      { state: 'cancelled', host: 'cursor', ...replaced },
      at2110,
    ),
    wikiUpdateNotice(
      { state: 'cancelled', host: 'vscode', ...replaced },
      at2110,
    ),
    wikiUpdateNotice(
      { state: 'timed-out', host: 'cursor', timeoutMs: 900_000, ...replaced },
      at2110,
    ),
    wikiUpdateNotice(
      { state: 'timed-out', host: 'vscode', timeoutMs: 900_000, ...replaced },
      at2110,
    ),
    wikiUpdateNotice(
      {
        state: 'conflict',
        host: 'vscode',
        paths: ['notes/mine.md'],
        cause: 'learner-file',
        ...replaced,
      },
      at2110,
    ),
  ].map((notice) => notice?.message)

  // Assert
  assert.deepEqual(messages, [
    'Update cancelled at 21:10. Cursor Agent was stopped after it replaced the site on disk; check the freshness label in the browser reader.',
    'Stopped watching at 21:10. A new site was published just before; check the freshness label in the browser reader.',
    'Update timed out: Cursor Agent did not finish within 15 minutes and was stopped at 21:10 after it replaced the site on disk; check the freshness label in the browser reader.',
    'No new site appeared within 15 minutes, so Codebook stopped watching at 21:10. The site on disk changed during the watch; check the freshness label in the browser reader.',
    'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). The site on disk changed during the run; check the freshness label in the browser reader. Move or rename the file, then press Update LLM Wiki again.',
  ])
})
