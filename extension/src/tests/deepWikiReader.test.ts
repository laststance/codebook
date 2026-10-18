import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as openConstants } from 'node:fs'
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { readDeepWikiManifest, startDeepWikiReader } from '../deepWikiReader'
import type * as linkGuardModule from '../utils/assertNoLinkOnWikiPath'
import type * as linkWalkModule from '../utils/findLinkOnWikiPath'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { fileSystemWhoseRealPathFails } from './utils/fileSystemWhoseRealPathFails'
import { loadModule } from './utils/loadModule'
import { writeMinimalWiki } from './utils/writeMinimalWiki'

test('generated Wiki reader serves published pages and answers an explicit same-origin question', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-reader-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(join(output, 'pages'), { recursive: true })
  await writeFile(
    join(output, 'index.html'),
    '<!doctype html><body><a href="pages/qa.html">Ask</a></body>',
  )
  await writeFile(
    join(output, 'pages/qa.html'),
    '<!doctype html><body><form id="qa-form"><textarea></textarea><div class="qa-answer"></div></form></body>',
  )
  await writeFile(join(output, 'secret.txt'), 'private')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'pages/qa.html' }],
      assets: [],
      includedSources: [{ path: 'src/a.ts', sha256: 'a'.repeat(64) }],
    }),
  )
  const received: string[] = []
  const reader = await startDeepWikiReader(
    output,
    projectRoot,
    async (question, sources) => {
      received.push(question)
      assert.equal(sources[0]?.path, 'src/a.ts')
      return {
        answer: 'The source confirms it.',
        citations: [
          {
            path: 'src/a.ts',
            line: 1,
            uri: 'vscode://laststance.codebook/source',
          },
        ],
        sourceChanged: false,
      }
    },
  )
  try {
    // Act
    const page = await fetch(new URL('pages/qa.html', reader.url))
    const pageHtml = await page.text()
    const client = await fetch(new URL('codebook-qa.js', reader.url))
    const clientScript = await client.text()
    const freshness = await fetch(new URL('api/freshness', reader.url))
    const origin = new URL(reader.url).origin
    const api = new URL('api/ask', reader.url)
    const answer = await fetch(api, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Where is it?' }),
    })
    const crossOrigin = await fetch(api, {
      method: 'POST',
      headers: {
        Origin: 'https://other.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question: 'Where is it?' }),
    })
    const privateFile = await fetch(new URL('secret.txt', reader.url))
    await writeFile(
      join(output, 'pages/new.html'),
      '<!doctype html><body>New chapter</body>',
    )
    await writeFile(
      join(output, 'codebook-wiki.json'),
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        pages: [{ path: 'pages/qa.html' }, { path: 'pages/new.html' }],
        assets: [],
        includedSources: [{ path: 'src/a.ts', sha256: 'a'.repeat(64) }],
      }),
    )
    const publishedLater = await fetch(new URL('pages/new.html', reader.url))
    const publishedLaterHtml = await publishedLater.text()
    // Assert
    assert.equal(page.status, 200)
    assert.match(pageHtml, /codebook-qa\.js/)
    assert.equal(client.status, 200)
    assert.match(clientScript, /Connected to Codebook reader/)
    assert.equal(freshness.status, 200)
    assert.equal((await freshness.json()).status, 'changed')
    assert.equal(answer.status, 200)
    assert.deepEqual((await answer.json()).answer, 'The source confirms it.')
    assert.deepEqual(received, ['Where is it?'])
    assert.equal(crossOrigin.status, 403)
    assert.equal(privateFile.status, 404)
    assert.equal(publishedLater.status, 200)
    assert.match(publishedLaterHtml, /New chapter/)
    assert.match(publishedLaterHtml, /codebook-qa\.js/)
    assert.match(clientScript, /data-shortcut-help/)
    assert.match(clientScript, /Keyboard shortcuts/)
    assert.match(clientScript, /outside text inputs/)
  } finally {
    await reader.close()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('generated Wiki reader refuses a published symlink escaping its output directory', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-reader-link-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'index.html'), '<!doctype html><body></body>')
  await writeFile(join(projectRoot, 'outside.txt'), 'private')
  await symlink(join(projectRoot, 'outside.txt'), join(output, 'outside.txt'))
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'index.html' }],
      assets: ['outside.txt'],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(output, projectRoot, async () => {
    throw new Error('No model request expected.')
  })
  try {
    // Act
    const response = await fetch(new URL('outside.txt', reader.url))
    // Assert
    assert.equal(response.status, 403)
    assert.doesNotMatch(await response.text(), /private/)
  } finally {
    await reader.close()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('generated Wiki reader refuses malformed source identities rather than showing false freshness', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-reader-manifest-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'index.html'), '<!doctype html><body></body>')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'index.html' }],
      assets: [],
      includedSources: [{ path: 'src/a.ts', sha256: 'not-a-hash' }],
    }),
  )
  try {
    // Act / Assert
    await assert.rejects(
      readDeepWikiManifest(output, projectRoot),
      /invalid or duplicate included source identities/,
    )
  } finally {
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('the same published Wiki opens source and update links in the active editor without rewriting static files', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-reader-links-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  const publishedHtml =
    '<!doctype html><body><a href="vscode://laststance.codebook/source?path=src%2Fa.ts">Source</a><a href="vscode://laststance.codebook/update?root=%2Frepo">Update</a><a href="vscode://laststance.codebook/settings?root=%2Frepo">Change location</a><a href="cursor://laststance.codebook/source?path=src%2Fb.ts">Older Cursor link</a><a href="https://example.com/wiki">Other</a></body>'
  await writeFile(join(output, 'index.html'), publishedHtml)
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'index.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const answer = async () => {
    throw new Error('No model request expected.')
  }
  const cursorReader = await startDeepWikiReader(
    output,
    projectRoot,
    answer,
    'cursor',
  )
  const codeReader = await startDeepWikiReader(
    output,
    projectRoot,
    answer,
    'vscode',
  )
  try {
    // Act
    const cursorHtml = await (await fetch(cursorReader.url)).text()
    const codeHtml = await (await fetch(codeReader.url)).text()

    // Assert
    assert.match(
      cursorHtml,
      /href="cursor:\/\/laststance\.codebook\/source\?path=src%2Fa\.ts"/,
    )
    assert.match(
      cursorHtml,
      /href="cursor:\/\/laststance\.codebook\/update\?root=%2Frepo"/,
    )
    assert.match(
      cursorHtml,
      /href="cursor:\/\/laststance\.codebook\/settings\?root=%2Frepo"/,
    )
    assert.match(
      cursorHtml,
      /href="cursor:\/\/laststance\.codebook\/source\?path=src%2Fb\.ts"/,
    )
    assert.doesNotMatch(cursorHtml, /href="vscode:\/\/laststance\.codebook/)
    assert.match(
      codeHtml,
      /href="vscode:\/\/laststance\.codebook\/source\?path=src%2Fa\.ts"/,
    )
    assert.match(
      codeHtml,
      /href="vscode:\/\/laststance\.codebook\/settings\?root=%2Frepo"/,
    )
    assert.match(
      codeHtml,
      /href="vscode:\/\/laststance\.codebook\/source\?path=src%2Fb\.ts"/,
    )
    assert.doesNotMatch(codeHtml, /href="cursor:\/\/laststance\.codebook/)
    assert.match(cursorHtml, /href="https:\/\/example\.com\/wiki"/)
    assert.equal(
      await readFile(join(output, 'index.html'), 'utf8'),
      publishedHtml,
    )
  } finally {
    await Promise.all([cursorReader.close(), codeReader.close()])
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('a local page without this reader’s private path token cannot read the generated Wiki', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-reader-token-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'index.html'),
    '<!doctype html><body>Private architecture notes</body>',
  )
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'index.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(output, projectRoot, async () => {
    throw new Error('No model request expected.')
  })
  try {
    // Act
    const guessedToken = await fetch(
      new URL('/w/not-the-reader-token/index.html', reader.url),
    )
    const rootPage = await fetch(new URL('/index.html', reader.url))

    // Assert
    assert.equal(guessedToken.status, 404)
    assert.doesNotMatch(await guessedToken.text(), /Private architecture notes/)
    assert.equal(rootPage.status, 404)
    assert.doesNotMatch(await rootPage.text(), /Private architecture notes/)
  } finally {
    await reader.close()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

test('a failed editor-model answer reaches the browser reader as an error instead of an empty answer', async () => {
  // Arrange
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-reader-model-failure-'),
  )
  const projectRoot = await realpath(projectDirectory)
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'index.html'),
    '<!doctype html><body><form id="qa-form"><textarea></textarea><div class="qa-answer"></div></form></body>',
  )
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'index.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(output, projectRoot, async () => {
    throw new Error('The editor model is unavailable.')
  })
  try {
    // Act
    const response = await fetch(new URL('api/ask', reader.url), {
      method: 'POST',
      headers: {
        Origin: new URL(reader.url).origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: 'Where is invoice creation validated?',
      }),
    })

    // Assert
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      error: 'Error: The editor model is unavailable.',
    })
  } finally {
    await reader.close()
    await rm(projectDirectory, { recursive: true, force: true })
  }
})

