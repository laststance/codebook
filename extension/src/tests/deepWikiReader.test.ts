import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
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
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { readDeepWikiManifest, startDeepWikiReader } from '../deepWikiReader'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
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
      `The Wiki’s manifest (${manifestPath}) is missing, is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
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
      throughTheLink: `The Wiki’s manifest (${manifestPath}) is missing, is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first`,
    },
  )
})
