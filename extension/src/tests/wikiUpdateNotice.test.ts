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
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
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
      ...OUTPUT,
    },
    at2110,
  )

  // Assert
  assert.deepEqual(notice, {
    severity: 'information',
    message:
      'Already current (checked 21:10): this Wiki matches the source, so no update started.',
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
    message:
      'Update cancelled at 21:10. Cursor Agent was stopped. The last usable site is kept.',
  })
})

test('a watch that reached its bound is a warning that sends the learner to the chat', () => {
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
    severity: 'warning',
    message:
      'No new site appeared within 15 minutes, so Codebook stopped watching at 21:10. Nothing has been replaced. Check the VS Code chat: it may be waiting for you or have reported a problem. Press Update LLM Wiki to start again.',
  })
})

test('a learner file in the way is a warning that names the file and the next step', () => {
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
    severity: 'warning',
    message:
      'Update stopped at 21:10: it would overwrite your own file in the Wiki folder (notes/mine.md). Nothing was replaced. Move or rename the file, then press Update LLM Wiki again.',
  })
})

test('a learner file whose name is written as a command link is named as plain text, so the editor draws no link in the warning', () => {
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
    severity: 'warning',
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
    message:
      'Update failed at 21:10: Another editor window or an earlier chat appears to be updating this Wiki (candidate wiki.stage-192c3b82-a251-4581-ad25-3231da4a5fc5, written 21:09). Wait for it to finish, or delete that folder, then press Update LLM Wiki again. The last usable site is kept.',
  })
})