/**
 * Serves a one-page Wiki whose question handler answers every question, for the tests of which page may ask.
 *
 * @returns The started reader, `ask` (posts a question the way the reader's page does, with the given `Origin` header or none, and returns the status) and `close`.
 */
async function serveWikiThatAnswers(): Promise<{
  reader: Awaited<ReturnType<typeof startDeepWikiReader>>
  ask(origin: string | undefined): Promise<number>
  close(): Promise<void>
}> {
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-origin-')),
  )
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'index.html'), '<!doctype html><body></body>')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(output, projectRoot, async () => ({
    answer: 'The source confirms it.',
    citations: [],
    sourceChanged: false,
  }))
  return {
    reader,
    async ask(origin) {
      const response = await fetch(new URL('api/ask', reader.url), {
        method: 'POST',
        headers: {
          ...(origin === undefined ? {} : { Origin: origin }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: 'Where is it?' }),
      })
      return response.status
    },
    async close(): Promise<void> {
      await reader.close()
      await rm(projectRoot, { recursive: true, force: true })
    },
  }
}

test('a question from the address the editor forwarded the reader to is answered', async () => {
  // Arrange: a remote window forwards the reader's port to another one of the learner's machine.
  const wiki = await serveWikiThatAnswers()
  try {
    wiki.reader.acceptForwardedOrigin(
      `http://localhost:54321${new URL(wiki.reader.url).pathname}`,
    )

    // Act
    const status = await wiki.ask('http://localhost:54321')

    // Assert
    assert.equal(status, 200)
  } finally {
    await wiki.close()
  }
})

