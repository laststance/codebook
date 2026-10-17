import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

import type * as DeepWikiReaderModule from '../deepWikiReader'
import type { WikiIncludedSource } from '../utils/answerDeepWikiQuestion'
import type { WikiFreshness } from '../utils/inspectDeepWikiFreshness'
import type * as ReadWikiPublicationIdentityModule from '../utils/readWikiPublicationIdentity'
import { readWikiPublishedAt } from '../utils/readWikiPublishedAt'
import { readWikiRegularFile } from '../utils/readWikiRegularFile'

import { loadModule } from './utils/loadModule'
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
      sourceChangeStamp: 0,
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
      sourceChangeStamp: 0,
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
    assert.deepEqual(await response.json(), {
      state: 'idle',
      sourceChangeStamp: 0,
    })
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

test('a page the last update removed sends the browser to the overview and names the missing page', async () => {
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
      `${new URL(wiki.reader.url).pathname}?missing=pages%2Fremoved.html`,
    )
    assert.equal(followed.status, 200)
    assert.equal(
      followed.url,
      `${wiki.reader.url}?missing=pages%2Fremoved.html`,
    )
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
      sourceChangeStamp: 0,
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

/**
 * Serves a one-page Wiki through a reader whose freshness inspection the test keeps open and counts.
 *
 * @returns The served Wiki; `inspections` (how many inspections began, each answering the indexed paths of the manifest it was given as `changedPaths`), `generationReads` (how many freshness requests have named their generation), `finishInspections` (lets every inspection end) and `settle` (one turn of the event loop).
 */
async function serveWikiWithHeldInspection(): Promise<
  Awaited<ReturnType<typeof serveMinimalWiki>> & {
    counts: { inspections: number; generationReads: number }
    finishInspections(): void
  }
> {
  const counts = { inspections: 0, generationReads: 0 }
  let finishInspections = (): void => {}
  const held = new Promise<void>((resolveHeld) => {
    finishInspections = resolveHeld
  })
  const { startDeepWikiReader } = await loadModule<typeof DeepWikiReaderModule>(
    resolve(__dirname, '../deepWikiReader.js'),
    {
      './utils/inspectDeepWikiFreshness': {
        inspectDeepWikiFreshness: async (
          _projectRoot: string,
          sources: WikiIncludedSource[],
        ): Promise<WikiFreshness> => {
          counts.inspections += 1
          await held
          return {
            status: 'changed',
            changedPaths: sources.map((source) => source.path),
            addedPaths: [],
          }
        },
      },
      './utils/readWikiPublishedAt': {
        readWikiPublishedAt: async (outputDirectory: string) => {
          const publishedAt = await readWikiPublishedAt(outputDirectory)
          counts.generationReads += 1
          return publishedAt
        },
      },
    },
    { URL },
  )
  const wiki = await serveMinimalWiki(undefined, startDeepWikiReader)
  return { ...wiki, counts, finishInspections }
}

/** Waits until a count the reader raises has reached a value, for at most two seconds. */
async function waitForCount(
  read: () => number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (read() < expected && Date.now() < deadline)
    await new Promise((resolveTurn) => setImmediate(resolveTurn))
  // The reader's own continuation runs after the count was raised.
  await new Promise((resolveTurn) => setImmediate(resolveTurn))
}

test('freshness requests that overlap are answered by one inspection', async () => {
  // Arrange
  const wiki = await serveWikiWithHeldInspection()
  try {
    const freshnessRoute = new URL('api/freshness', wiki.reader.url)

    // Act: the second request arrives while the first one's inspection is still running.
    const first = fetch(freshnessRoute)
    const second = fetch(freshnessRoute)
    await waitForCount(() => wiki.counts.generationReads, 2)
    wiki.finishInspections()
    const answers = [await (await first).json(), await (await second).json()]

    // Assert
    assert.equal(wiki.counts.inspections, 1)
    assert.deepEqual(
      answers.map((answer) => answer.status),
      ['changed', 'changed'],
    )
  } finally {
    wiki.finishInspections()
    await wiki.close()
  }
})

test('a freshness request made after a publish does not join the inspection of the older manifest', async () => {
  // Arrange: the inspection of the first manifest is still running when a publish replaces it.
  const wiki = await serveWikiWithHeldInspection()
  try {
    const freshnessRoute = new URL('api/freshness', wiki.reader.url)
    const beforeThePublish = fetch(freshnessRoute)
    await waitForCount(() => wiki.counts.inspections, 1)
    const manifest = JSON.parse(await readFile(wiki.manifestPath, 'utf8'))
    await writeFile(
      wiki.manifestPath,
      JSON.stringify({
        ...manifest,
        includedSources: [{ path: 'src/new.ts', sha256: 'a'.repeat(64) }],
      }),
    )
    const publishedAt = new Date('2030-01-01T00:00:00.000Z')
    await utimes(wiki.manifestPath, publishedAt, publishedAt)

    // Act
    const afterThePublish = fetch(freshnessRoute)
    await waitForCount(() => wiki.counts.generationReads, 2)
    wiki.finishInspections()
    const answers = [
      await (await beforeThePublish).json(),
      await (await afterThePublish).json(),
    ]

    // Assert
    assert.equal(wiki.counts.inspections, 2)
    assert.deepEqual(
      answers.map((answer) => answer.changedPaths),
      [[], ['src/new.ts']],
    )
  } finally {
    wiki.finishInspections()
    await wiki.close()
  }
})

// Value: protects=the label of an open Wiki page after source changed outside the editor: the update state's stamp rises once per burst of changes, and only for a file the freshness check weighs; fails_when=a file of the Wiki folder, of a candidate folder, of an excluded path, of node_modules or outside the project raises the stamp, the stamp rises before the burst has ended, or each change of a burst raises it; why_new=Cycle 0045 pre-landing review PL-29 (row 37 of Cycle 0046): the test waited real time and asked for the stamp inside a 300 ms burst, so a slow request met the burst's end; seam=node:test's fake setTimeout, so only the test ends a burst
test('a source changed outside the editor raises the stamp of the update state once its burst has ended, and a file of the Wiki folder or an excluded path does not', async (context) => {
  // Arrange: a Wiki that indexes src/a.ts and excludes examples; the burst's timer is a fake one, so no request can meet its end.
  const wiki = await serveMinimalWiki()
  const projectRoot = resolve(wiki.outputDirectory, '../..')
  const manifest = JSON.parse(await readFile(wiki.manifestPath, 'utf8'))
  await writeFile(
    wiki.manifestPath,
    JSON.stringify({
      ...manifest,
      includedSources: [{ path: 'src/a.ts', sha256: 'a'.repeat(64) }],
      excludedPaths: ['examples'],
    }),
  )
  const readStamp = async (): Promise<number> =>
    (await (await fetch(new URL('api/update-status', wiki.reader.url))).json())
      .sourceChangeStamp
  context.mock.timers.enable({ apis: ['setTimeout'] })
  try {
    // The reader takes in the manifest's index with its next request.
    await fetch(wiki.reader.url)

    // Act
    for (const path of [
      join(wiki.outputDirectory, 'index.html'),
      `${wiki.outputDirectory}.stage-3f6c2a1e/index.html`,
      join(projectRoot, 'examples/demo.ts'),
      join(projectRoot, 'node_modules/left-pad/index.js'),
      resolve(projectRoot, '../elsewhere/src/a.ts'),
    ])
      wiki.reader.noteSourceChange(path)
    // A whole burst of 1,000 ms: a file that counted would have raised the stamp by now.
    context.mock.timers.tick(1_000)
    const stampAfterFilesThatAreNoSource = await readStamp()
    // An agent's CLI rewrites the indexed file and adds a new one in one burst.
    wiki.reader.noteSourceChange(join(projectRoot, 'src/a.ts'))
    wiki.reader.noteSourceChange(join(projectRoot, 'src/new.ts'))
    context.mock.timers.tick(999)
    const stampInsideTheBurst = await readStamp()
    // The burst ends 1,000 ms after its first change.
    context.mock.timers.tick(1)
    const stampAfterTheBurst = await readStamp()

    // Assert
    assert.equal(stampAfterFilesThatAreNoSource, 0)
    assert.equal(stampInsideTheBurst, 0)
    assert.equal(stampAfterTheBurst, 1)
  } finally {
    context.mock.timers.reset()
    await wiki.close()
  }
})

// Value: protects=the cost of the update state every open Wiki tab asks for every 2 to 15 seconds; fails_when=each answer reads and hashes the whole manifest (up to 64 MiB) again although neither it nor the receipt changed; why_new=Cycle 0045 pre-landing review PL-11 (row 19 of Cycle 0046); seam=the publication identity module the loaded reader requires, loaded with counting reads of the Wiki's metadata files and a counting hash
test('three looks at the update state over an unchanged manifest read and hash the manifest once', async () => {
  // Arrange: the identity module counts its reads of the manifest and its hashes; the served Wiki has a publisher's receipt for its manifest.
  const counts = { manifestReads: 0, hashes: 0 }
  const identityModule = await loadModule<
    typeof ReadWikiPublicationIdentityModule
  >(resolve(__dirname, '../utils/readWikiPublicationIdentity.js'), {
    './readWikiRegularFile': {
      readWikiRegularFile: (path: string) => {
        if (path.endsWith('codebook-wiki.json')) counts.manifestReads += 1
        return readWikiRegularFile(path)
      },
    },
    'node:crypto': {
      createHash: (algorithm: string) => {
        counts.hashes += 1
        return createHash(algorithm)
      },
    },
  })
  const { startDeepWikiReader } = await loadModule<typeof DeepWikiReaderModule>(
    resolve(__dirname, '../deepWikiReader.js'),
    { './utils/readWikiPublicationIdentity': identityModule },
    { URL },
  )
  const wiki = await serveMinimalWiki(undefined, startDeepWikiReader)
  await writeFile(
    join(wiki.outputDirectory, 'codebook-publication.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'published',
      manifestSha256: createHash('sha256')
        .update(await readFile(wiki.manifestPath))
        .digest('hex'),
    }),
  )
  try {
    // Act
    const publications: unknown[] = []
    for (let look = 0; look < 3; look += 1)
      publications.push(
        (
          await (
            await fetch(new URL('api/update-status', wiki.reader.url))
          ).json()
        ).publication,
      )

    // Assert
    assert.equal(typeof publications[0], 'string')
    assert.deepEqual(publications, [
      publications[0],
      publications[0],
      publications[0],
    ])
    assert.deepEqual(counts, { manifestReads: 1, hashes: 1 })
  } finally {
    await wiki.close()
  }
})

