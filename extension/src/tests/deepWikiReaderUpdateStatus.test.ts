import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { serveMinimalWiki } from './utils/serveMinimalWiki'

test('the Wiki reader answers the current update state at api/update-status', async () => {
  // Arrange
  const wiki = await serveMinimalWiki((outputDirectory) => ({
    state: 'failed',
    host: 'cursor',
    finishedAt: '2026-10-03T12:10:00.000Z',
    reason: 'Cursor Agent exited with code 1.',
    site: 'kept',
    outputDirectory,
    outputLabel: '.codebook/wiki',
  }))
  const publishedAt = new Date('2026-10-03T11:50:00.000Z')
  await utimes(wiki.manifestPath, publishedAt, publishedAt)
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
      outputDirectory: wiki.outputDirectory,
      outputLabel: '.codebook/wiki',
      sitePublishedAt: '2026-10-03T11:50:00.000Z',
    })
  } finally {
    await wiki.close()
  }
})

test('the Wiki reader reports idle when no editor update state is connected', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  const publishedAt = new Date('2026-10-03T11:50:00.000Z')
  await utimes(wiki.manifestPath, publishedAt, publishedAt)
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.deepEqual(await response.json(), {
      state: 'idle',
      sitePublishedAt: '2026-10-03T11:50:00.000Z',
    })
  } finally {
    await wiki.close()
  }
})

test('the update state names no publish time while the publisher has taken the manifest away', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  await rm(wiki.manifestPath)
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { state: 'idle' })
  } finally {
    await wiki.close()
  }
})

test('the Wiki reader refuses to start an update through api/update-status and names the method that works', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    // Act
    const response = await fetch(
      new URL('api/update-status', wiki.reader.url),
      { method: 'POST' },
    )

    // Assert
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.deepEqual(await response.json(), {
      error: 'This Wiki route only answers GET.',
    })
  } finally {
    await wiki.close()
  }
})

test('the freshness route refuses a write and names the method that works', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    // Act
    const response = await fetch(new URL('api/freshness', wiki.reader.url), {
      method: 'PUT',
    })

    // Assert
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.deepEqual(await response.json(), {
      error: 'This Wiki route only answers GET.',
    })
  } finally {
    await wiki.close()
  }
})

test('a published page refuses a write and names the method that works', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    // Act
    const response = await fetch(wiki.reader.url, { method: 'DELETE' })

    // Assert
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
    assert.deepEqual(await response.json(), {
      error: 'This Wiki route only answers GET.',
    })
  } finally {
    await wiki.close()
  }
})

test('a HEAD request for the update state stays refused', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    // Act
    const response = await fetch(
      new URL('api/update-status', wiki.reader.url),
      { method: 'HEAD' },
    )

    // Assert
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
  } finally {
    await wiki.close()
  }
})

test('the update state is served while a publish has left the manifest unreadable', async () => {
  // Arrange
  const wiki = await serveMinimalWiki((outputDirectory) => ({
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    outputDirectory,
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

test('a page the last update removed sends the browser to the overview of the same reader', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  try {
    const removedPage = new URL('pages/removed.html', wiki.reader.url)

    // Act
    const redirect = await fetch(removedPage, { redirect: 'manual' })
    const followed = await fetch(removedPage)
    const otherFile = await fetch(new URL('pages/removed.css', wiki.reader.url))

    // Assert
    assert.equal(redirect.status, 302)
    assert.equal(
      redirect.headers.get('location'),
      new URL(wiki.reader.url).pathname,
    )
    assert.equal(followed.status, 200)
    assert.equal(followed.url, wiki.reader.url)
    assert.match(await followed.text(), /Wiki/)
    assert.equal(otherFile.status, 404)
  } finally {
    await wiki.close()
  }
})

test('a reader of one Wiki folder answers idle while the window’s update run is for another folder', async () => {
  // Arrange: the output setting changed after this reader was opened, and the window's run is for the new folder.
  const wiki = await serveMinimalWiki(() => ({
    state: 'running',
    host: 'vscode',
    startedAt: '2026-10-03T12:03:00.000Z',
    timeoutMs: 900_000,
    candidateStaged: false,
    outputDirectory: '/repo/docs/wiki',
    outputLabel: 'docs/wiki',
  }))
  const publishedAt = new Date('2026-10-03T11:50:00.000Z')
  await utimes(wiki.manifestPath, publishedAt, publishedAt)
  try {
    // Act
    const response = await fetch(new URL('api/update-status', wiki.reader.url))

    // Assert
    assert.deepEqual(await response.json(), {
      state: 'idle',
      sitePublishedAt: '2026-10-03T11:50:00.000Z',
    })
  } finally {
    await wiki.close()
  }
})

/** Writes the publisher's receipt for the manifest now on disk as a new file, the way a publish leaves the folder. @returns The publication identity that receipt gives the folder. */
async function writePublicationReceipt(manifestPath: string): Promise<string> {
  const manifestSha256 = createHash('sha256')
    .update(await readFile(manifestPath))
    .digest('hex')
  const receiptPath = join(dirname(manifestPath), 'codebook-publication.json')
  await rm(receiptPath, { force: true })
  await writeFile(receiptPath, JSON.stringify({ manifestSha256 }))
  return `${manifestSha256}@${(await stat(receiptPath)).ino}`
}

test('a served page carries the publication it was read from, and the update state names the one on disk after a later publish', async () => {
  // Arrange
  const wiki = await serveMinimalWiki()
  const publicationAtLoad = await writePublicationReceipt(wiki.manifestPath)
  try {
    // Act: the page is served, then a publish replaces the manifest and its receipt.
    const pageHtml = await (await fetch(wiki.reader.url)).text()
    const manifest = JSON.parse(await readFile(wiki.manifestPath, 'utf8'))
    await writeFile(
      wiki.manifestPath,
      JSON.stringify({
        ...manifest,
        generated: { at: '2026-10-03T12:05:00Z' },
      }),
    )
    const publicationAfterPublish = await writePublicationReceipt(
      wiki.manifestPath,
    )
    const answer = await (
      await fetch(new URL('api/update-status', wiki.reader.url))
    ).json()

    // Assert
    assert.ok(
      pageHtml.includes(
        `codebook-qa.js" data-codebook-publication="${publicationAtLoad}"></script></body>`,
      ),
      `the page does not carry ${publicationAtLoad}: ${pageHtml}`,
    )
    assert.equal(answer.publication, publicationAfterPublish)
    assert.notEqual(publicationAfterPublish, publicationAtLoad)
  } finally {
    await wiki.close()
  }
})