test('a question from any other origin is refused', async () => {
  // Arrange: one forwarded address on this machine was accepted, and one that is not on this machine was offered.
  const wiki = await serveWikiThatAnswers()
  try {
    wiki.reader.acceptForwardedOrigin('http://localhost:54321/w/token/')
    wiki.reader.acceptForwardedOrigin('https://tunnel.example/w/token/')

    // Act
    const statuses = [
      await wiki.ask('https://tunnel.example'),
      await wiki.ask('https://other.example'),
      await wiki.ask('http://localhost:54322'),
      await wiki.ask('http://evil.example:54321'),
      await wiki.ask(undefined),
    ]

    // Assert
    assert.deepEqual(statuses, [403, 403, 403, 403, 403])
  } finally {
    await wiki.close()
  }
})

test('in a local window only the reader’s own origin is accepted', async () => {
  // Arrange: a local window forwards nothing, so the editor resolves the reader's address to itself.
  const wiki = await serveWikiThatAnswers()
  try {
    const ownOrigin = new URL(wiki.reader.url).origin
    const statusWithoutAnOriginBeforeTheAddressWasResolved =
      await wiki.ask(undefined)
    wiki.reader.acceptForwardedOrigin(wiki.reader.url)

    // Act
    const statuses = [
      statusWithoutAnOriginBeforeTheAddressWasResolved,
      await wiki.ask(ownOrigin),
      await wiki.ask(ownOrigin.replace('127.0.0.1', 'localhost')),
      await wiki.ask('http://127.0.0.1:1'),
      await wiki.ask(undefined),
    ]

    // Assert
    assert.deepEqual(statuses, [403, 200, 403, 403, 403])
  } finally {
    await wiki.close()
  }
})