test('the update state names the new publication once the publisher wrote a new receipt for a new manifest', async () => {
  // Arrange: a served Wiki with a publisher's receipt, looked at once.
  const wiki = await serveMinimalWiki()
  const receiptPath = join(wiki.outputDirectory, 'codebook-publication.json')
  /** Writes a receipt for the manifest on disk as a new file, as the publisher does. */
  const writeReceipt = async (): Promise<void> => {
    await writeFile(
      `${receiptPath}.next`,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'published',
        manifestSha256: createHash('sha256')
          .update(await readFile(wiki.manifestPath))
          .digest('hex'),
      }),
    )
    await rename(`${receiptPath}.next`, receiptPath)
  }
  const readPublication = async (): Promise<unknown> =>
    (await (await fetch(new URL('api/update-status', wiki.reader.url))).json())
      .publication
  await writeReceipt()
  try {
    const before = await readPublication()

    // Act: a publish writes a new manifest and a new receipt.
    const manifest = JSON.parse(await readFile(wiki.manifestPath, 'utf8'))
    await writeFile(
      `${wiki.manifestPath}.next`,
      JSON.stringify({ ...manifest, excludedPaths: ['examples'] }),
    )
    await rename(`${wiki.manifestPath}.next`, wiki.manifestPath)
    await writeReceipt()
    const after = await readPublication()

    // Assert
    assert.equal(typeof before, 'string')
    assert.equal(typeof after, 'string')
    assert.notEqual(after, before)
    assert.match(
      String(after),
      new RegExp(
        `^${createHash('sha256')
          .update(await readFile(wiki.manifestPath))
          .digest('hex')}@\\d+$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})
