import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { openWikiOpeningWindow } from './utils/wikiOpeningWindow'

test('a source changed outside the editor reaches the open Wiki, which watches the project’s files until it is closed', async () => {
  // Arrange
  const window = await openWikiOpeningWindow()
  try {
    await window.open()
    const changedOutside = join(window.projectRoot, 'src/a.ts')
    const created = join(window.projectRoot, 'src/new.ts')
    const deleted = join(window.projectRoot, 'src/old.ts')

    // Act: Git or an agent's CLI writes the files; the editor's watcher reports them, no save happens.
    window.files.report('change', changedOutside)
    window.files.report('create', created)
    window.files.report('delete', deleted)

    // Assert
    assert.deepEqual(
      window.files.watched.map((pattern) => [pattern.base, pattern.pattern]),
      [[window.projectRoot, '**']],
    )
    assert.deepEqual(window.readers[0]?.notedSourceChanges, [
      changedOutside,
      created,
      deleted,
    ])
  } finally {
    await window.close()
  }
  assert.equal(window.files.liveWatcherCount(), 0)
})

test('the open Wiki is told the address the editor forwards it to, and the browser is sent to the reader’s own address', async () => {
  // Arrange: a remote window forwards the reader's port 4100 to port 54321 of the learner's machine.
  const window = await openWikiOpeningWindow({
    forwardTo: (url) => url.replace('127.0.0.1:4100', 'localhost:54321'),
  })
  try {
    // Act
    await window.open()

    // Assert
    assert.deepEqual(window.readers[0]?.acceptedOrigins, [
      'http://localhost:54321/w/reader-token/index.html',
    ])
    assert.deepEqual(window.openedUrls, [
      'http://127.0.0.1:4100/w/reader-token/index.html',
    ])
  } finally {
    await window.close()
  }
})

test('two Open DeepWiki commands issued together start one reader and open one browser tab', async () => {
  // Arrange
  const window = await openWikiOpeningWindow()
  try {
    const readerStart = window.hold('reader-start')

    // Act: the second command arrives while the first one's reader is still starting.
    const first = window.open()
    await readerStart.started
    const second = window.open()
    readerStart.release()
    await Promise.all([first, second])

    // Assert
    assert.equal(window.readers.length, 1)
    assert.deepEqual(window.openedUrls, [
      'http://127.0.0.1:4100/w/reader-token/index.html',
    ])
    assert.equal(window.readers[0]?.isClosed, false)
  } finally {
    await window.close()
  }
})

test('a question whose tab was closed during the model choice is not sent to the chosen model', async () => {
  // Arrange: the editor has two models and none is automatic, so the learner is asked to choose.
  const window = await openWikiOpeningWindow({
    models: [
      { id: 'gpt', name: 'GPT', vendor: 'copilot' },
      { id: 'claude', name: 'Claude', vendor: 'copilot' },
    ],
  })
  try {
    await window.open()
    const modelChoice = window.hold('model-choice')
    const browserTab = new AbortController()

    // Act: the tab is closed while the choice is open; the learner then chooses.
    const asking = window.readers[0]?.ask('Where is it?', browserTab.signal)
    await modelChoice.started
    browserTab.abort()
    modelChoice.release()

    // Assert
    await assert.rejects(asking ?? Promise.resolve(), { name: 'AbortError' })
    assert.deepEqual(window.modelQuestions, [])
  } finally {
    await window.close()
  }
})

test('a question whose tab was closed while the editor listed its models leaves no draft in the editor chat', async () => {
  // Arrange: the editor exposes no model, so a question would be handed to the editor chat as a draft.
  const window = await openWikiOpeningWindow()
  try {
    await window.open()
    const modelList = window.hold('model-list')
    const browserTab = new AbortController()

    // Act
    const asking = window.readers[0]?.ask('Where is it?', browserTab.signal)
    await modelList.started
    browserTab.abort()
    modelList.release()

    // Assert
    await assert.rejects(asking ?? Promise.resolve(), { name: 'AbortError' })
    assert.deepEqual(window.chatDrafts, [])
  } finally {
    await window.close()
  }
})

test('a question whose tab stays open is sent to the editor’s model', async () => {
  // Arrange
  const window = await openWikiOpeningWindow({
    models: [{ id: 'copilot-auto', name: 'Auto', vendor: 'copilot' }],
  })
  try {
    await window.open()

    // Act
    const answer = await window.readers[0]?.ask(
      'Where is it?',
      new AbortController().signal,
    )

    // Assert
    assert.deepEqual(answer, {
      answer: 'Answered.',
      citations: [],
      sourceChanged: false,
    })
    assert.deepEqual(window.modelQuestions, ['Where is it?'])
  } finally {
    await window.close()
  }
})