test('closing the reader while a question is in flight stops the question and ends at once', async () => {
  // Arrange: a question whose answer never comes by itself.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-close-')),
  )
  const output = join(projectRoot, '.codebook', 'wiki')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'index.html'), '<!doctype html><body></body>')
  await writeFile(
    join(output, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: [],
      includedSources: [],
    }),
  )
  let questionSignal: AbortSignal | undefined
  let noteQuestionArrived = (): void => {}
  const questionArrived = new Promise<void>((resolveArrived) => {
    noteQuestionArrived = resolveArrived
  })
  const reader = await startDeepWikiReader(
    output,
    projectRoot,
    (_question, _sources, signal) =>
      new Promise((_resolve, reject) => {
        questionSignal = signal
        signal.addEventListener('abort', () =>
          reject(new Error('The question was stopped.')),
        )
        noteQuestionArrived()
      }),
  )
  const browserTab = new AbortController()
  const asking = fetch(new URL('api/ask', reader.url), {
    method: 'POST',
    headers: {
      Origin: new URL(reader.url).origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: 'Where is it?' }),
    signal: browserTab.signal,
  }).catch(() => undefined)
  try {
    await questionArrived

    // Act: "Open DeepWiki" closes the old reader before it starts a new one.
    const closing = await Promise.race([
      reader.close().then(() => 'closed'),
      new Promise((resolveWait) =>
        setTimeout(() => resolveWait('still waiting for the question'), 2_000),
      ),
    ])

    // Assert
    assert.equal(closing, 'closed')
    // The tab's request ends with its connection; by then the reader has stopped the question.
    await asking
    assert.equal(questionSignal?.aborted, true)
  } finally {
    // Also when the close did not end: the tab's request is given up, so nothing keeps the test file open.
    browserTab.abort()
    await asking
    await rm(projectRoot, { recursive: true, force: true })
  }
})

// Value: protects=every request of the open Wiki reader and the freshness check of an update in a checkout whose repository carries the Wiki's manifest as a link to a pipe (row 186); fails_when=the reader reads its manifest by name, which follows the link and waits for a writer that never comes; why_new=Cycle 0046 row 186; seam=none (a real named pipe, whose waiting reader the test releases when it ends)
test(
  'the reader’s manifest read does not wait on a link to a named pipe at the manifest’s path: it refuses at once and names the file',
  {
    timeout: 2_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange
    const projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-pipe-')),
    )
    const pipePath = join(projectRoot, 'a-pipe-nobody-writes-to')
    await promisify(execFile)('mkfifo', [pipePath])
    // A read that waits on the pipe would keep this process alive: a writer that opens and closes ends it, also when the body was stopped at its time bound.
    context.after(async () => {
      await open(
        pipePath,
        openConstants.O_WRONLY | openConstants.O_NONBLOCK,
      ).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await rm(projectRoot, { recursive: true, force: true })
    })
    const { outputDirectory, manifestPath } =
      await writeMinimalWiki(projectRoot)
    await rm(manifestPath)
    if (!(await createLinkIfAllowed(pipePath, manifestPath)))
      return context.skip(LINK_NOT_ALLOWED)

    // Act
    const refusal = await readDeepWikiManifest(
      outputDirectory,
      projectRoot,
    ).then(
      () => 'read',
      (error: Error) => error.message,
    )

    // Assert
    assert.equal(
      refusal,
      `The Wiki’s manifest (${manifestPath}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
    )
  },
)

// Value: protects=the rule that the reader takes its manifest from the Wiki folder alone, on every system; fails_when=the read follows a link, so a manifest that lies outside the Wiki folder decides which files the reader serves; why_new=Cycle 0046 row 186: the pipe case cannot run on Windows; seam=none
test('the reader’s manifest read does not follow a link to a regular manifest elsewhere, while the same manifest as a file of the Wiki folder is read', async (context) => {
  // Arrange: a one-page Wiki whose manifest is read once in place, then moved out of the Wiki folder with a link left in its place.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-link-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  const filesOfTheManifestInPlace = [
    ...(await readDeepWikiManifest(outputDirectory, projectRoot)).files,
  ]
  const manifestElsewhere = join(projectRoot, 'moved.json')
  await rename(manifestPath, manifestElsewhere)
  if (!(await createLinkIfAllowed(manifestElsewhere, manifestPath)))
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  const throughTheLink = await readDeepWikiManifest(
    outputDirectory,
    projectRoot,
  ).then(
    () => 'read',
    (error: Error) => error.message,
  )

  // Assert
  assert.deepEqual(
    { filesOfTheManifestInPlace, throughTheLink },
    {
      filesOfTheManifestInPlace: ['index.html'],
      throughTheLink: `The Wiki’s manifest (${manifestPath}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
    },
  )
})

