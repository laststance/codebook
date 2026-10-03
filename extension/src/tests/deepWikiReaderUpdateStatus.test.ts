import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { test } from 'node:test'

import { serveMinimalWiki } from './utils/serveMinimalWiki'

test('the Wiki reader answers the current update state at api/update-status', async () => {
  // Arrange
  const wiki = await serveMinimalWiki(() => ({
    state: 'failed',
    host: 'cursor',
    finishedAt: '2026-10-03T12:10:00.000Z',
    reason: 'Cursor Agent exited with code 1.',
    site: 'kept',
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }))
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      state: 'failed',
      host: 'cursor',
      finishedAt: '2026-10-03T12:10:00.000Z',
      reason: 'Cursor Agent exited with code 1.',
      site: 'kept',
      outputDirectory: '/repo/.codebook/wiki',
      outputLabel: '.codebook/wiki',
    })
  } finally {
    await wiki.close()
  }
})

test('the Wiki reader reports idle when no editor update state is connected', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.deepEqual(await response.json(), { state: 'idle' })
  } finally {
    await wiki.close()
  }
})

test('the Wiki reader refuses to start an update through api/update-status', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    // Act
    const response = await fetch(
      new URL('api/update-status', wiki.reader.url),
      {
        method: 'POST',
      },
    )

    // Assert
    assert.equal(response.status, 405)
  } finally {
    await wiki.close()
  }
})

test('the update state is served while a publish has left the manifest unreadable', async () => {
  // Arrange
  const wiki = await serveMinimalWiki(() => ({
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    outputDirectory: '/repo/.codebook/wiki',
    outputLabel: '.codebook/wiki',
  }))
  await writeFile(wiki.manifestPath, '{ not json')
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.equal(response.status, 200)
    assert.equal((await response.json()).state, 'running')
  } finally {
    await wiki.close()
  }
})