// Value: protects=the folder outside the project that a cloned repository's `.codebook` link leads to, when the learner opens the Wiki; fails_when=the reader reads the manifest by the Wiki folder's path again and follows the link at its parent, so it serves the files of a folder outside the project; why_new=Cycle 0046 /ship finding F1: the reader's reads checked the manifest's own path and the served files below the folder, never the folders above it; seam=none (a junction on Windows, which needs no right)
test('the reader refuses a Wiki whose `.codebook` folder in the project is a link to a folder outside it, names the link and opens nothing behind it', async (context) => {
  // Arrange: a one-page Wiki whose `.codebook` folder is moved out of the project, with a link to it left in its place.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-linked-parent-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const projectRoot = join(directory, 'project')
  await mkdir(projectRoot)
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  await rename(
    join(projectRoot, '.codebook'),
    join(directory, 'codebook-moved-out'),
  )
  await symlink(
    join(directory, 'codebook-moved-out'),
    join(projectRoot, '.codebook'),
    'junction',
  )

  // Act
  const refusal = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  ).then(
    async (reader) => {
      await reader.close()
      return 'opened'
    },
    (error: Error) => error.message,
  )

  // Assert
  assert.equal(
    refusal,
    `The Wiki folder ${outputDirectory} lies behind a link or a file in the project (${join(projectRoot, '.codebook')}). Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
  )
})

// Value: protects=the folder outside the project that a cloned repository's `.codebook/wiki` link leads to, when the learner opens the Wiki; fails_when=the reader looks only at the folders above the Wiki folder, so a Wiki folder that is itself a link is read and served from outside the project, while the publisher and the update start refuse it; why_new=Cycle 0046 /ship repeat review SC2 (critical; the rest of F1); repeat design review PD7: the refusal is short sentences; seam=none (a junction on Windows, which needs no right)
test('the reader refuses a Wiki whose folder `.codebook/wiki` in the project is itself a link to a folder outside it, names the folder and opens nothing behind it', async (context) => {
  // Arrange: a one-page Wiki whose Wiki folder is moved out of the project, with a link to it left in its place.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-linked-folder-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const projectRoot = join(directory, 'project')
  await mkdir(projectRoot)
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  await rename(outputDirectory, join(directory, 'wiki-moved-out'))
  await symlink(join(directory, 'wiki-moved-out'), outputDirectory, 'junction')

  // Act
  const refusal = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  ).then(
    async (reader) => {
      await reader.close()
      return 'opened'
    },
    (error: Error) => error.message,
  )

  // Assert
  assert.equal(
    refusal,
    `The Wiki folder ${outputDirectory} is a link or a file, or leads out of the project. Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to your Wiki’s folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
  )
})

// Value: protects=the reader on Windows, where the file system layer of Node.js calls a junction whose target is a volume a directory, at the Wiki folder or at a folder above it; fails_when=the reader's look trusts lstat and no longer compares the entry's real path with the project, so a Wiki behind such a junction is read and served from outside the project; why_new=Cycle 0046 /ship repeat testing review TR4 (the real-path branch had no test) with SC2's folder-itself case; seam=a file system whose lstat calls a link a directory
test('the reader’s look refuses a Wiki folder, and a folder above it, that lstat calls a directory although its real path leaves the project', async (context) => {
  // Arrange: two one-page Wikis, the first with its `.codebook` folder and the second with its Wiki folder moved out of the project and a link left in its place, read by a guard whose lstat answers for a link what stat answers.
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-wrong-look-')),
  )
  context.after(() => rm(directory, { recursive: true, force: true }))
  const wrongLook = fileSystemWhoseLinksResistRemoval({
    lstatOfALink: 'a directory',
  })
  const walk = await loadModule<typeof linkWalkModule>(
    resolve(__dirname, '../utils/findLinkOnWikiPath.js'),
    { 'node:fs/promises': wrongLook.fileSystem },
  )
  const { assertNoLinkOnWikiPath: assertWhereTheLookIsWrong } =
    await loadModule<typeof linkGuardModule>(
      resolve(__dirname, '../utils/assertNoLinkOnWikiPath.js'),
      { './findLinkOnWikiPath': walk },
    )
  const withLinkedParent = join(directory, 'parent')
  const withLinkedFolder = join(directory, 'folder')
  await mkdir(withLinkedParent)
  await mkdir(withLinkedFolder)
  const parentWiki = await writeMinimalWiki(withLinkedParent)
  const folderWiki = await writeMinimalWiki(withLinkedFolder)
  await rename(
    join(withLinkedParent, '.codebook'),
    join(directory, 'codebook-moved-out'),
  )
  await symlink(
    join(directory, 'codebook-moved-out'),
    join(withLinkedParent, '.codebook'),
    'junction',
  )
  await rename(folderWiki.outputDirectory, join(directory, 'wiki-moved-out'))
  await symlink(
    join(directory, 'wiki-moved-out'),
    folderWiki.outputDirectory,
    'junction',
  )

  // Act
  const refusalOf = (outputDirectory: string, projectRoot: string) =>
    assertWhereTheLookIsWrong(outputDirectory, projectRoot).then(
      () => 'read',
      (error: Error) => error.message,
    )
  const refusals = [
    await refusalOf(parentWiki.outputDirectory, withLinkedParent),
    await refusalOf(folderWiki.outputDirectory, withLinkedFolder),
  ]

  // Assert
  assert.deepEqual(refusals, [
    `The Wiki folder ${parentWiki.outputDirectory} lies behind a link or a file in the project (${join(withLinkedParent, '.codebook')}). Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
    `The Wiki folder ${folderWiki.outputDirectory} is a link or a file, or leads out of the project. Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to your Wiki’s folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
  ])
})

// Value: protects=the learner whose project holds a folder on the Wiki folder's path whose real path the system cannot name (a folder of another user, or a junction on Windows that `realpath` refuses); fails_when=the reader's walk lets the system's error of `realpath` through, so the reader and the open command show that error instead of the refusal of a folder that leaves the project; why_new=Cycle 0046 /ship adversarial review AD17; seam=a file system whose realpath fails for one folder (src/tests/utils/fileSystemWhoseRealPathFails.ts)
for (const code of ['EACCES', 'EINVAL'] as const)
  test(`the reader refuses a Wiki whose .codebook folder has a real path the system cannot name (${code}) with the sentence of a folder above the Wiki folder, not the system’s error`, async (context) => {
    // Arrange: a one-page Wiki read by a guard whose realpath fails for `.codebook`.
    const projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-unnamed-real-path-')),
    )
    context.after(() => rm(projectRoot, { recursive: true, force: true }))
    const { outputDirectory } = await writeMinimalWiki(projectRoot)
    const walk = await loadModule<typeof linkWalkModule>(
      resolve(__dirname, '../utils/findLinkOnWikiPath.js'),
      {
        'node:fs/promises': fileSystemWhoseRealPathFails(
          join(projectRoot, '.codebook'),
          code,
        ),
      },
    )
    const { assertNoLinkOnWikiPath: assertWhereTheRealPathFails } =
      await loadModule<typeof linkGuardModule>(
        resolve(__dirname, '../utils/assertNoLinkOnWikiPath.js'),
        { './findLinkOnWikiPath': walk },
      )

    // Act
    const refusal = await assertWhereTheRealPathFails(
      outputDirectory,
      projectRoot,
    ).then(
      () => 'read',
      (error: Error) => error.message,
    )

    // Assert
    assert.equal(
      refusal,
      `The Wiki folder ${outputDirectory} lies behind a link or a file in the project (${join(projectRoot, '.codebook')}). Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
    )
  })

// Value: protects=the reader's origin, whose page may ask the editor's model, against script a page's content carries (an event attribute or a `javascript:` address an agent wrote, also in a Wiki published before the publisher refused them), against a script written straight into a page file of the Wiki folder, and against an asset of the Wiki that is an HTML file with a script of its own; fails_when=the reader serves a page without a Content-Security-Policy, or with one that lets inline script run, or lets a script run by a secret its own tag carries, which a tag left open before it takes over; why_new=Cycle 0046 /ship finding F2 (security, verified): pages were served with no Content-Security-Policy; repeat review SC1 (critical): every script of a page file got the nonce; Codex review CX16: the reader's nonce went to a script tag a page file leaves open before the reader's own; finding AF6: the page's javascript: link is served without its link, as every address the publisher refuses today; seam=none (the reader's real responses)
test('every page the reader serves lets only script files of its own origin and the shell’s script by its known hash run, and the reader’s own tag carries no secret: a script written into a page file or into an asset that is an HTML file runs nowhere', async (context) => {
  // Arrange: an overview page file with content that holds an event attribute and a javascript: link, and a script that is not the shell's, written into the file; and an asset that ends in .html with a script of its own.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-policy-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(join(outputDirectory, 'assets'), { recursive: true })
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><body><article><img src="x.png" onerror="fetch(\'api/ask\')"><a href="javascript:run()">Run</a></article><script>\nthemeButton()\n</script></body>',
  )
  await writeFile(
    join(outputDirectory, 'assets/notes.html'),
    '<!doctype html><body><article></article><script>run()</script></body>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['assets/notes.html'],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const clientAddress = `${new URL(reader.url).pathname.replace('index.html', '')}codebook-qa.js`
  /** The policy and the page of one response, the reader's script address written as CLIENT. */
  const served = async (path: string) => {
    const response = await fetch(new URL(path, reader.url))
    return {
      policy: response.headers.get('content-security-policy'),
      page: (await response.text()).replaceAll(clientAddress, 'CLIENT'),
    }
  }

  // Act
  const overview = await served('index.html')
  const asset = await served('assets/notes.html')

  // Assert
  assert.deepEqual(
    { overview, asset },
    {
      overview: {
        policy:
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'",
        page: '<!doctype html><body><article><img src="x.png" onerror="fetch(\'api/ask\')"><a data-codebook-unlinked="javascript:run()">Run</a></article><script>\nthemeButton()\n</script><script src="CLIENT"></script></body>',
      },
      asset: {
        policy:
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'",
        page: '<!doctype html><body><article></article><script>run()</script><script src="CLIENT"></script></body>',
      },
    },
  )
})

// Value: protects=the reader's origin, whose page may ask the editor's model, against a script file written into the Wiki folder and named by the manifest, which a page file points at with a script tag, plainly or through a tag it leaves open before the reader's own; fails_when=the reader serves a `.js` file of the Wiki folder as JavaScript again, so the policy's `'self'` lets it run, or a response of the reader (a page, an asset, its own script, an answer, a refusal) comes without `nosniff`, so a browser may run a file of another type as script; why_new=Cycle 0046 /ship Codex review CX16: under a nonce, a script tag left open before the reader's own takes over its nonce in a browser that does not refuse such a tag (Chromium refuses it, Firefox and Safari were not tried); seam=none (the reader's real responses)
test('a script file of the Wiki folder is served as plain text, a page that points at it plainly or through a tag left open before the reader’s own gets no secret to run it, and every response of the reader says nosniff', async (context) => {
  // Arrange: a script file in the Wiki folder that the manifest names, an overview that points at it, and a page that leaves a script tag open before the reader's own.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-script-file-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const outputDirectory = join(projectRoot, '.codebook', 'wiki')
  await mkdir(join(outputDirectory, 'assets'), { recursive: true })
  await writeFile(
    join(outputDirectory, 'assets/planted.js'),
    "fetch('api/ask')",
  )
  await writeFile(
    join(outputDirectory, 'index.html'),
    '<!doctype html><body><article><script src="assets/planted.js"></script></article></body>',
  )
  await writeFile(
    join(outputDirectory, 'assets/open-tag.html'),
    '<!doctype html><body><article></article><script src="planted.js" </body>',
  )
  await writeFile(
    join(outputDirectory, 'codebook-wiki.json'),
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['assets/planted.js', 'assets/open-tag.html'],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const clientAddress = `${new URL(reader.url).pathname.replace('index.html', '')}codebook-qa.js`
  /** The type, the nosniff header and the policy of one response, and its page with the reader's script address written as CLIENT. */
  const served = async (path: string) => {
    const response = await fetch(new URL(path, reader.url))
    return {
      type: response.headers.get('content-type'),
      sniffing: response.headers.get('x-content-type-options'),
      policy: response.headers.get('content-security-policy'),
      body: (await response.text()).replaceAll(clientAddress, 'CLIENT'),
    }
  }

  // Act
  const scriptFile = await served('assets/planted.js')
  const overview = await served('index.html')
  const openTag = await served('assets/open-tag.html')
  const ownScript = await served('codebook-qa.js')
  const answer = await served('api/update-status')
  const refusal = await served('assets/not-published.js')

  // Assert: the script file is plain text; the pages carry the policy and the reader's tag without a nonce; every response says nosniff, and the reader's own script alone is JavaScript.
  assert.deepEqual(
    {
      scriptFile,
      overview,
      openTag,
      ownScript: { type: ownScript.type, sniffing: ownScript.sniffing },
      answer: { type: answer.type, sniffing: answer.sniffing },
      refusal: { type: refusal.type, sniffing: refusal.sniffing },
    },
    {
      scriptFile: {
        type: 'text/plain; charset=utf-8',
        sniffing: 'nosniff',
        policy: null,
        body: "fetch('api/ask')",
      },
      overview: {
        type: 'text/html; charset=utf-8',
        sniffing: 'nosniff',
        policy:
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'",
        body: '<!doctype html><body><article><script src="assets/planted.js"></script></article><script src="CLIENT"></script></body>',
      },
      openTag: {
        type: 'text/html; charset=utf-8',
        sniffing: 'nosniff',
        policy:
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'",
        body: '<!doctype html><body><article></article><script src="planted.js" <script src="CLIENT"></script></body>',
      },
      ownScript: {
        type: 'text/javascript; charset=utf-8',
        sniffing: 'nosniff',
      },
      answer: {
        type: 'application/json; charset=utf-8',
        sniffing: 'nosniff',
      },
      refusal: {
        type: 'application/json; charset=utf-8',
        sniffing: 'nosniff',
      },
    },
  )
})

// Value: protects=the shell's own script (the theme button, the offline note of the question form) on every page the reader serves, of this build and of the Wikis earlier builds published; fails_when=the reader's policy no longer names the hash of the script the bundled shell or the shell of 0.2.29.0 carries, so that script is refused and the page's theme button stops working, or a shell's script changes without its hash in the reader's list; why_new=Cycle 0046 /ship repeat review SC1: the shell's script runs by its hash instead of the nonce; seam=none
test('the reader’s policy names the hash of the one script the shell of this build and the shell of 0.2.29.0 carry, unchanged since the first reader', async (context) => {
  // Arrange: the bundled shell, the shell of 0.2.29.0 kept beside the DOM check, and a reader of a one-page Wiki.
  const shells = await Promise.all(
    [
      join(__dirname, '..', '..', 'skills', 'codebook', 'reader-shell.html'),
      join(
        __dirname,
        '..',
        '..',
        'scripts',
        'fixtures',
        'reader-shell-0.2.29.0.txt',
      ),
    ].map(async (path) =>
      // A browser reads every CRLF and lone CR of a page as LF before it hashes an inline script, and the publisher writes the shell so; a checkout may hold the files with CRLF.
      (await readFile(path, 'utf8')).replace(/\r\n?/g, '\n'),
    ),
  )
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-shells-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act: the hash of each shell's inline scripts, and the policy of a served page.
  const scriptHashes = shells.map((shell) =>
    [...shell.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) =>
      createHash('sha256')
        .update(script ?? '')
        .digest('base64'),
    ),
  )
  const policy = (await fetch(reader.url)).headers.get(
    'content-security-policy',
  )

  // Assert
  assert.deepEqual(
    {
      scriptHashes,
      policy,
    },
    {
      scriptHashes: [
        ['yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='],
        ['yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='],
      ],
      policy:
        "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='; object-src 'none'; base-uri 'none'",
    },
  )
})
