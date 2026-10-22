import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as openConstants } from 'node:fs'
import {
  appendFile,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import * as fileSystemPromises from 'node:fs/promises'
import * as http from 'node:http'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import * as constants from '../constants'
import type * as deepWikiReaderModule from '../deepWikiReader'
import { readDeepWikiManifest, startDeepWikiReader } from '../deepWikiReader'
import type * as linkGuardModule from '../utils/assertNoLinkOnWikiPath'
import type * as linkWalkModule from '../utils/findLinkOnWikiPath'
import type * as openWithoutFollowingModule from '../utils/openWithoutFollowing'
import { openWithoutFollowing } from '../utils/openWithoutFollowing'
import type * as readUpToLimitModule from '../utils/readUpToLimit'
import { readUpToLimit } from '../utils/readUpToLimit'
import type * as readWikiFileToOpenModule from '../utils/readWikiFileToOpen'
import { readWikiFileToOpen } from '../utils/readWikiFileToOpen'
import type * as readWikiPublicationIdentityModule from '../utils/readWikiPublicationIdentity'
import { readWikiPublicationIdentity } from '../utils/readWikiPublicationIdentity'
import type * as takeWikiPagePlaceModule from '../utils/takeWikiPagePlace'
import type * as wikiPageRefusalHtmlModule from '../utils/wikiPageRefusalHtml'
import {
  wikiPageRefusalHtml,
  type WikiPageRefusalReason,
} from '../utils/wikiPageRefusalHtml'
import type * as wikiPageWorkerModule from '../wikiPageWorker'

import { answeredAtOnce } from './utils/answeredAtOnce'
import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
import { fileSystemWhoseLinksResistRemoval } from './utils/fileSystemWhoseLinksResistRemoval'
import { fileSystemWhoseRealPathFails } from './utils/fileSystemWhoseRealPathFails'
import { loadModule } from './utils/loadModule'
import { readerAnswersInChildProcess } from './utils/readerAnswersInChildProcess'
import { within } from './utils/within'
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

// Value: protects=a learner whose editor forwards the reader's port to a second loopback address after a first (a second window, a port that was taken again, a second open of the reader): the page at the first address still asks its questions and is still served; fails_when=the reader keeps only the last forwarded address, so a question from the first one and a request with the first one's Host header get 403; why_new=Cycle 0048 task 140 (native adversarial); seam=none (the reader's real answers to a POST with a chosen Origin and to a raw request with a chosen Host); no_claim=that an editor forwards twice, only that the reader answers both addresses it was told
test('a reader told two forwarded loopback addresses answers questions and requests from both, and still refuses a third address it was not told', async () => {
  // Arrange: the editor forwarded the reader's port to localhost:54321, and later to localhost:54322.
  const wiki = await serveWikiThatAnswers()
  try {
    const pathname = new URL(wiki.reader.url).pathname
    wiki.reader.acceptForwardedOrigin(`http://localhost:54321${pathname}`)
    wiki.reader.acceptForwardedOrigin(`http://localhost:54322${pathname}`)

    // Act
    const questionStatuses = [
      await wiki.ask('http://localhost:54321'),
      await wiki.ask('http://localhost:54322'),
      await wiki.ask('http://localhost:54323'),
    ]
    const pageStatuses = [
      (await askAndReadSlowly(wiki.reader.url, { Host: 'localhost:54321' }, 0))
        .status,
      (await askAndReadSlowly(wiki.reader.url, { Host: 'localhost:54322' }, 0))
        .status,
      (await askAndReadSlowly(wiki.reader.url, { Host: 'localhost:54323' }, 0))
        .status,
    ]

    // Assert
    assert.deepEqual(
      { questionStatuses, pageStatuses },
      { questionStatuses: [200, 200, 403], pageStatuses: [200, 200, 403] },
    )
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

// Value: protects=the reader's private path token against DNS rebinding, where a page that leaked the reader's address (see the referrer filter) lets a host name of the attacker resolve to the loopback address and read the Wiki; fails_when=the reader answers a request whose Host header is neither its own loopback host and port nor the forwarded address's host, or accepts a request without a Host header, or refuses its own host or the forwarded one; why_new=Cycle 0048 task 6 (S11-N3); seam=none (the reader's real answer to raw requests with a chosen Host header); no_claim=that a browser resolves a rebound name to the reader or that the leak of the address is closed (the filter's test holds that)
test('a request whose Host header is neither the reader’s own nor the forwarded address’s is refused with 403 and no page, while the reader’s own host and the forwarded one are served', async () => {
  // Arrange: a remote window forwarded the reader's port to localhost:54321.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-host-')),
  )
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => {
      throw new Error('No model request expected.')
    },
  )
  try {
    const ownHost = new URL(reader.url).host
    reader.acceptForwardedOrigin(
      `http://localhost:54321${new URL(reader.url).pathname}`,
    )
    const pageAddress = reader.url

    // Act
    const answers = {
      own: await askAndReadSlowly(pageAddress, { Host: ownHost }, 0),
      forwarded: await askAndReadSlowly(
        pageAddress,
        { Host: 'localhost:54321' },
        0,
      ),
      rebound: await askAndReadSlowly(
        pageAddress,
        { Host: `rebound.example:${new URL(reader.url).port}` },
        0,
      ),
      otherPort: await askAndReadSlowly(
        pageAddress,
        { Host: 'localhost:54322' },
        0,
      ),
      sameNameOtherPort: await askAndReadSlowly(
        pageAddress,
        { Host: '127.0.0.1:1' },
        0,
      ),
    }
    // An HTTP/1.0 request may carry no Host header at all.
    const withoutHost = await new Promise<string>((resolveAnswer) => {
      const connection = connect(Number(new URL(pageAddress).port), '127.0.0.1')
      let received = ''
      connection.on('data', (part: Buffer) => {
        received += part.toString('utf8')
      })
      connection.on('error', () => undefined)
      connection.once('close', () => resolveAnswer(received))
      connection.write(`GET ${new URL(pageAddress).pathname} HTTP/1.0\r\n\r\n`)
    })

    // Assert
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(answers).map(([name, answer]) => [name, answer.status]),
      ),
      {
        own: 200,
        forwarded: 200,
        rebound: 403,
        otherPort: 403,
        sameNameOtherPort: 403,
      },
    )
    assert.match(withoutHost, /^HTTP\/1\.[01] 403 /)
    assert.doesNotMatch(withoutHost, /<body>Wiki<\/body>/)
    assert.doesNotMatch(String(answers.rebound.body), /<body>Wiki<\/body>/)
  } finally {
    await reader.close()
    await rm(projectRoot, { recursive: true, force: true })
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
    const closing = await within(
      reader.close().then(() => 'closed'),
      2_000,
    )

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

// Value: protects=the learner's editor model, its quota and the model picker against questions nobody waits for: the reader began to watch a question's disconnect only after it had read the manifest, so a tab closed meanwhile still sent its question to the model (Codex reproduced one call of the answer function, with no abort); fails_when=the reader asks the model for a question whose request closed while its body or the manifest was read; why_new=Cycle 0047 row 271 (P3CR-2 = P3CXA-B1 = P3CLA-7); seam=the reader loaded with loadModule, a manifest reader that holds every read after the reader's start until the test lets it go, and a node:http whose server notes each close of an answer and each end of the reader's handler; no_claim=a real browser's close timing
test('a question whose tab goes while the reader reads the manifest is not sent to the editor model', async (context) => {
  // Arrange: the one-page Wiki, a manifest reader that holds every read after the reader's start, an answer function that notes each question it is asked, and a server that notes each close of an answer and each end of the reader's handler.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-question-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  let isReaderStarted = false
  let noteManifestReadAsked: (asked: 'asked') => void = () => undefined
  const manifestReadAsked = new Promise<'asked'>((resolveAsked) => {
    noteManifestReadAsked = resolveAsked
  })
  let letReadsGoOn = (): void => {}
  const readsMayGoOn = new Promise<void>((resolveGoOn) => {
    letReadsGoOn = resolveGoOn
  })
  const holdingManifestReader: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: async (...parameters) => {
      // The reader's start reads the manifest as always; every later read is held.
      if (parameters[1] === 'manifest' && isReaderStarted) {
        noteManifestReadAsked('asked')
        await readsMayGoOn
      }
      return readWikiFileToOpen(...parameters)
    },
  }
  const server = httpNotingTheReadersRequests()
  const { startDeepWikiReader: startReaderHoldingManifestReads } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        'node:http': server.http,
        './utils/readWikiFileToOpen': holdingManifestReader,
      },
      { URL },
    )
  const questionsAsked: string[] = []
  const reader = await startReaderHoldingManifestReads(
    outputDirectory,
    projectRoot,
    async (question) => {
      questionsAsked.push(question)
      return {
        answer: 'The source confirms it.',
        citations: [],
        sourceChanged: false,
      }
    },
  )
  context.after(() => reader.close())
  // A held read is let go also when the test fails, so its request ends.
  context.after(() => letReadsGoOn())
  isReaderStarted = true
  const browserTab = new AbortController()
  const asking = fetch(new URL('api/ask', reader.url), {
    method: 'POST',
    headers: {
      Origin: new URL(reader.url).origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: 'Where is it?' }),
    signal: browserTab.signal,
  }).then(
    () => 'answered',
    () => 'request gone',
  )
  const readAsked = await within(manifestReadAsked, 2_000)

  // Act: the tab goes while the manifest is read; once the reader's answer has closed, the read goes on.
  browserTab.abort()
  const tab = await asking
  const questionAnswer = await within(server.answersClosed(1), 2_000)
  letReadsGoOn()
  const questionHandler = await within(server.handlersEnded(1), 2_000)

  // Assert
  assert.deepEqual(
    { readAsked, tab, questionAnswer, questionHandler, questionsAsked },
    {
      readAsked: 'asked',
      tab: 'request gone',
      questionAnswer: 'closed',
      questionHandler: 'ended',
      questionsAsked: [],
    },
  )
})

// Value: protects=a learner who asks the Wiki in words with letters of more than one byte, such as é or any Japanese character: the reader decoded each part of a question's body alone, so a character whose bytes two parts shared reached the model as two replacement characters (U+FFFD); fails_when=the reader decodes the body part by part instead of whole, so the model gets another question than the learner wrote; why_new=Cycle 0047 row 271 (P3CLA-12); seam=a request of the test's that writes the body in two writes split inside the é, with a pause between them, so the reader receives two parts; no_claim=how a browser splits a body (any split inside a character is alike)
test('a question whose character of two bytes is split between two parts of its body reaches the editor model whole', async (context) => {
  // Arrange: the one-page Wiki, an answer function that notes each question it is asked, and a body cut between the two bytes of its é.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-split-question-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const questionsAsked: string[] = []
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async (question) => {
      questionsAsked.push(question)
      return {
        answer: 'The source confirms it.',
        citations: [],
        sourceChanged: false,
      }
    },
  )
  context.after(() => reader.close())
  const body = Buffer.from('{"question":"Where is the café validated?"}')
  const insideTheE = body.indexOf(Buffer.from('é')) + 1

  // Act
  const status = await new Promise<number | 'request failed'>(
    (resolveStatus) => {
      const request = http.request(
        new URL('api/ask', reader.url),
        {
          method: 'POST',
          agent: false,
          headers: {
            Origin: new URL(reader.url).origin,
            'Content-Type': 'application/json',
            'Content-Length': String(body.length),
          },
        },
        (answer) => {
          answer.resume()
          answer.once('end', () => resolveStatus(answer.statusCode ?? 0))
        },
      )
      request.on('error', () => resolveStatus('request failed'))
      request.write(body.subarray(0, insideTheE))
      // gstack-timing-ok: the reader reads the first part as soon as it comes, in the same process, so the pause only keeps the second part from coming with it; a part that did come with it would make the test pass without the fix, never fail with it.
      setTimeout(() => request.end(body.subarray(insideTheE)), 100)
    },
  )

  // Assert
  assert.deepEqual(
    { status, questionsAsked },
    { status: 200, questionsAsked: ['Where is the café validated?'] },
  )
})

// Value: protects=a learner whose question gets a long answer: a JSON answer has its head written before its body, and a body larger than one part was given a length after that, which Node refuses, so such an answer reached the browser as a broken connection; fails_when=an answer of the question route larger than WIKI_RESPONSE_PART_BYTES (64 KiB) does not reach the browser whole, as when the reader sets its length after its head was written; why_new=Cycle 0047 row 273 (P3TEST-16): the headersSent guard of row 230 had no test; seam=none (the reader's real answer); no_claim=a real model's answer (the answer function stands in for it)
test('a question whose answer is longer than one part of an answer reaches the browser whole', async (context) => {
  // Arrange: the one-page Wiki and an answer function whose answer is about 96 KB long, more than the 64 KiB of one part.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-long-answer-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const longAnswer = 'The source confirms it. '.repeat(4_000)
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ answer: longAnswer, citations: [], sourceChanged: false }),
  )
  context.after(() => reader.close())

  // Act
  const answer = await fetch(new URL('api/ask', reader.url), {
    method: 'POST',
    headers: {
      Origin: new URL(reader.url).origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question: 'Where is it?' }),
  }).then(
    async (response) => ({
      status: response.status,
      body: await response.json(),
    }),
    () => 'connection broken',
  )

  // Assert
  assert.deepEqual(answer, {
    status: 200,
    body: {
      answer: 'The source confirms it. '.repeat(4_000),
      citations: [],
      sourceChanged: false,
    },
  })
})

// Value: protects=the editor's extension host against requests to the question route that the reader refuses, and a request to a page by any other method than GET: each is refused by what the request itself says, and a manifest read before those checks would read and parse up to 64 MiB on the host's thread for a request refused anyway; fails_when=the reader reads the manifest for a question of another origin, a question body over WIKI_HTTP_BODY_LIMIT_BYTES, a blank question or a POST to a page, or answers one of them otherwise than with its refusal; why_new=Cycle 0047 row 273 (P3S7-G4): a manifest read moved before the question's checks survived every test; seam=the reader loaded with loadModule and a manifest reader that counts each read after the reader's start; no_claim=the time a manifest read takes (the reads are counted)
test('a question of another origin, a question too long, a blank question and a POST to a page are refused without a manifest read', async (context) => {
  // Arrange: the one-page Wiki and a manifest reader that counts each read after the reader's start.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-refused-questions-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  let isReaderStarted = false
  let manifestReadsAfterTheStart = 0
  const countingManifestReader: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: (...parameters) => {
      if (parameters[1] === 'manifest' && isReaderStarted)
        manifestReadsAfterTheStart += 1
      return readWikiFileToOpen(...parameters)
    },
  }
  const { startDeepWikiReader: startReaderCountingManifestReads } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      { './utils/readWikiFileToOpen': countingManifestReader },
      { URL },
    )
  const reader = await startReaderCountingManifestReads(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  isReaderStarted = true
  const ownOrigin = new URL(reader.url).origin
  /** Posts a body to an address of the reader from an origin, and answers the status and the body of the refusal. */
  const post = async (
    address: string,
    origin: string,
    body: string,
  ): Promise<{ status: number; body: string }> => {
    const response = await fetch(new URL(address, reader.url), {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body,
    })
    return { status: response.status, body: await response.text() }
  }

  // Act
  const otherOrigin = await post(
    'api/ask',
    'https://other.example',
    JSON.stringify({ question: 'Where is it?' }),
  )
  const tooLong = await post(
    'api/ask',
    ownOrigin,
    JSON.stringify({ question: 'a'.repeat(9_000) }),
  )
  const blank = await post(
    'api/ask',
    ownOrigin,
    JSON.stringify({ question: '   ' }),
  )
  const toAPage = await post('index.html', ownOrigin, '{}')

  // Assert
  assert.deepEqual(
    { otherOrigin, tooLong, blank, toAPage, manifestReadsAfterTheStart },
    {
      otherOrigin: {
        status: 403,
        body: '{"error":"This Wiki question must come from its reader."}',
      },
      tooLong: {
        status: 413,
        body: '{"error":"The Wiki question is too long."}',
      },
      blank: {
        status: 400,
        body: '{"error":"Enter a shorter Wiki question."}',
      },
      toAPage: {
        status: 405,
        body: '{"error":"This Wiki route only answers GET."}',
      },
      manifestReadsAfterTheStart: 0,
    },
  )
})

// Value: protects=every request of the open Wiki reader and the freshness check of an update in a checkout whose repository carries the Wiki's manifest as a link to a pipe (row 186); fails_when=the reader reads its manifest by name, which follows the link and waits for a writer that never comes; why_new=Cycle 0046 row 186; seam=none (a real named pipe, whose waiting reader the test releases when it ends)
test(
  'the reader’s manifest read does not wait on a link to a named pipe at the manifest’s path: it refuses at once and names the file',
  {
    timeout: 30_000,
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
    const refusal = await answeredAtOnce(
      readDeepWikiManifest(outputDirectory, projectRoot).then(
        () => 'read',
        (error: Error) => error.message,
      ),
      'the manifest read',
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
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=' 'sha256-IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='; object-src 'none'; base-uri 'none'",
        page: '<!doctype html><body><article><img src="x.png" onerror="fetch(\'api/ask\')"><a data-codebook-unlinked="javascript:run()">Run</a></article><script>\nthemeButton()\n</script><script src="CLIENT"></script></body>',
      },
      asset: {
        policy:
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=' 'sha256-IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='; object-src 'none'; base-uri 'none'",
        page: '<!doctype html><body><article></article><script>run()</script><script src="CLIENT"></script></body>',
      },
    },
  )
})

/** The policy every page the reader serves carries, the reader's own script's hashes included. */
const SERVED_PAGE_POLICY =
  "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=' 'sha256-IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='; object-src 'none'; base-uri 'none'"

// Value: protects=the editor's extension host, where every extension of the window stops while the Wiki reader prepares a page on the host's own thread, against a page in the Wiki folder built to make the HTML parser slow (nothing limits a page's size); fails_when=the reader prepares a page in its request handler again, so the host's event loop stands still for seconds to minutes, or it serves a page whose preparation passed the deadline, or its answer then lacks the status, the sentence, the link to this reader's overview or the page policy; why_new=Cycle 0046 second /ship PERF1 residual: pages on which parse5 itself takes time that grows with the square of the page took 13 s to over a minute for 1 MB; P2D2 the link to the overview; Cycle 0047 row 15 (P3D1): the refused page is one other than the overview, whose own refusal page has no link to itself; seam=the reader loaded with loadModule and a constants module whose WIKI_PAGE_SERVE_DEADLINE_MS is 2,000 ms; no_claim=the native editor (the test process's event loop stands for the host's)
test('a page built to make the HTML parser slow is answered within about the deadline with status 503 and a sentence for the learner under the page policy, while the event loop of the host runs on', async (context) => {
  // Arrange: a page of the Wiki of 10,000 open elements and 100,000 paragraph ends, which the parser takes about 6 s for on the development host, and a reader whose deadline is 2 s.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-slow-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'slow.html'),
    `<!doctype html><body>${'<x>'.repeat(10_000)}${'</p>'.repeat(100_000)}</body>`,
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'slow.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const { startDeepWikiReader: startReaderWithShortDeadline } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        './constants': { ...constants, WIKI_PAGE_SERVE_DEADLINE_MS: 2_000 },
      },
      { URL },
    )
  const reader = await startReaderWithShortDeadline(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 10)
  context.after(() => clearInterval(ticker))

  // Act: the page, and how long it took while a timer ticked every 10 ms.
  const started = performance.now()
  const response = await fetch(new URL('slow.html', reader.url))
  const answer = {
    status: response.status,
    type: response.headers.get('content-type'),
    policy: response.headers.get('content-security-policy'),
    // The overview's address under this reader's random prefix, written as OVERVIEW.
    body: (await response.text()).replaceAll(
      new URL(reader.url).pathname,
      'OVERVIEW',
    ),
  }
  const elapsedMs = performance.now() - started
  clearInterval(ticker)

  // Assert: the refusal, within the deadline and 2 s for the worker's start; the timer ticked through the wait (on the host's thread the page would have let it tick about never).
  assert.deepEqual(answer, {
    status: 503,
    type: 'text/html; charset=utf-8',
    policy: SERVED_PAGE_POLICY,
    body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook stopped preparing this page after 2 seconds. No page of a Wiki needs that long, so its file may have been changed by hand. Restore the page or move your change aside, then press Update LLM Wiki.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
  })
  assert.ok(elapsedMs < 4_000, `the refusal took ${elapsedMs} ms`)
  assert.ok(ticks >= 80, `the timer ticked ${ticks} times`)
})

// Value: protects=the reader's origin and the learner against a page the reader could not prepare: it must never be served as the Wiki folder holds it, with its refused addresses live; fails_when=a worker that throws or exits without the page leaves the request unanswered, answers it with the page as written, or with a JSON error instead of the sentence for the learner and the link to this reader's overview; why_new=Cycle 0046 second /ship PERF1 residual (pages are prepared on a worker thread); P2D2 the sentence that does not blame the page and the link to the overview; Cycle 0047 row 15 (P3D1): the refused page is one other than the overview, whose own refusal page has no link to itself; seam=the reader loaded with loadModule, with the page-worker module loaded so that its folder (__dirname) holds a worker script that throws
test('a page whose worker fails is answered with status 503 and a sentence for the learner under the page policy, never with the page as the folder holds it', async (context) => {
  // Arrange: a page of the Wiki with a refused link, and a reader whose page worker throws when it starts.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-failed-worker-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'hosts.html'),
    '<!doctype html><body><a href="vscode://file/etc/hosts">hosts</a></body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'hosts.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const workerFolder = await mkdtemp(
    join(tmpdir(), 'codebook-wiki-page-worker-'),
  )
  context.after(() => rm(workerFolder, { recursive: true, force: true }))
  await writeFile(
    join(workerFolder, 'wikiPageWorker.js'),
    "throw new Error('the page worker failed')",
  )
  const failingWorker = await loadModule<typeof wikiPageWorkerModule>(
    join(__dirname, '..', 'wikiPageWorker.js'),
    {},
    { __dirname: workerFolder },
  )
  const { startDeepWikiReader: startReaderWithFailingWorker } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      { './wikiPageWorker': failingWorker },
      { URL },
    )
  const reader = await startReaderWithFailingWorker(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const response = await fetch(new URL('hosts.html', reader.url))
  const answer = {
    status: response.status,
    type: response.headers.get('content-type'),
    policy: response.headers.get('content-security-policy'),
    // The overview's address under this reader's random prefix, written as OVERVIEW.
    body: (await response.text()).replaceAll(
      new URL(reader.url).pathname,
      'OVERVIEW',
    ),
  }

  // Assert
  assert.deepEqual(answer, {
    status: 503,
    type: 'text/html; charset=utf-8',
    policy: SERVED_PAGE_POLICY,
    body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook could not prepare this page for reading. Reload the page; if it is still not shown, press Update LLM Wiki.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
  })
})

// Value: protects=a learner whose page, within the page file limit (WIKI_PAGE_FILE_LIMIT_BYTES) and so maybe one the publisher wrote, needs more memory than a page worker may use: its refusal said the file was too large and may have been changed by hand, and asked for Update LLM Wiki, which renders the same page again; fails_when=a worker that ends at its heap limit (ERR_WORKER_OUT_OF_MEMORY) is answered with the sentence of a page file over the limit or of a failure, or with no refusal page, or an ordinary page is no longer served under the same limit; why_new=Cycle 0047 row 104 (the rest of RT-2); Cycle 0047 row 107 (ADV2-1) the reader runs in a child process, as a page worker at its heap limit can abort its whole process on a Node build without pointer compression; seam=a child process of this Node binary (readerAnswersInChildProcess) that loads the reader with loadModule and the real page-worker module with a constants module whose WIKI_PAGE_WORKER_HEAP_LIMIT_MB is 32 MB, so a page of 1.5 MB stands for one that needs more than the shipped 512 MB; no_claim=which pages need more than the shipped limit (the constants record measured ones)
test('a page within the file limit that needs more memory than a page worker may use is answered with 503 and a sentence that asks the editor chat to split it, while a small page is served', async (context) => {
  // Arrange: a Wiki with a dense page of 1,508,013 bytes and a small page.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-dense-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'dense.html'),
    `<body>${'<p><a href="https://example.com/x">t</a><span>u</span></p>'.repeat(26_000)}</body>`,
  )
  await writeFile(
    join(outputDirectory, 'small.html'),
    '<body><p>Small page</p></body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'dense.html' }, { path: 'small.html' }],
      assets: [],
      includedSources: [],
    }),
  )

  // Act: the reader, whose page workers may use 32 MB of heap, asked for the dense page and then the small page.
  const child = await readerAnswersInChildProcess(
    outputDirectory,
    projectRoot,
    ['dense.html', 'small.html'],
    32,
  )
  // The overview's address under the reader's random prefix is written as OVERVIEW, and the prefix itself as READER/.
  const overviewPath = child.output
    ? new URL(child.output.readerUrl).pathname
    : 'no reader'
  const prefixPath = child.output
    ? new URL('.', child.output.readerUrl).pathname
    : 'no reader'
  const [denseResponse, smallResponse] = child.output?.responses ?? []
  const dense = {
    status: denseResponse?.status,
    policy: denseResponse?.policy,
    body: denseResponse?.body.replaceAll(overviewPath, 'OVERVIEW'),
  }
  const small = {
    status: smallResponse?.status,
    body: smallResponse?.body.replaceAll(prefixPath, 'READER/'),
  }

  // Assert: the child that ran the reader ended by itself; an abort shows as the signal SIGABRT and no answer.
  assert.deepEqual(
    { exitCode: child.exitCode, signal: child.signal, dense, small },
    {
      exitCode: 0,
      signal: null,
      dense: {
        status: 503,
        policy: SERVED_PAGE_POLICY,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>This page needs more memory than Codebook gives one page to prepare it for reading. Ask the editor chat to split it into smaller pages and update the Wiki; Update LLM Wiki alone renders the same page again.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
      },
      small: {
        status: 200,
        body: '<body><p>Small page</p><script src="READER/codebook-qa.js"></script></body>',
      },
    },
  )
})

// Value: protects=the editor's extension host against a page file in the Wiki folder far larger than any page (nothing limits its size): the reader read it whole and made a string of it before the worker refused it, so its full size, gigabytes for a large file, landed in the host's memory; fails_when=the reader opens or reads a page file larger than WIKI_PAGE_FILE_LIMIT_BYTES, prepares it, or answers it otherwise than with the refusal page that says it is too large, or refuses a page within the limit; why_new=P2P2 residual (the heap limit bounds the worker, not the read before it); Cycle 0047 row 15 (P3D1): the refused page is the overview, so its refusal page has no link to itself; seam=the reader loaded with loadModule, a constants module whose WIKI_PAGE_FILE_LIMIT_BYTES is 1,000 bytes, a file system module that records which files the reader opens (through its opener that follows no link, loaded with the same file system since Cycle 0047 row 12) or reads, and a stand-in page-worker module that counts the pages it prepares; no_claim=a file that grows past the limit after its size was looked at (the read stops one byte past the limit)
test('a page file larger than the reader prepares is answered with 503 and a sentence that says so, without the file being opened, while a page within the limit is read and served', async (context) => {
  // Arrange: an overview of 2,021 bytes and a page of 33 bytes, a reader that prepares pages of 1,000 bytes at most, a file system that notes the files the reader opens or reads, and a page worker that counts its pages.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-large-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'index.html'),
    `<!doctype html><body>${'x'.repeat(2_000)}</body>`,
  )
  await writeFile(
    join(outputDirectory, 'small.html'),
    '<!doctype html><body>Small</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'small.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const filesTheReaderRead: string[] = []
  const recordingFileSystem = {
    ...fileSystemPromises,
    open: (...parameters: Parameters<typeof open>) => {
      filesTheReaderRead.push(basename(String(parameters[0])))
      return open(...parameters)
    },
    readFile: (...parameters: Parameters<typeof readFile>) => {
      filesTheReaderRead.push(basename(String(parameters[0])))
      return readFile(...parameters)
    },
  }
  const recordingOpener = await loadModule<typeof openWithoutFollowingModule>(
    join(__dirname, '..', 'utils', 'openWithoutFollowing.js'),
    { 'node:fs/promises': recordingFileSystem },
  )
  let preparedPageCount = 0
  const countingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithSmallPageLimit } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        './constants': { ...constants, WIKI_PAGE_FILE_LIMIT_BYTES: 1_000 },
        'node:fs/promises': recordingFileSystem,
        './utils/openWithoutFollowing': recordingOpener,
        './wikiPageWorker': countingWorker,
      },
      { URL },
    )
  const reader = await startReaderWithSmallPageLimit(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const overviewResponse = await fetch(reader.url)
  const overview = {
    status: overviewResponse.status,
    type: overviewResponse.headers.get('content-type'),
    policy: overviewResponse.headers.get('content-security-policy'),
    // The overview's address under this reader's random prefix, written as OVERVIEW.
    body: (await overviewResponse.text()).replaceAll(
      new URL(reader.url).pathname,
      'OVERVIEW',
    ),
  }
  const smallResponse = await fetch(new URL('small.html', reader.url))
  const small = {
    status: smallResponse.status,
    body: await smallResponse.text(),
  }

  // Assert: the overview's file was never opened, and only the small page was prepared.
  assert.deepEqual(
    { overview, small, filesTheReaderRead, preparedPageCount },
    {
      overview: {
        status: 503,
        type: 'text/html; charset=utf-8',
        policy: SERVED_PAGE_POLICY,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>This page is too large for Codebook to prepare for reading. An earlier Codebook may have published a page this large, or its file may have been changed by hand. If you changed it, restore the page or move your change aside, then press Update LLM Wiki; otherwise ask the editor chat to split it into smaller pages and update the Wiki.</p></body></html>',
      },
      small: { status: 200, body: '<p>Prepared page</p>' },
      filesTheReaderRead: ['small.html'],
      preparedPageCount: 1,
    },
  )
})

// Value: protects=the editor's extension host, in whose process two page workers run, against a page file far larger than any generated page (a few hundred kilobytes): the reader must refuse it before reading it, so neither its bytes nor its preparation (0.5 to 0.75 GB for 8 MB under the former limits, Node 24) land in the host; fails_when=WIKI_PAGE_FILE_LIMIT_BYTES is raised to 3 MB or more again (it was 8 MB), so such a page is read and prepared; why_new=Cycle 0047 row 4 (S11-F3); seam=the reader loaded with loadModule and a stand-in page-worker module that counts the pages it prepares, under the shipped limits; no_claim=the memory of the real editor hosts (VS Code, Cursor), which are measured by hand
test('a page file of 3 MB, far larger than any generated page, is refused as too large under the reader’s shipped limit and is not prepared', async (context) => {
  // Arrange: a page of 3,000,000 bytes that the manifest lists, and a page worker that counts its pages.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-3mb-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'large.html'),
    `<!doctype html><body>${'x'.repeat(2_999_972)}</body>`,
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'large.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let preparedPageCount = 0
  const countingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithCountingWorker } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      { './wikiPageWorker': countingWorker },
      { URL },
    )
  const reader = await startReaderWithCountingWorker(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const response = await fetch(new URL('large.html', reader.url))
  const answer = {
    status: response.status,
    // The overview's address under this reader's random prefix, written as OVERVIEW.
    body: (await response.text()).replaceAll(
      new URL(reader.url).pathname,
      'OVERVIEW',
    ),
  }

  // Assert
  assert.deepEqual(
    {
      answer,
      preparedPageCount,
      pageBytes: (await lstat(join(outputDirectory, 'large.html'))).size,
    },
    {
      answer: {
        status: 503,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>This page is too large for Codebook to prepare for reading. An earlier Codebook may have published a page this large, or its file may have been changed by hand. If you changed it, restore the page or move your change aside, then press Update LLM Wiki; otherwise ask the editor chat to split it into smaller pages and update the Wiki.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
      },
      preparedPageCount: 0,
      pageBytes: 3_000_000,
    },
  )
})

// Value: protects=the editor's extension host against many pages asked for at once: each page the reader holds keeps its file's bytes (up to 2 MiB, and a string of twice that) in the host until it is answered, and the reader read every page asked for, however many already waited; and every later page, once the six held pages were served; fails_when=the reader opens a page file while as many pages as the page workers prepare and let wait (six) are in hand, or answers such a page otherwise than at once with status 503 and the sentence to reload it in a moment, or a served page keeps its place after its answer, so the page asked for after six served ones is refused; why_new=Cycle 0047 row 3 (S11-X1): the bound holds before a file is read; Cycle 0047 row 192 (S2SM-U34): the page asked for after the six served ones; seam=the reader loaded with loadModule, its opener loaded with a file system that records the files it opens, and a stand-in page-worker module that holds every page until the test lets them go; no_claim=the line of the real page workers (wikiPageWorker.test.ts)
test('while six pages are in hand, a further page is refused at once with 503 and a sentence to reload it in a moment, and its file is not opened, and once the six are served a page asked for after them is served', async (context) => {
  // Arrange: a page besides the overview, an opener that notes the files it opens, and a page worker that holds every page until the test lets them go.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-pages-in-hand-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const filesTheReaderOpened: string[] = []
  const recordingOpener = await loadModule<typeof openWithoutFollowingModule>(
    join(__dirname, '..', 'utils', 'openWithoutFollowing.js'),
    {
      'node:fs/promises': {
        ...fileSystemPromises,
        open: (...parameters: Parameters<typeof open>) => {
          filesTheReaderOpened.push(basename(String(parameters[0])))
          return open(...parameters)
        },
      },
    },
  )
  let letPagesGo = (): void => {}
  const pagesMayGo = new Promise<void>((resolveGo) => {
    letPagesGo = resolveGo
  })
  let pagesInHand = 0
  let noteSixPagesInHand = (): void => {}
  const sixPagesInHand = new Promise<void>((resolveSix) => {
    noteSixPagesInHand = resolveSix
  })
  const workerHoldingPages: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      pagesInHand += 1
      if (pagesInHand === 6) noteSixPagesInHand()
      await pagesMayGo
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithPagesInHand } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      './utils/openWithoutFollowing': recordingOpener,
      './wikiPageWorker': workerHoldingPages,
    },
    { URL },
  )
  const reader = await startReaderWithPagesInHand(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held pages are let go also when the test fails, so their connections end.
  context.after(() => letPagesGo())
  const heldPages = Array.from({ length: 6 }, () =>
    fetch(reader.url).then((response) => response.text()),
  )
  await sixPagesInHand

  // Act: a seventh page, then the six held pages are let go, then a page after them.
  const further = await within(
    fetch(new URL('later.html', reader.url)).then(async (response) => ({
      status: response.status,
      // The overview's address under this reader's random prefix, written as OVERVIEW.
      body: (await response.text()).replaceAll(
        new URL(reader.url).pathname,
        'OVERVIEW',
      ),
    })),
    1_000,
  )
  letPagesGo()
  const heldAnswers = await Promise.all(heldPages)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }

  // Assert
  assert.deepEqual(
    { further, heldAnswers, after, filesTheReaderOpened },
    {
      further: {
        status: 503,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
      },
      heldAnswers: [
        '<p>Prepared page</p>',
        '<p>Prepared page</p>',
        '<p>Prepared page</p>',
        '<p>Prepared page</p>',
        '<p>Prepared page</p>',
        '<p>Prepared page</p>',
      ],
      after: { status: 200, body: '<p>Prepared page</p>' },
      filesTheReaderOpened: [
        'index.html',
        'index.html',
        'index.html',
        'index.html',
        'index.html',
        'index.html',
        'later.html',
      ],
    },
  )
})

// Value: protects=the refusal page a learner gets while six pages are in hand: it is typed as HTML and served under the page policy, as the other refusals are; fails_when=the busy refusal, which the reader now answers before it reads the manifest, loses its Content-Type or its Content-Security-Policy, so under nosniff a browser shows its text raw or it runs without the page policy; why_new=the tests of six pages in hand compare the busy refusal's status and body only; the type and the policy are compared for the deadline and failure refusals (Cycle 0047 rows 188 and 190); seam=the reader loaded with loadModule and a stand-in page-worker module that holds every page until the test lets them go; no_claim=how a real browser shows a page without a type
test('while six pages are in hand, a further page is refused with a page typed as HTML and served under the page policy', async (context) => {
  // Arrange: a page besides the overview, and a page worker that holds every page until the test lets them go.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-busy-refusal-type-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let letPagesGo = (): void => {}
  const pagesMayGo = new Promise<void>((resolveGo) => {
    letPagesGo = resolveGo
  })
  let pagesInHand = 0
  let noteSixPagesInHand = (): void => {}
  const sixPagesInHand = new Promise<void>((resolveSix) => {
    noteSixPagesInHand = resolveSix
  })
  const workerHoldingPages: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      pagesInHand += 1
      if (pagesInHand === 6) noteSixPagesInHand()
      await pagesMayGo
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithPagesInHand } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    { './wikiPageWorker': workerHoldingPages },
    { URL },
  )
  const reader = await startReaderWithPagesInHand(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held pages are let go also when the test fails, so their connections end.
  context.after(() => letPagesGo())
  const heldPages = Array.from({ length: 6 }, () =>
    fetch(reader.url).then((response) => response.text()),
  )
  await sixPagesInHand

  // Act
  const further = await within(
    fetch(new URL('later.html', reader.url)).then(async (response) => ({
      status: response.status,
      type: response.headers.get('content-type'),
      policy: response.headers.get('content-security-policy'),
      sentence: /<p>([^<]*)<\/p>/.exec(await response.text())?.[1],
    })),
    5_000,
  )
  letPagesGo()
  await Promise.all(heldPages)

  // Assert
  assert.deepEqual(further, {
    status: 503,
    type: 'text/html; charset=utf-8',
    policy: SERVED_PAGE_POLICY,
    sentence:
      'Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.',
  })
})

// Value: protects=the Wiki reader's pages after pages it could not serve: each page gives its place back once it is answered, refused or failed; fails_when=a page its worker refuses, or one whose open fails, keeps its place, so after six such pages every page is refused with "Reload the page in a moment" until the editor reloads; why_new=the test of six pages in hand lets all six be served and asks for no page after them; seam=none; no_claim=the real page workers and a real race at the open (a stand-in worker refuses six pages, a stand-in opener fails six opens with ELOOP)
test('pages that their worker refuses and pages whose open fails give their places back, so the page asked for after twelve of them is served', async (context) => {
  // Arrange: a page besides the overview; an opener whose first six opens fail, as when a link takes the path between the reader's look and its open; a page worker that refuses its first six pages and serves the pages after them.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-places-given-back-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let failedOpenCount = 0
  const openerFailingSixTimes: typeof openWithoutFollowingModule = {
    openWithoutFollowing: async (
      ...parameters: Parameters<typeof openWithoutFollowing>
    ) => {
      // The first six opens fail; every later one opens the file.
      if (failedOpenCount < 6) {
        failedOpenCount += 1
        throw Object.assign(new Error('A link took the page’s path.'), {
          code: 'ELOOP',
        })
      }
      return openWithoutFollowing(...parameters)
    },
  }
  const refusals: WikiPageRefusalReason[] = [
    'failed',
    'deadline',
    'too-large',
    'failed',
    'deadline',
    'too-large',
  ]
  let askedPageCount = 0
  const workerRefusingSixPages: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      const refusal = refusals[askedPageCount]
      askedPageCount += 1
      return refusal
        ? { state: refusal }
        : { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderRefusingPages } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      './utils/openWithoutFollowing': openerFailingSixTimes,
      './wikiPageWorker': workerRefusingSixPages,
    },
    { URL },
  )
  const reader = await startReaderRefusingPages(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act: twelve pages one after another, each answered before the next is asked for, then one more.
  const refusedStatuses: number[] = []
  // Six opens fail, then six pages are refused by the worker.
  for (let request = 0; request < 12; request += 1) {
    const response = await fetch(new URL('later.html', reader.url))
    await response.text()
    refusedStatuses.push(response.status)
  }
  const nextResponse = await fetch(new URL('later.html', reader.url))
  const next = { status: nextResponse.status, body: await nextResponse.text() }

  // Assert
  assert.deepEqual(
    { refusedStatuses, next },
    {
      refusedStatuses: [
        500, 500, 500, 500, 500, 500, 503, 503, 503, 503, 503, 503,
      ],
      next: { status: 200, body: '<p>Prepared page</p>' },
    },
  )
})

// Value: protects=the editor's extension host against many tabs restored on a large Wiki: each page request read the whole manifest and the publication identity (up to 64 MB each) before it took its place among the pages in hand, so requests beyond the six pages the reader holds kept copies of the metadata in the host past that bound; fails_when=the reader reads the manifest or the publication identity for a page request while every place is taken, or answers it otherwise than at once with status 503 and the sentence to reload it in a moment; why_new=Cycle 0047 row 190 (S2CLA-5); seam=the reader loaded with loadModule, its manifest and publication readers wrapped so they note each read, and a stand-in page-worker module that holds every page until the test lets them go; no_claim=the memory of the editor's process (the reads are counted, not measured)
test('while six pages are in hand, a further page request is refused at once with 503 and a sentence to reload it in a moment, without the manifest or the publication identity being read', async (context) => {
  // Arrange: a page besides the overview, a manifest reader and a publication reader that note each read, and a page worker that holds every page until the test lets them go.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-metadata-in-hand-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const metadataRead: string[] = []
  const notingManifestReader: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: (...parameters) => {
      metadataRead.push(`the ${parameters[1]}`)
      return readWikiFileToOpen(...parameters)
    },
  }
  const notingPublicationReader: typeof readWikiPublicationIdentityModule = {
    readWikiPublicationIdentity: (...parameters) => {
      metadataRead.push('the publication identity')
      return readWikiPublicationIdentity(...parameters)
    },
  }
  let letPagesGo = (): void => {}
  const pagesMayGo = new Promise<void>((resolveGo) => {
    letPagesGo = resolveGo
  })
  let pagesInHand = 0
  let noteSixPagesInHand = (): void => {}
  const sixPagesInHand = new Promise<void>((resolveSix) => {
    noteSixPagesInHand = resolveSix
  })
  const workerHoldingPages: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      pagesInHand += 1
      if (pagesInHand === 6) noteSixPagesInHand()
      await pagesMayGo
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderNotingMetadata } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      './utils/readWikiFileToOpen': notingManifestReader,
      './utils/readWikiPublicationIdentity': notingPublicationReader,
      './wikiPageWorker': workerHoldingPages,
    },
    { URL },
  )
  const reader = await startReaderNotingMetadata(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const readAtTheStart = metadataRead.splice(0)
  // The held pages are let go also when the test fails, so their connections end.
  context.after(() => letPagesGo())
  const heldPages = Array.from({ length: 6 }, () =>
    fetch(reader.url).then((response) => response.text()),
  )
  await sixPagesInHand
  const readForTheHeldPages = metadataRead.splice(0)

  // Act: a seventh page, then the six held pages are let go.
  const further = await within(
    fetch(new URL('later.html', reader.url)).then(async (response) => ({
      status: response.status,
      // The overview's address under this reader's random prefix, written as OVERVIEW.
      body: (await response.text()).replaceAll(
        new URL(reader.url).pathname,
        'OVERVIEW',
      ),
    })),
    1_000,
  )
  const readForTheFurtherPage = metadataRead.splice(0)
  letPagesGo()
  await Promise.all(heldPages)

  // Assert: the reader's start read the manifest, the six held pages read the publication identity once each and the manifest at least once (pages that come while a read is in flight join it, so how many reads they make between them depends on timing; Cycle 0048 task 18 pins that), and the further page neither.
  assert.deepEqual(
    {
      readAtTheStart,
      heldPagesReadTheManifest: readForTheHeldPages.includes('the manifest'),
      publicationIdentityReadsForTheHeldPages: readForTheHeldPages.filter(
        (read) => read === 'the publication identity',
      ).length,
      further,
      readForTheFurtherPage,
    },
    {
      readAtTheStart: ['the manifest'],
      heldPagesReadTheManifest: true,
      publicationIdentityReadsForTheHeldPages: 6,
      further: {
        status: 503,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
      },
      readForTheFurtherPage: [],
    },
  )
})

// Value: protects=the learner of a window whose forward goes to another host (a tunnel, a browser-based editor): the reader refuses that Host, never serves its page there, and the refusal says in a sentence that the reader answers only on this computer; fails_when=the reader accepts a forward that is not loopback as its Host, or answers it with a refusal that does not say the reader answers only on this computer; why_new=Cycle 0048 task 42 (Red Team); seam=none (the reader's real answer to a raw request with a chosen Host header); no_claim=that the editor or a tunnel can serve such a page by another route
test('a window whose forward goes to another host gets a 403 that says the reader answers only on this computer', async () => {
  // Arrange: a tunnel forwards the reader's port to tunnel.example, and the editor offers that address to the reader.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-tunnel-')),
  )
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => {
      throw new Error('No model request expected.')
    },
  )
  try {
    reader.acceptForwardedOrigin(
      `https://tunnel.example${new URL(reader.url).pathname}`,
    )

    // Act
    const answer = await askAndReadSlowly(
      reader.url,
      { Host: 'tunnel.example' },
      0,
    )

    // Assert
    assert.equal(answer.status, 403)
    assert.deepEqual(JSON.parse(String(answer.body)), {
      error:
        'The Wiki reader answers only on this computer, at its own loopback address or at the loopback address the editor forwards it to. This address is neither, so the reader shows no page.',
    })
  } finally {
    await reader.close()
    await rm(projectRoot, { recursive: true, force: true })
  }
})

/**
 * Asks the reader for an address over a connection of its own that does not read the answer, as a browser that stopped reading does: the answer fills the connection's buffers, and the reader holds the rest until the connection takes it.
 * Called by the tests of answers that their browser does not receive.
 * @param address - The reader's address to ask for.
 * @param headers - Request headers besides `Host`, such as `Sec-Fetch-Dest`.
 * @returns The connection, which reads again when the test resumes it; how many bytes of the answer it has read so far; and its end, a promise that settles with `'closed'` once the connection has closed.
 * @example
 * const browser = askWithoutReading(reader.url)
 * browser.connection.destroy()
 * await browser.closed // => 'closed'
 */
function askWithoutReading(
  address: string,
  headers: Record<string, string> = {},
): {
  connection: Socket
  receivedBytes: () => number
  closed: Promise<'closed'>
} {
  const url = new URL(address)
  let receivedBytes = 0
  const connection = connect(Number(url.port), url.hostname)
  connection.on('data', (part: Buffer) => {
    receivedBytes += part.length
  })
  // The listener above would read the answer; the connection reads nothing until the test resumes it.
  connection.pause()
  const headerLines = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join('')
  connection.write(
    `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\n${headerLines}\r\n`,
  )
  const closed = new Promise<'closed'>((resolveClosed) =>
    connection.once('close', () => resolveClosed('closed')),
  )
  // A connection the reader resets is closed with an error, which the test does not wait for.
  connection.on('error', () => undefined)
  return { connection, receivedBytes: () => receivedBytes, closed }
}

/**
 * Asks the reader for an address and reads its answer slowly but steadily, as a browser behind a slow link does: after each part of the body it receives, it stops reading for a while, so the reader can send the next part only once the connection has room again.
 * Called by the tests of answers whose browser takes longer than the send limit to receive them while it keeps reading.
 * @param address - The reader's address to ask for.
 * @param headers - Request headers, such as `Sec-Fetch-Dest`.
 * @param pauseMs - How long it stops reading after each part.
 * @returns The answer's status and its whole body; `'ended early'` as the body when the connection closed before the answer was complete.
 * @example await askAndReadSlowly(reader.url, {}, 4) // => { status: 200, body: <Buffer …> }
 */
function askAndReadSlowly(
  address: string,
  headers: Record<string, string>,
  pauseMs: number,
): Promise<{ status: number | undefined; body: Buffer | 'ended early' }> {
  return new Promise((resolveAnswer) => {
    const request = http.get(address, { headers, agent: false }, (answer) => {
      const parts: Buffer[] = []
      answer.on('data', (part: Buffer) => {
        parts.push(part)
        // The answer reads nothing more for a while, and its connection then takes nothing more either.
        answer.pause()
        setTimeout(() => answer.resume(), pauseMs)
      })
      // A connection the reader ends before the answer's end leaves the answer incomplete.
      answer.on('error', () => undefined)
      answer.once('close', () =>
        resolveAnswer({
          status: answer.statusCode,
          body: answer.complete ? Buffer.concat(parts) : 'ended early',
        }),
      )
    })
    request.on('error', () =>
      resolveAnswer({ status: undefined, body: 'ended early' }),
    )
  })
}

/**
 * Builds a `node:http` for a reader loaded with loadModule, whose server notes each request it hands the reader's request handler, each end of that handler and each close of an answer.
 * Called by the tests that wait for the reader to have taken a request in, to have ended its work for one, or to have ended an answer, which the browser does not see when it reads nothing or has gone.
 * @returns The stand-in module; a promise that settles with `'handed'` once the server has handed the reader as many requests as asked, counted from the start; one that settles with `'ended'` once as many of the reader's handlers have ended; and one that settles with `'closed'` once as many answers have closed.
 * @example
 * const server = httpNotingTheReadersRequests()
 * await server.requestsHanded(3) // => 'handed'
 * await server.handlersEnded(3)  // => 'ended'
 * await server.answersClosed(3)  // => 'closed'
 */
function httpNotingTheReadersRequests(): {
  http: Record<string, unknown>
  requestsHanded: (count: number) => Promise<'handed'>
  handlersEnded: (count: number) => Promise<'ended'>
  answersClosed: (count: number) => Promise<'closed'>
} {
  let handedCount = 0
  let endedCount = 0
  let closedCount = 0
  const waits: { isDue: () => boolean; settle: () => void }[] = []
  /** Settles every wait that is due now, and keeps the others. */
  const settleDueWaits = (): void => {
    for (const wait of waits.splice(0)) {
      if (wait.isDue()) wait.settle()
      else waits.push(wait)
    }
  }
  const createServerNotingRequests = (
    readersHandler: (
      request: http.IncomingMessage,
      response: http.ServerResponse,
    ) => unknown,
  ): http.Server =>
    http.createServer((request, response) => {
      response.once('close', () => {
        closedCount += 1
        settleDueWaits()
      })
      const handled = readersHandler(request, response)
      // The reader's handler has run up to its first wait: it has taken the request in.
      handedCount += 1
      settleDueWaits()
      void Promise.resolve(handled)
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          endedCount += 1
          settleDueWaits()
        })
    })
  return {
    http: { ...http, createServer: createServerNotingRequests },
    requestsHanded: (count) =>
      new Promise((resolveHanded) => {
        waits.push({
          isDue: () => handedCount >= count,
          settle: () => resolveHanded('handed'),
        })
        settleDueWaits()
      }),
    handlersEnded: (count) =>
      new Promise((resolveEnded) => {
        waits.push({
          isDue: () => endedCount >= count,
          settle: () => resolveEnded('ended'),
        })
        settleDueWaits()
      }),
    answersClosed: (count) =>
      new Promise((resolveClosed) => {
        waits.push({
          isDue: () => closedCount >= count,
          settle: () => resolveClosed('closed'),
        })
        settleDueWaits()
      }),
  }
}

/**
 * Loads the reader with one place for pages in hand, whose give-back the test can wait for ({@link loadReaderWithOnePlace}), and a page worker that prepares the first page as 16 MiB of text and every later page as a short one, so the first page's answer is far larger than the buffers of its connection.
 * Called by the tests of a page whose browser does not receive it.
 * @param constantOverrides - Constants the loaded reader reads instead of the shipped ones.
 * @returns The loaded reader's {@link startDeepWikiReader}, the moment the first page was prepared, and each give-back of the one place, a promise that settles with `'given back'` at the n-th (from 0).
 * @example
 * const onePlace = await loadReaderWithOnePlaceAndALargeFirstPage({})
 * await onePlace.placeGivenBack(0) // => 'given back'
 */
async function loadReaderWithOnePlaceAndALargeFirstPage(
  constantOverrides: Partial<Record<keyof typeof constants, unknown>>,
): Promise<{
  startDeepWikiReader: typeof startDeepWikiReader
  firstPagePrepared: Promise<'prepared'>
  placeGivenBack: (index: number) => Promise<'given back'>
}> {
  let noteFirstPagePrepared: (prepared: 'prepared') => void = () => undefined
  const firstPagePrepared = new Promise<'prepared'>((resolvePrepared) => {
    noteFirstPagePrepared = resolvePrepared
  })
  let preparedPageCount = 0
  const workerWithALargeFirstPage: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      if (preparedPageCount > 1)
        return { state: 'served', html: '<p>Prepared page</p>' }
      noteFirstPagePrepared('prepared')
      return { state: 'served', html: 'x'.repeat(16_777_216) }
    },
  }
  const onePlace = await loadReaderWithOnePlace(
    { './wikiPageWorker': workerWithALargeFirstPage },
    constantOverrides,
  )
  return {
    startDeepWikiReader: onePlace.startDeepWikiReader,
    firstPagePrepared,
    placeGivenBack: onePlace.placeGivenBack,
  }
}

// Value: protects=the editor's extension host against a client with the reader's address that does not read the pages it asks for: the reader gave a page's place back when it handed the page to its connection, so such a client kept page after page in the host's memory past the six pages the reader holds, across connections (Codex measured twelve held answers keeping about 24 MiB, none refused); fails_when=a page's place is given back before its answer has been received or its connection has closed, so a page asked for while the first one is still held is served instead of refused, or the place is not given back once the connection closes; why_new=Cycle 0047 row 188 (S2CXA-B1, with S2RT-2); seam=the reader loaded with loadModule, one place for pages in hand whose give-back the test waits for, a stand-in page-worker module that prepares the first page as 16 MiB of text, and a connection of the test's that does not read; no_claim=the shipped six places (one stands for them, counted the same way), and the memory of the editor's process
test('a page whose browser does not read it keeps its place until its connection closes: a page asked for meanwhile is refused at once as busy, and one asked for after the close is served', async (context) => {
  // Arrange: a page besides the overview; one place for pages in hand; the overview is prepared as 16 MiB of text and asked for by a connection that does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-unread-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const onePlace = await loadReaderWithOnePlaceAndALargeFirstPage({})
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(reader.url)
  context.after(() => browser.connection.destroy())
  const firstPage = await within(onePlace.firstPagePrepared, 2_000)
  // The reader hands the prepared page to its connection in the turn after its preparation.
  await new Promise((resolveTurn) => setImmediate(resolveTurn))

  // Act: a page while the first one is not read, then the browser's connection closes, then a page after the close.
  const meanwhileResponse = await fetch(new URL('later.html', reader.url))
  const meanwhile = {
    status: meanwhileResponse.status,
    // The overview's address under this reader's random prefix, written as OVERVIEW.
    body: (await meanwhileResponse.text()).replaceAll(
      new URL(reader.url).pathname,
      'OVERVIEW',
    ),
  }
  browser.connection.destroy()
  const firstPlace = await within(onePlace.placeGivenBack(0), 2_000)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }

  // Assert
  assert.deepEqual(
    { firstPage, meanwhile, firstPlace, after },
    {
      firstPage: 'prepared',
      meanwhile: {
        status: 503,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>Codebook is preparing as many pages as it can at once, so it did not prepare this one. Reload the page in a moment.</p><p><a href="OVERVIEW">Open the Wiki’s overview</a></p></body></html>',
      },
      firstPlace: 'given back',
      after: { status: 200, body: '<p>Prepared page</p>' },
    },
  )
})

// Value: protects=the editor's extension host against clients that ask for pages and go while the reader reads them: the reader gave a page's place back at its answer's close, which comes before the reader's work for the page has ended when the browser goes, so each gone request let a further page in while the earlier ones still read the manifest, the publication identity and the page (Codex's probe with slow reads held 12 open files and 24 MiB against the six pages the reader holds); fails_when=a page's place is given back before the reader's work for it has ended, so a page asked for while six gone pages are still read is read too, or the reader goes on to read a page whose browser went; why_new=Cycle 0047 row 228 (P2CXA-B1 = P2CLA-5), a regression of row 188's change; seam=the reader loaded with loadModule, places of a page-place module of its own, a file system whose open of the page waits until the test lets it go, a page read that is counted, a stand-in page worker, and a node:http whose server notes each end of the reader's handler; no_claim=the memory of the editor's process (the opens and reads are counted)
test('pages whose browser goes while the reader opens them keep their places until the reader has stopped: no more than six are opened at once, a page asked for meanwhile is refused as busy, no page is read after its browser went, and a page asked for after them is served', async (context) => {
  // Arrange: a page besides the overview; a file system whose open of that page waits until the test lets it go on; a count of the page reads; places of their own for the pages in hand; and a server that notes each end of the reader's handler.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-pages-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let pageOpensAsked = 0
  const openWaits: ((asked: 'open asked') => void)[] = []
  let letOpensGoOn = (): void => {}
  const opensMayGoOn = new Promise<void>((resolveGoOn) => {
    letOpensGoOn = resolveGoOn
  })
  const heldFileSystem = {
    ...fileSystemPromises,
    open: async (...parameters: Parameters<typeof open>) => {
      if (basename(String(parameters[0])) === 'later.html') {
        pageOpensAsked += 1
        for (const noteOpenAsked of openWaits.splice(0))
          noteOpenAsked('open asked')
        await opensMayGoOn
      }
      return open(...parameters)
    },
  }
  let pageReads = 0
  const countingPageRead: typeof readUpToLimitModule = {
    readUpToLimit: (...parameters) => {
      pageReads += 1
      return readUpToLimit(...parameters)
    },
  }
  const heldOpener = await loadModule<typeof openWithoutFollowingModule>(
    join(__dirname, '..', 'utils', 'openWithoutFollowing.js'),
    { 'node:fs/promises': heldFileSystem },
  )
  const placesOfTheirOwn = await loadModule<typeof takeWikiPagePlaceModule>(
    join(__dirname, '..', 'utils', 'takeWikiPagePlace.js'),
    {},
  )
  const servingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => ({
      state: 'served',
      html: '<p>Prepared page</p>',
    }),
  }
  const server = httpNotingTheReadersRequests()
  const { startDeepWikiReader: startReaderWithHeldOpens } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      'node:http': server.http,
      './utils/openWithoutFollowing': heldOpener,
      './utils/readUpToLimit': countingPageRead,
      './utils/takeWikiPagePlace': placesOfTheirOwn,
      './wikiPageWorker': servingWorker,
    },
    { URL },
  )
  const reader = await startReaderWithHeldOpens(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held opens are let go also when the test fails, so their requests end.
  context.after(() => letOpensGoOn())

  // Act: twelve tabs one after another, each closed once the reader opens its page or once it is answered; then the opens go on; then a page after them.
  const answers: (number | 'request gone')[] = []
  for (let tab = 0; tab < 12; tab += 1) {
    const pageOpened = new Promise<'open asked'>((resolveAsked) =>
      openWaits.push(resolveAsked),
    )
    const browserTab = new AbortController()
    const answer = fetch(new URL('later.html', reader.url), {
      signal: browserTab.signal,
    }).then(
      async (response) => {
        await response.text()
        return response.status
      },
      () => 'request gone' as const,
    )
    await Promise.race([pageOpened, answer])
    browserTab.abort()
    answers.push(await answer)
  }
  const pageOpensAskedWhileHeld = pageOpensAsked
  letOpensGoOn()
  const handlersOfTheTwelve = await within(server.handlersEnded(12), 2_000)
  const pageReadsOfTheTwelve = pageReads
  const nextResponse = await fetch(new URL('later.html', reader.url))
  const next = { status: nextResponse.status, body: await nextResponse.text() }

  // Assert
  assert.deepEqual(
    {
      answers,
      pageOpensAskedWhileHeld,
      handlersOfTheTwelve,
      pageReadsOfTheTwelve,
      next,
    },
    {
      answers: [
        'request gone',
        'request gone',
        'request gone',
        'request gone',
        'request gone',
        'request gone',
        503,
        503,
        503,
        503,
        503,
        503,
      ],
      pageOpensAskedWhileHeld: 6,
      handlersOfTheTwelve: 'ended',
      pageReadsOfTheTwelve: 0,
      next: { status: 200, body: '<p>Prepared page</p>' },
    },
  )
})

/** A read the reader makes for a page, as the tests of a page whose browser goes during one name it. */
type PageRead =
  | 'the manifest'
  | 'the page’s look'
  | 'the publication identity'
  | 'the page’s open'

/**
 * Loads the reader with every read it makes for the overview noted in order (the manifest after the reader's start, the look at the page's size, the publication identity and the open of the page's file), one of them held until the test lets it go on, places for pages in hand of its own, and a node:http whose server notes each close of an answer and each end of the reader's handler.
 * Called by the tests of a page whose browser goes while the reader reads for it.
 * @param heldRead - The read that waits until the test lets it go on.
 * @returns The loaded reader's {@link startDeepWikiReader}, after whose start the manifest reads are noted; the reads noted so far; a promise that settles with `'asked'` once the held read was asked; the step that lets it go on; and the server's waits.
 * @example
 * const held = await loadReaderHoldingAPageRead('the manifest')
 * await held.readAsked // => 'asked'
 * held.reads()         // => ['the manifest']
 */
async function loadReaderHoldingAPageRead(
  heldRead: Exclude<PageRead, 'the page’s open'>,
): Promise<{
  startDeepWikiReader: typeof startDeepWikiReader
  reads: () => PageRead[]
  readAsked: Promise<'asked'>
  letTheReadGoOn: () => void
  answersClosed: (count: number) => Promise<'closed'>
  handlersEnded: (count: number) => Promise<'ended'>
}> {
  let isReaderStarted = false
  const reads: PageRead[] = []
  let noteReadAsked: (asked: 'asked') => void = () => undefined
  const readAsked = new Promise<'asked'>((resolveAsked) => {
    noteReadAsked = resolveAsked
  })
  let letTheReadGoOn = (): void => {}
  const readMayGoOn = new Promise<void>((resolveGoOn) => {
    letTheReadGoOn = resolveGoOn
  })
  /** Notes a read, and holds it when it is the held one. */
  const noteRead = async (read: PageRead): Promise<void> => {
    reads.push(read)
    if (read !== heldRead) return
    noteReadAsked('asked')
    await readMayGoOn
  }
  const notingManifestReader: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: async (...parameters) => {
      // The reader's start reads the manifest as always.
      if (parameters[1] === 'manifest' && isReaderStarted)
        await noteRead('the manifest')
      return readWikiFileToOpen(...parameters)
    },
  }
  const fileSystemNotingThePagesLook = {
    ...fileSystemPromises,
    lstat: async (...parameters: Parameters<typeof lstat>) => {
      if (basename(String(parameters[0])) === 'index.html')
        await noteRead('the page’s look')
      return lstat(...parameters)
    },
  }
  const notingPublicationReader: typeof readWikiPublicationIdentityModule = {
    readWikiPublicationIdentity: async (...parameters) => {
      await noteRead('the publication identity')
      return readWikiPublicationIdentity(...parameters)
    },
  }
  const openerNotingThePagesOpen: typeof openWithoutFollowingModule = {
    openWithoutFollowing: async (
      ...parameters: Parameters<typeof openWithoutFollowing>
    ) => {
      if (basename(parameters[0]) === 'index.html')
        reads.push('the page’s open')
      return openWithoutFollowing(...parameters)
    },
  }
  const placesOfTheirOwn = await loadModule<typeof takeWikiPagePlaceModule>(
    join(__dirname, '..', 'utils', 'takeWikiPagePlace.js'),
    {},
  )
  const servingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => ({
      state: 'served',
      html: '<p>Prepared page</p>',
    }),
  }
  const server = httpNotingTheReadersRequests()
  const loaded = await loadModule<typeof deepWikiReaderModule>(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      'node:fs/promises': fileSystemNotingThePagesLook,
      'node:http': server.http,
      './utils/openWithoutFollowing': openerNotingThePagesOpen,
      './utils/readWikiFileToOpen': notingManifestReader,
      './utils/readWikiPublicationIdentity': notingPublicationReader,
      './utils/takeWikiPagePlace': placesOfTheirOwn,
      './wikiPageWorker': servingWorker,
    },
    { URL },
  )
  return {
    startDeepWikiReader: async (...parameters) => {
      const reader = await loaded.startDeepWikiReader(...parameters)
      isReaderStarted = true
      return reader
    },
    reads: () => [...reads],
    readAsked,
    letTheReadGoOn,
    answersClosed: server.answersClosed,
    handlersEnded: server.handlersEnded,
  }
}

// Value: protects=the editor's extension host against clients that ask for pages and go while the reader reads the manifest for them: the reader stops after the read in hand once a page's browser has gone, so a gone request holds its place only while that read ends; fails_when=the reader goes on to look at the page's file after the manifest read of a page whose browser went; why_new=Cycle 0047 row 273 (P3TEST-18): of the four stops of row 228 only the one after the page's open had a test; seam=the reader loaded with loadModule, every read for the page noted and the manifest read held (loadReaderHoldingAPageRead); no_claim=a real browser's close timing
test('a page whose browser goes while the reader reads the manifest for it gets nothing more read once that read ends', async (context) => {
  // Arrange: the one-page Wiki and a reader whose manifest reads after its start wait until the test lets them go on.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-at-manifest-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const held = await loadReaderHoldingAPageRead('the manifest')
  const reader = await held.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held read is let go also when the test fails, so its request ends.
  context.after(() => held.letTheReadGoOn())
  const browserTab = new AbortController()
  const opening = fetch(reader.url, { signal: browserTab.signal }).then(
    () => 'answered',
    () => 'request gone',
  )
  const readAsked = await within(held.readAsked, 2_000)

  // Act: the tab goes while the manifest is read; once the page's answer has closed, the read goes on.
  browserTab.abort()
  const tab = await opening
  const pageAnswer = await within(held.answersClosed(1), 2_000)
  held.letTheReadGoOn()
  const pageHandler = await within(held.handlersEnded(1), 2_000)

  // Assert
  assert.deepEqual(
    { readAsked, tab, pageAnswer, pageHandler, reads: held.reads() },
    {
      readAsked: 'asked',
      tab: 'request gone',
      pageAnswer: 'closed',
      pageHandler: 'ended',
      reads: ['the manifest'],
    },
  )
})

// Value: protects=the editor's extension host against clients that ask for pages and go while the reader looks at a page's file: the reader stops after the read in hand once a page's browser has gone; fails_when=the reader goes on to read the publication identity after the look of a page whose browser went; why_new=Cycle 0047 row 273 (P3TEST-18): of the four stops of row 228 only the one after the page's open had a test; seam=the reader loaded with loadModule, every read for the page noted and the look at the page's size held (loadReaderHoldingAPageRead); no_claim=a real browser's close timing
test('a page whose browser goes while the reader looks at its file gets nothing more read once that look ends', async (context) => {
  // Arrange: the one-page Wiki and a reader whose look at the overview's size waits until the test lets it go on.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-at-look-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const held = await loadReaderHoldingAPageRead('the page’s look')
  const reader = await held.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held look is let go also when the test fails, so its request ends.
  context.after(() => held.letTheReadGoOn())
  const browserTab = new AbortController()
  const opening = fetch(reader.url, { signal: browserTab.signal }).then(
    () => 'answered',
    () => 'request gone',
  )
  const readAsked = await within(held.readAsked, 2_000)

  // Act: the tab goes while the page's file is looked at; once the page's answer has closed, the look goes on.
  browserTab.abort()
  const tab = await opening
  const pageAnswer = await within(held.answersClosed(1), 2_000)
  held.letTheReadGoOn()
  const pageHandler = await within(held.handlersEnded(1), 2_000)

  // Assert
  assert.deepEqual(
    { readAsked, tab, pageAnswer, pageHandler, reads: held.reads() },
    {
      readAsked: 'asked',
      tab: 'request gone',
      pageAnswer: 'closed',
      pageHandler: 'ended',
      reads: ['the manifest', 'the page’s look'],
    },
  )
})

// Value: protects=the editor's extension host against clients that ask for pages and go while the reader reads the publication identity for them: the reader stops after the read in hand once a page's browser has gone; fails_when=the reader goes on to open the page's file after the publication identity of a page whose browser went; why_new=Cycle 0047 row 273 (P3TEST-18): of the four stops of row 228 only the one after the page's open had a test; seam=the reader loaded with loadModule, every read for the page noted and the publication identity's read held (loadReaderHoldingAPageRead); no_claim=a real browser's close timing
test('a page whose browser goes while the reader reads the publication identity for it is not opened once that read ends', async (context) => {
  // Arrange: the one-page Wiki and a reader whose read of the publication identity waits until the test lets it go on.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-at-identity-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const held = await loadReaderHoldingAPageRead('the publication identity')
  const reader = await held.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held read is let go also when the test fails, so its request ends.
  context.after(() => held.letTheReadGoOn())
  const browserTab = new AbortController()
  const opening = fetch(reader.url, { signal: browserTab.signal }).then(
    () => 'answered',
    () => 'request gone',
  )
  const readAsked = await within(held.readAsked, 2_000)

  // Act: the tab goes while the publication identity is read; once the page's answer has closed, the read goes on.
  browserTab.abort()
  const tab = await opening
  const pageAnswer = await within(held.answersClosed(1), 2_000)
  held.letTheReadGoOn()
  const pageHandler = await within(held.handlersEnded(1), 2_000)

  // Assert
  assert.deepEqual(
    { readAsked, tab, pageAnswer, pageHandler, reads: held.reads() },
    {
      readAsked: 'asked',
      tab: 'request gone',
      pageAnswer: 'closed',
      pageHandler: 'ended',
      reads: ['the manifest', 'the page’s look', 'the publication identity'],
    },
  )
})

// Value: protects=the editor's extension host and every later page against a browser that stops reading its page and keeps its connection open: no answer of the reader had a send limit, so such a page kept its bytes in the host and its place among the pages in hand for as long as its connection lived; fails_when=a page whose answer is not received within WIKI_RESPONSE_SEND_LIMIT_MS is not ended, so its place stays taken and every later page is refused as busy, or its place is given back while its answer is still held; why_new=Cycle 0047 row 188 (S2CXA-B1, with S2RT-2); seam=the reader loaded with loadModule, a send limit of 1.5 s, one place for pages in hand whose give-back the test waits for, a stand-in page-worker module that prepares the first page as 16 MiB of text, and a connection of the test's that does not read until the test resumes it; no_claim=the shipped send limit of 30 s and the shipped six places
test('a page whose browser stops reading is ended at the send limit and gives its place back: a page asked for before is refused as busy, one asked for after is served, and the browser receives less than the page', async (context) => {
  // Arrange: a page besides the overview; a send limit of 1.5 s and one place for pages in hand; the overview is prepared as 16 MiB of text and asked for by a connection that does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-stalled-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const onePlace = await loadReaderWithOnePlaceAndALargeFirstPage({
    WIKI_RESPONSE_SEND_LIMIT_MS: 1_500,
  })
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(reader.url)
  context.after(() => browser.connection.destroy())
  const firstPage = await within(onePlace.firstPagePrepared, 2_000)
  // The reader hands the prepared page to its connection in the turn after its preparation.
  await new Promise((resolveTurn) => setImmediate(resolveTurn))

  // Act: a page before the send limit, the first page's place at the limit, a page after it; then the browser reads what its connection still holds.
  // gstack-timing-ok: the refusal of a page over loopback takes milliseconds, far within the send limit of 1.5 s, and the limit ends the first page whatever the timing.
  const beforeResponse = await fetch(new URL('later.html', reader.url))
  const before = { status: beforeResponse.status }
  await beforeResponse.text()
  const firstPlace = await within(onePlace.placeGivenBack(0), 5_000)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }
  browser.connection.resume()
  const browserConnection = await within(browser.closed, 3_000)

  // Assert: the browser received less than the 16 MiB of the page before its connection closed.
  assert.deepEqual(
    {
      firstPage,
      before,
      firstPlace,
      after,
      browserConnection,
      receivedLessThanThePage: browser.receivedBytes() < 16_777_216,
    },
    {
      firstPage: 'prepared',
      before: { status: 503 },
      firstPlace: 'given back',
      after: { status: 200, body: '<p>Prepared page</p>' },
      browserConnection: 'closed',
      receivedLessThanThePage: true,
    },
  )
})

/**
 * Loads the reader with one place for pages in hand, whose give-backs the test can wait for, and with the modules the test hands it instead of the real ones, such as a page worker and a refusal page.
 * Called by the tests of the places of pages answered with a refusal, and by {@link loadReaderWithOnePlaceAndALargeFirstPage}.
 * @param dependencies - Modules the loaded reader requires instead of the real ones.
 * @param constantOverrides - Constants the loaded reader reads instead of the shipped ones.
 * @returns The loaded reader's {@link startDeepWikiReader}, and each give-back of the one place, a promise that settles with `'given back'` at the n-th (from 0).
 * @example
 * const onePlace = await loadReaderWithOnePlace({ './wikiPageWorker': worker }, {})
 * await onePlace.placeGivenBack(0) // => 'given back'
 */
async function loadReaderWithOnePlace(
  dependencies: Record<string, unknown>,
  constantOverrides: Partial<Record<keyof typeof constants, unknown>>,
): Promise<{
  startDeepWikiReader: typeof startDeepWikiReader
  placeGivenBack: (index: number) => Promise<'given back'>
}> {
  const onePlace = await loadModule<typeof takeWikiPagePlaceModule>(
    join(__dirname, '..', 'utils', 'takeWikiPagePlace.js'),
    {
      '../constants': {
        ...constants,
        WIKI_PAGE_WORKER_CONCURRENCY_LIMIT: 1,
        WIKI_PAGE_WAITING_LIMIT: 0,
      },
    },
  )
  const giveBacks: {
    givenBack: Promise<'given back'>
    noteGivenBack: (givenBack: 'given back') => void
  }[] = []
  /** The n-th give-back, made when the test asks for it or when the place is taken, whichever comes first. */
  const giveBackAt = (index: number): (typeof giveBacks)[number] => {
    for (;;) {
      const known = giveBacks[index]
      if (known) return known
      let noteGivenBack: (givenBack: 'given back') => void = () => undefined
      const givenBack = new Promise<'given back'>((resolveGivenBack) => {
        noteGivenBack = resolveGivenBack
      })
      giveBacks.push({ givenBack, noteGivenBack })
    }
  }
  let placesTaken = 0
  const placesNotingTheirGiveBack: typeof takeWikiPagePlaceModule = {
    takeWikiPagePlace: () => {
      const givePlaceBack = onePlace.takeWikiPagePlace()
      if (!givePlaceBack) return undefined
      const { noteGivenBack } = giveBackAt(placesTaken)
      placesTaken += 1
      return (): void => {
        givePlaceBack()
        noteGivenBack('given back')
      }
    },
  }
  const loaded = await loadModule<typeof deepWikiReaderModule>(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      ...dependencies,
      './constants': { ...constants, ...constantOverrides },
      './utils/takeWikiPagePlace': placesNotingTheirGiveBack,
    },
    { URL },
  )
  return {
    startDeepWikiReader: loaded.startDeepWikiReader,
    placeGivenBack: (index) => giveBackAt(index).givenBack,
  }
}

/**
 * Builds a refusal page module whose first refusal page is 16 MiB of text, far larger than the buffers of a connection, and whose later ones are the reader's own.
 * Called by the tests of refusals that their browser does not receive.
 * @returns The stand-in module, and a promise that settles with `'refused'` once the large refusal page was made.
 * @example
 * const refusals = refusalsWithALargeFirst()
 * await refusals.largeRefusalMade // => 'refused'
 */
function refusalsWithALargeFirst(): {
  module: typeof wikiPageRefusalHtmlModule
  largeRefusalMade: Promise<'refused'>
} {
  let noteLargeRefusal: (refused: 'refused') => void = () => undefined
  const largeRefusalMade = new Promise<'refused'>((resolveRefused) => {
    noteLargeRefusal = resolveRefused
  })
  let refusalCount = 0
  return {
    module: {
      wikiPageRefusalHtml: (...parameters) => {
        refusalCount += 1
        if (refusalCount > 1) return wikiPageRefusalHtml(...parameters)
        noteLargeRefusal('refused')
        return 'x'.repeat(16_777_216)
      },
    },
    largeRefusalMade,
  }
}

// Value: protects=the pages after a page whose tab goes while the reader prepares it: its preparation is stopped and it is refused, and its place must come back once the reader has stopped, or every later page is refused as busy until the editor reloads; fails_when=the place of a page refused after its tab went is not given back at the later of its answer's close and the reader's end of work, so a page asked for after it is refused; why_new=Cycle 0047 row 232 (state-machine cell: a refusal after the place × the connection closes first); seam=the reader loaded with loadModule, one place for pages in hand whose give-back the test waits for, and a stand-in page-worker module that answers the first page only when its request goes and serves every later one; no_claim=the shipped six places (one stands for them, counted the same way)
test('a page whose tab goes while it is prepared gives its place back once the reader has stopped, so the page asked for after it is served', async (context) => {
  // Arrange: a page besides the overview; one place for pages in hand; a page worker that answers the first page only when its request goes.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-refused-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let notePreparationStarted: (started: 'started') => void = () => undefined
  const preparationStarted = new Promise<'started'>((resolveStarted) => {
    notePreparationStarted = resolveStarted
  })
  let preparedPageCount = 0
  const workerAnsweringTheFirstPageAtAbort: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: (_html, _options, limits) =>
      new Promise((resolvePage) => {
        preparedPageCount += 1
        if (preparedPageCount > 1) {
          resolvePage({ state: 'served', html: '<p>Prepared page</p>' })
          return
        }
        limits.signal.addEventListener(
          'abort',
          () => resolvePage({ state: 'failed' }),
          { once: true },
        )
        notePreparationStarted('started')
      }),
  }
  const onePlace = await loadReaderWithOnePlace(
    { './wikiPageWorker': workerAnsweringTheFirstPageAtAbort },
    {},
  )
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browserTab = new AbortController()
  const opening = fetch(reader.url, { signal: browserTab.signal }).catch(
    () => 'request gone',
  )
  const firstPage = await within(preparationStarted, 2_000)

  // Act: the tab goes while the page is prepared; then a page after it.
  browserTab.abort()
  await opening
  const firstPlace = await within(onePlace.placeGivenBack(0), 2_000)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }

  // Assert
  assert.deepEqual(
    { firstPage, firstPlace, after },
    {
      firstPage: 'started',
      firstPlace: 'given back',
      after: { status: 200, body: '<p>Prepared page</p>' },
    },
  )
})

// Value: protects=the pages after a page refused to a browser that stops reading its refusal page: the refusal holds its place until its answer is received or ended, and the send limit must end it and give the place back; fails_when=a refusal page whose browser takes nothing is not ended at WIKI_RESPONSE_SEND_LIMIT_MS, or its place is not given back once it is, so every later page is refused as busy; why_new=Cycle 0047 row 232 (state-machine cell: a refusal after the place × the send limit); seam=the reader loaded with loadModule, a send limit of 1 s, one place for pages in hand whose give-back the test waits for, a stand-in page-worker module that refuses the first page and serves every later one, a refusal page module whose first page is 16 MiB of text, and a connection of the test's that does not read until the test resumes it; no_claim=the shipped send limit of 30 s and the shipped six places
test('a refusal page whose browser stops reading is ended at the send limit and gives its place back, so the page asked for after it is served', async (context) => {
  // Arrange: a page besides the overview; a send limit of 1 s and one place for pages in hand; a worker that refuses the first page, whose refusal page is 16 MiB, asked for by a connection that does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-stalled-refusal-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let preparedPageCount = 0
  const workerRefusingTheFirstPage: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      return preparedPageCount > 1
        ? { state: 'served', html: '<p>Prepared page</p>' }
        : { state: 'failed' }
    },
  }
  const refusals = refusalsWithALargeFirst()
  const onePlace = await loadReaderWithOnePlace(
    {
      './wikiPageWorker': workerRefusingTheFirstPage,
      './utils/wikiPageRefusalHtml': refusals.module,
    },
    { WIKI_RESPONSE_SEND_LIMIT_MS: 1_000 },
  )
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(reader.url)
  context.after(() => browser.connection.destroy())
  const firstPage = await within(refusals.largeRefusalMade, 2_000)

  // Act: the first page's place at the send limit, then a page after it; then the browser reads what its connection still holds.
  const firstPlace = await within(onePlace.placeGivenBack(0), 5_000)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }
  browser.connection.resume()
  const browserConnection = await within(browser.closed, 3_000)

  // Assert: the browser received less than the 16 MiB of the refusal page before its connection closed.
  assert.deepEqual(
    {
      firstPage,
      firstPlace,
      after,
      browserConnection,
      receivedLessThanTheRefusal: browser.receivedBytes() < 16_777_216,
    },
    {
      firstPage: 'refused',
      firstPlace: 'given back',
      after: { status: 200, body: '<p>Prepared page</p>' },
      browserConnection: 'closed',
      receivedLessThanTheRefusal: true,
    },
  )
})

// Value: protects=the bound of the pages in hand against a page refused as busy whose connection closes before its refusal page is received: no place was taken for it, so none may come back, or each such refusal would let one more page in past the bound; and none may stay taken, or the pages after the ones in hand would be refused for good; fails_when=a busy refusal gives a place back when its connection closes, so a page asked for while the pages in hand still hold every place is served, or keeps one, so the page asked for after them is refused; why_new=Cycle 0047 row 232 (state-machine cell: a busy refusal × the connection closes first); seam=the reader loaded with loadModule, one place for pages in hand, a stand-in page-worker module that holds the first page until the test lets it go, a refusal page module whose first page is 16 MiB of text, a node:http whose server notes each close of an answer, and a connection of the test's that does not read; no_claim=the shipped six places
test('a busy refusal whose connection closes before it is received gives no place back: a page asked for after it is still refused while the page in hand holds the place, and one asked for after that page is served', async (context) => {
  // Arrange: a page besides the overview; one place for pages in hand, held by the overview, whose preparation waits until the test lets it go; the busy refusal page is 16 MiB.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-busy-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let notePageInHand: (inHand: 'in hand') => void = () => undefined
  const pageInHand = new Promise<'in hand'>((resolveInHand) => {
    notePageInHand = resolveInHand
  })
  let letPageGo = (): void => {}
  const pageMayGo = new Promise<void>((resolveGo) => {
    letPageGo = resolveGo
  })
  let preparedPageCount = 0
  const workerHoldingTheFirstPage: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      if (preparedPageCount === 1) {
        notePageInHand('in hand')
        await pageMayGo
      }
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const refusals = refusalsWithALargeFirst()
  const server = httpNotingTheReadersRequests()
  const onePlace = await loadReaderWithOnePlace(
    {
      'node:http': server.http,
      './wikiPageWorker': workerHoldingTheFirstPage,
      './utils/wikiPageRefusalHtml': refusals.module,
    },
    {},
  )
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held page is let go also when the test fails, so its connection ends.
  context.after(() => letPageGo())
  const held = fetch(reader.url).then((response) => response.text())
  const firstPage = await within(pageInHand, 2_000)
  const browser = askWithoutReading(new URL('later.html', reader.url).href)
  context.after(() => browser.connection.destroy())
  const busyRefusal = await within(refusals.largeRefusalMade, 2_000)

  // Act: the busy refusal's connection closes; then a page while the first one is in hand; then the first page is let go, and a page after it.
  browser.connection.destroy()
  const busyAnswer = await within(server.answersClosed(1), 2_000)
  const meanwhileResponse = await fetch(new URL('later.html', reader.url))
  const meanwhile = { status: meanwhileResponse.status }
  await meanwhileResponse.text()
  letPageGo()
  const heldPage = await within(held, 2_000)
  const firstPlace = await within(onePlace.placeGivenBack(0), 2_000)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }

  // Assert
  assert.deepEqual(
    {
      firstPage,
      busyRefusal,
      busyAnswer,
      meanwhile,
      heldPage,
      firstPlace,
      after,
    },
    {
      firstPage: 'in hand',
      busyRefusal: 'refused',
      busyAnswer: 'closed',
      meanwhile: { status: 503 },
      heldPage: '<p>Prepared page</p>',
      firstPlace: 'given back',
      after: { status: 200, body: '<p>Prepared page</p>' },
    },
  )
})

// Value: protects=the bound of the pages in hand against a page refused as busy to a browser that stops reading its refusal page: the send limit ends that refusal, and no place was taken for it, so none may come back, or each such refusal would let one more page in past the bound; and none may stay taken, or the pages after the ones in hand would be refused for good; fails_when=a busy refusal ended at the send limit gives a place back, so a page asked for while the pages in hand still hold every place is served, or keeps one, so the page asked for after them is refused, or the refusal is not ended at the send limit; why_new=Cycle 0047 row 232 (state-machine cell: a busy refusal × the send limit); seam=the reader loaded with loadModule, a send limit of 1 s, one place for pages in hand, a stand-in page-worker module that holds the first page until the test lets it go, a refusal page module whose first page is 16 MiB of text, a node:http whose server notes each close of an answer, and a connection of the test's that does not read until the test resumes it; no_claim=the shipped send limit of 30 s and the shipped six places
test('a busy refusal whose browser stops reading is ended at the send limit and gives no place back: a page asked for after it is still refused while the page in hand holds the place, and one asked for after that page is served', async (context) => {
  // Arrange: a page besides the overview; a send limit of 1 s and one place for pages in hand, held by the overview, whose preparation waits until the test lets it go; the busy refusal page is 16 MiB, asked for by a connection that does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-stalled-busy-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  let notePageInHand: (inHand: 'in hand') => void = () => undefined
  const pageInHand = new Promise<'in hand'>((resolveInHand) => {
    notePageInHand = resolveInHand
  })
  let letPageGo = (): void => {}
  const pageMayGo = new Promise<void>((resolveGo) => {
    letPageGo = resolveGo
  })
  let preparedPageCount = 0
  const workerHoldingTheFirstPage: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      if (preparedPageCount === 1) {
        notePageInHand('in hand')
        await pageMayGo
      }
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const refusals = refusalsWithALargeFirst()
  const server = httpNotingTheReadersRequests()
  const onePlace = await loadReaderWithOnePlace(
    {
      'node:http': server.http,
      './wikiPageWorker': workerHoldingTheFirstPage,
      './utils/wikiPageRefusalHtml': refusals.module,
    },
    { WIKI_RESPONSE_SEND_LIMIT_MS: 1_000 },
  )
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held page is let go also when the test fails, so its connection ends.
  context.after(() => letPageGo())
  const held = fetch(reader.url).then((response) => response.text())
  const firstPage = await within(pageInHand, 2_000)
  const browser = askWithoutReading(new URL('later.html', reader.url).href)
  context.after(() => browser.connection.destroy())
  const busyRefusal = await within(refusals.largeRefusalMade, 2_000)

  // Act: the busy refusal at the send limit; then a page while the first one is in hand; then the first page is let go, and a page after it; then the browser reads what its connection still holds.
  const busyAnswer = await within(server.answersClosed(1), 5_000)
  const meanwhileResponse = await fetch(new URL('later.html', reader.url))
  const meanwhile = { status: meanwhileResponse.status }
  await meanwhileResponse.text()
  letPageGo()
  const heldPage = await within(held, 2_000)
  const firstPlace = await within(onePlace.placeGivenBack(0), 2_000)
  const afterResponse = await fetch(new URL('later.html', reader.url))
  const after = {
    status: afterResponse.status,
    body: await afterResponse.text(),
  }
  browser.connection.resume()
  const browserConnection = await within(browser.closed, 3_000)

  // Assert: the browser received less than the 16 MiB of the busy refusal before its connection closed.
  assert.deepEqual(
    {
      firstPage,
      busyRefusal,
      busyAnswer,
      meanwhile,
      heldPage,
      firstPlace,
      after,
      browserConnection,
      receivedLessThanTheRefusal: browser.receivedBytes() < 16_777_216,
    },
    {
      firstPage: 'in hand',
      busyRefusal: 'refused',
      busyAnswer: 'closed',
      meanwhile: { status: 503 },
      heldPage: '<p>Prepared page</p>',
      firstPlace: 'given back',
      after: { status: 200, body: '<p>Prepared page</p>' },
      browserConnection: 'closed',
      receivedLessThanTheRefusal: true,
    },
  )
})

// Value: protects=the editor's extension host and its open files against a browser that stops reading a file of the Wiki: the reader sent such a file for as long as its connection lived; fails_when=an answer that sends a file of the Wiki is not ended once its connection has taken nothing for WIKI_RESPONSE_SEND_LIMIT_MS, so the connection stays, or the file is left open at the answer's end; why_new=Cycle 0047 row 188 (S2CXA-B1, with S2RT-2); Cycle 0047 row 230 (P2CLA-8): the reader opens the file for each part only, so its close no longer marks the limit, and the answer's close is waited for instead; seam=the reader loaded with loadModule, a send limit of 500 ms, an opener that counts the image's opens and closes, a node:http whose server notes each close of an answer, and a connection of the test's that does not read until the test resumes it; no_claim=the shipped send limit of 30 s
test('an image of the Wiki whose browser stops reading is ended at the send limit, and its file is closed', async (context) => {
  // Arrange: an image of 16 MiB that the manifest names, an opener that counts the image's opens and closes, a send limit of 500 ms, and a connection that asks for the image and does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-stalled-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'diagram.png'),
    Buffer.alloc(16_777_216, 'diagram '),
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const server = httpNotingTheReadersRequests()
  const watched = await loadReaderWatchingOpensOf(
    'diagram.png',
    { WIKI_RESPONSE_SEND_LIMIT_MS: 500 },
    { 'node:http': server.http },
  )
  const reader = await watched.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(new URL('diagram.png', reader.url).href, {
    'Sec-Fetch-Dest': 'image',
  })
  context.after(() => browser.connection.destroy())

  // Act: the image's answer at the send limit; then the browser reads what its connection still holds.
  const imageAnswer = await within(server.answersClosed(1), 3_000)
  const openImageFiles = watched.openFiles()
  browser.connection.resume()
  const browserConnection = await within(browser.closed, 3_000)

  // Assert: the browser received less than the 16 MiB of the image before its connection closed.
  assert.deepEqual(
    {
      imageAnswer,
      openImageFiles,
      browserConnection,
      receivedLessThanTheImage: browser.receivedBytes() < 16_777_216,
    },
    {
      imageAnswer: 'closed',
      openImageFiles: 0,
      browserConnection: 'closed',
      receivedLessThanTheImage: true,
    },
  )
})

// Value: protects=the editor's extension host and every later page against a client that stops reading an answer but keeps sending bytes on its connection: the send limit counts only the parts of the answer that its connection takes as progress, so bytes the client sends do not keep the answer in the host; fails_when=the send limit counts any activity of the connection as progress, as Node's idle timeout of a socket (response.setTimeout) does, so a client that sends a byte now and then keeps its answer past WIKI_RESPONSE_SEND_LIMIT_MS; why_new=Cycle 0047 row 275 (P3SIMP-2): the idle timeout proposed for the send limit kept such an answer open (a probe: still open 3 s after a limit of 500 ms), so the reader keeps its own limit; seam=the reader loaded with loadModule, a send limit of 500 ms, a node:http whose server notes each close of an answer, and a connection of the test's that does not read and sends one byte of a further request's header every 100 ms; no_claim=the shipped send limit of 30 s
test('an image of the Wiki whose browser stops reading but keeps sending bytes is still ended at the send limit', async (context) => {
  // Arrange: an image of 16 MiB that the manifest names, a send limit of 500 ms, and a connection that asks for the image, does not read it and sends one byte of a further request's header every 100 ms.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-sending-client-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'diagram.png'),
    Buffer.alloc(16_777_216, 'diagram '),
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const server = httpNotingTheReadersRequests()
  const { startDeepWikiReader: startReaderWithASendLimit } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      './constants': { ...constants, WIKI_RESPONSE_SEND_LIMIT_MS: 500 },
      'node:http': server.http,
    },
    { URL },
  )
  const reader = await startReaderWithASendLimit(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(new URL('diagram.png', reader.url).href, {
    'Sec-Fetch-Dest': 'image',
  })
  context.after(() => browser.connection.destroy())
  browser.connection.write(
    `GET ${new URL(reader.url).pathname} HTTP/1.1\r\nHost: ${new URL(reader.url).host}\r\nX-Waiting: `,
  )
  const sending = setInterval(() => browser.connection.write('a'), 100)
  context.after(() => clearInterval(sending))

  // Act
  // gstack-timing-ok: the client sends a byte every 100 ms, five times within the limit of 500 ms, and the test waits six times the limit for the answer's end.
  const imageAnswer = await within(server.answersClosed(1), 3_000)
  clearInterval(sending)

  // Assert
  assert.equal(imageAnswer, 'closed')
})

// Value: protects=a learner whose browser receives a large image of the Wiki over a slow link, such as a remote window's forwarded port: the send limit counted the whole send, so every image larger than the link carries within the limit was cut on every load; fails_when=the reader ends an answer whose browser keeps reading at the send limit, instead of only one that has taken nothing for that long; why_new=Cycle 0047 row 230 (P2CLA-8); seam=the reader loaded with loadModule and a send limit of 1,000 ms, and a client that stops reading for 8 ms after each part it receives, so receiving the image takes about twice the limit; the limit is 1,000 ms, not 250 ms, because a machine under heavy load can leave one part waiting longer than 250 ms (Cycle 0049 F113); no_claim=the shipped send limit of 30 s and a real remote link
test('an image of the Wiki that its browser reads slowly but steadily is received whole, though receiving it takes longer than the send limit', async (context) => {
  // Arrange: an image of 16 MiB that the manifest names, and a send limit of 1,000 ms.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-slow-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  const imageBytes = Buffer.alloc(16_777_216, 'diagram ')
  await writeFile(join(outputDirectory, 'diagram.png'), imageBytes)
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const { startDeepWikiReader: startReaderWithASendLimit } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    { './constants': { ...constants, WIKI_RESPONSE_SEND_LIMIT_MS: 1_000 } },
    { URL },
  )
  const reader = await startReaderWithASendLimit(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  // gstack-timing-ok: the client's pause of 8 ms after each part of at most 64 KiB makes receiving 16 MiB take about two seconds, twice the limit, while the reader's next part waits for one pause at a time, far within it.
  const startedAt = performance.now()
  const answer = await askAndReadSlowly(
    new URL('diagram.png', reader.url).href,
    { 'Sec-Fetch-Dest': 'image' },
    8,
  )
  const receivingTookMs = performance.now() - startedAt

  // Assert
  assert.deepEqual(
    {
      status: answer.status,
      bodyIsTheImage:
        answer.body !== 'ended early' && answer.body.equals(imageBytes),
      tookLongerThanTheLimit: receivingTookMs > 1_000,
    },
    { status: 200, bodyIsTheImage: true, tookLongerThanTheLimit: true },
  )
})

// Value: protects=a learner whose browser receives a large page over a slow link: the send limit counted the whole send, so a page larger than the link carries within the limit was cut on every load; fails_when=the reader ends a page whose browser keeps reading at the send limit, or sends a page whole in one write, whose progress the reader cannot see; why_new=Cycle 0047 row 230 (P2CLA-8); seam=the reader loaded with loadModule, a send limit of 1,000 ms (not 250 ms, which a heavily loaded machine can exceed between two parts: Cycle 0049 F113), one place for pages in hand, a stand-in page-worker module that prepares the first page as 16 MiB of text, and a client that stops reading for 8 ms after each part it receives; no_claim=the shipped send limit of 30 s and a real remote link
test('a page that its browser reads slowly but steadily is received whole, though receiving it takes longer than the send limit', async (context) => {
  // Arrange: the overview, prepared as 16 MiB of text, and a send limit of 1,000 ms.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-slow-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  const onePlace = await loadReaderWithOnePlaceAndALargeFirstPage({
    WIKI_RESPONSE_SEND_LIMIT_MS: 1_000,
  })
  const reader = await onePlace.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  // gstack-timing-ok: the client's pause of 8 ms after each part of at most 64 KiB makes receiving 16 MiB take about two seconds, twice the limit, while the reader's next part waits for one pause at a time, far within it.
  const startedAt = performance.now()
  const answer = await askAndReadSlowly(reader.url, {}, 8)
  const receivingTookMs = performance.now() - startedAt

  // Assert
  assert.deepEqual(
    {
      status: answer.status,
      bodyIsThePage:
        answer.body !== 'ended early' &&
        answer.body.equals(Buffer.from('x'.repeat(16_777_216))),
      tookLongerThanTheLimit: receivingTookMs > 1_000,
    },
    { status: 200, bodyIsThePage: true, tookLongerThanTheLimit: true },
  )
})

/**
 * Loads the reader with an opener that counts the files of one name it opens and closes, so a test can tell whether the reader holds such a file open.
 * Called by the tests of an image of the Wiki that its browser does not read.
 * @param fileName - The name of the watched file; every other file is opened as always.
 * @param constantOverrides - Constants the loaded reader reads instead of the shipped ones.
 * @param dependencies - Further modules the loaded reader requires instead of the real ones, such as a `node:http` that notes its answers.
 * @returns The loaded reader's {@link startDeepWikiReader}; how many of the watched files are open now; how many times the watched file was opened so far; and a promise that settles with `'opened'` once the watched file has been opened as many times as asked.
 * @example
 * const watched = await loadReaderWatchingOpensOf('diagram.png', {})
 * watched.openFiles() // => 0 while the reader holds no such file open
 */
async function loadReaderWatchingOpensOf(
  fileName: string,
  constantOverrides: Partial<Record<keyof typeof constants, unknown>>,
  dependencies: Record<string, unknown> = {},
): Promise<{
  startDeepWikiReader: typeof startDeepWikiReader
  openFiles: () => number
  openCount: () => number
  opened: (count: number) => Promise<'opened'>
}> {
  let openCount = 0
  let closeCount = 0
  const openWaits: { count: number; noteOpened: (opened: 'opened') => void }[] =
    []
  const openerCountingOpens: typeof openWithoutFollowingModule = {
    openWithoutFollowing: async (
      ...parameters: Parameters<typeof openWithoutFollowing>
    ) => {
      const file = await openWithoutFollowing(...parameters)
      // Only the watched file is counted: the manifest and the pages are opened as always.
      if (basename(parameters[0]) !== fileName) return file
      openCount += 1
      for (const wait of openWaits.filter(({ count }) => count <= openCount))
        wait.noteOpened('opened')
      const closeOfTheFile = file.close.bind(file)
      return Object.assign(file, {
        close: async (): Promise<void> => {
          await closeOfTheFile()
          closeCount += 1
        },
      })
    },
  }
  const loaded = await loadModule<typeof deepWikiReaderModule>(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      ...dependencies,
      './constants': { ...constants, ...constantOverrides },
      './utils/openWithoutFollowing': openerCountingOpens,
    },
    { URL },
  )
  return {
    startDeepWikiReader: loaded.startDeepWikiReader,
    openFiles: () => openCount - closeCount,
    openCount: () => openCount,
    opened: (count) =>
      new Promise((resolveOpened) => {
        if (count <= openCount) resolveOpened('opened')
        else openWaits.push({ count, noteOpened: resolveOpened })
      }),
  }
}

// Value: protects=the publisher's swap of the Wiki folder on Windows, where an open file refuses the move and renameRetried gives up after about 2.25 s, against a browser that stops reading an image of the Wiki: the reader sent the image from one open file until the send limit of 30 s ended its answer, so a stalled download still failed a publish; fails_when=the reader keeps a file of the Wiki open while its browser takes nothing of it, so the file is still open when the publisher's swap has given up; why_new=Cycle 0047 row 230 (P2CLA-8); seam=the reader loaded with loadModule and an opener that counts the image's opens and closes, and a connection of the test's that does not read; no_claim=Windows itself (the open file is counted on any system)
test('an image of the Wiki whose browser stops reading has its file closed well before the publisher’s swap gives up, while its answer still waits for the browser', async (context) => {
  // Arrange: an image of 16 MiB that the manifest names, the shipped send limit, and a connection that asks for the image and does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-closed-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'diagram.png'),
    Buffer.alloc(16_777_216, 'diagram '),
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const watched = await loadReaderWatchingOpensOf('diagram.png', {})
  const reader = await watched.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(new URL('diagram.png', reader.url).href, {
    'Sec-Fetch-Dest': 'image',
  })
  context.after(() => browser.connection.destroy())
  const imageOpened = await within(watched.opened(1), 2_000)

  // Act: the image's open files 1.5 s after the browser stopped reading, before the swap's 2.25 s.
  // gstack-timing-ok: the claim is a time, the publisher's 2.25 s; the connection's buffers fill in milliseconds, after which the reader waits for the browser.
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500))
  const openImageFiles = watched.openFiles()
  const browserConnection = await within(browser.closed, 0)

  // Assert
  assert.deepEqual(
    { imageOpened, openImageFiles, browserConnection },
    {
      imageOpened: 'opened',
      openImageFiles: 0,
      browserConnection: 'still waiting',
    },
  )
})

// Value: protects=a learner whose browser receives an image of the Wiki while an update publishes a new Wiki: the reader now opens the image again for each part it sends, so a part read after the swap would come from the new folder's file; fails_when=the reader sends a part of another file that took the image's path since its answer began, so the browser gets one image's start and another's rest, instead of an answer that ends there; why_new=Cycle 0047 row 230 (P2CLA-8): the reader opens a file of the Wiki for each part only; seam=the reader loaded with loadModule and an opener that counts the image's opens, and a connection of the test's that does not read until the test resumes it; no_claim=the publisher's own swap (a new file is moved onto the image's path)
test('an image of the Wiki that another file replaced while its browser waited is ended there, and its browser gets no byte of the other file', async (context) => {
  // Arrange: an image of 16 MiB that the manifest names, another file beside it, and a connection that asks for the image and does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-replaced-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  const imagePath = join(outputDirectory, 'diagram.png')
  await writeFile(imagePath, Buffer.alloc(16_777_216, 'diagram '))
  await writeFile(
    join(projectRoot, 'other.png'),
    Buffer.alloc(16_777_216, 'REPLACED'),
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const watched = await loadReaderWatchingOpensOf('diagram.png', {})
  const reader = await watched.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const received: Buffer[] = []
  const browser = askWithoutReading(new URL('diagram.png', reader.url).href, {
    'Sec-Fetch-Dest': 'image',
  })
  browser.connection.on('data', (part: Buffer) => received.push(part))
  context.after(() => browser.connection.destroy())
  // The reader has sent parts of the image, and waits for the browser to take more.
  const partsSent = await within(watched.opened(2), 2_000)

  // Act: another file takes the image's path, then the browser reads on.
  await rename(join(projectRoot, 'other.png'), imagePath)
  browser.connection.resume()
  const browserConnection = await within(browser.closed, 3_000)
  const receivedBytes = Buffer.concat(received)

  // Assert
  assert.deepEqual(
    {
      partsSent,
      browserConnection,
      receivedLessThanTheImage: receivedBytes.length < 16_777_216,
      receivedOfTheOtherFile: receivedBytes.includes('REPLACED'),
    },
    {
      partsSent: 'opened',
      browserConnection: 'closed',
      receivedLessThanTheImage: true,
      receivedOfTheOtherFile: false,
    },
  )
})

// Value: protects=the publisher's swap of the Wiki folder on Windows and the editor's open files against a browser that goes while it receives an image of the Wiki: the reader must stop there, with no file of the Wiki open; fails_when=the reader goes on to read parts of a file for an answer whose connection has closed, or leaves a part's file open; why_new=Cycle 0047 row 232 (state-machine cell: a streamed file × the connection closes first); seam=the reader loaded with loadModule, an opener that counts the image's opens and closes, a node:http whose server notes each close of an answer and each end of the reader's handler, and a connection of the test's that does not read; no_claim=Windows itself (the open files are counted on any system)
test('an image of the Wiki whose browser goes before it has received the image has no file of it open, and no part of it is read after the browser went', async (context) => {
  // Arrange: an image of 16 MiB that the manifest names, an opener that counts the image's opens and closes, and a connection that asks for the image and does not read it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-gone-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'diagram.png'),
    Buffer.alloc(16_777_216, 'diagram '),
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const server = httpNotingTheReadersRequests()
  const watched = await loadReaderWatchingOpensOf(
    'diagram.png',
    {},
    { 'node:http': server.http },
  )
  const reader = await watched.startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browser = askWithoutReading(new URL('diagram.png', reader.url).href, {
    'Sec-Fetch-Dest': 'image',
  })
  context.after(() => browser.connection.destroy())
  // The reader has sent parts of the image, and waits for the browser to take more.
  const partsSent = await within(watched.opened(2), 2_000)

  // Act: the browser goes; then the reader's answer closes and its handler ends.
  browser.connection.destroy()
  const imageAnswer = await within(server.answersClosed(1), 2_000)
  const opensAtTheClose = watched.openCount()
  const imageHandler = await within(server.handlersEnded(1), 2_000)

  // Assert
  assert.deepEqual(
    {
      partsSent,
      imageAnswer,
      imageHandler,
      opensAfterTheClose: watched.openCount() - opensAtTheClose,
      openImageFiles: watched.openFiles(),
    },
    {
      partsSent: 'opened',
      imageAnswer: 'closed',
      imageHandler: 'ended',
      opensAfterTheClose: 0,
      openImageFiles: 0,
    },
  )
})

// Value: protects=the editor's extension host against a page file that grows past the reader's limit after its size was looked at, and every later page; fails_when=the reader reads the opened page whole (readFile, or readUpToLimit without the limit), so the grown file is read and prepared, or a page refused so keeps its place, so the page asked for after six of them is refused as busy; why_new=the P2P2 test's no_claim names this growth; Cycle 0047 row 15 (P3D1): the refused page is the overview, so its refusal page has no link to itself; Cycle 0047 row 192 (S2SM-U36): the places of six grown pages; seam=the reader loaded with loadModule, a 1,000-byte limit, a file system whose lstat puts the overview back to 33 bytes before each look and lets it grow after it, and a counting page worker; no_claim=the real race's timing (the growth is made at the look)
test('a page file that grows past the limit after the reader looked at its size is answered with the page that says it is too large, and is not prepared, and six such pages give their places back, so the page asked for after them is served', async (context) => {
  // Arrange: an overview of 33 bytes that grows by 2,000 bytes right after each look of the reader at its size, a page besides it, a reader that prepares pages of 1,000 bytes at most, and a page worker that counts its pages.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-growing-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'later.html'),
    '<!doctype html><body>Later</body>',
  )
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [{ path: 'later.html' }],
      assets: [],
      includedSources: [],
    }),
  )
  const growingFileSystem = {
    ...fileSystemPromises,
    lstat: async (...parameters: Parameters<typeof lstat>) => {
      const isOverview = basename(String(parameters[0])) === 'index.html'
      // Each look finds the overview of 33 bytes, which grows right after it.
      if (isOverview)
        await writeFile(parameters[0], '<!doctype html><body>Wiki</body>')
      const status = await lstat(...parameters)
      if (isOverview) await appendFile(parameters[0], 'x'.repeat(2_000))
      return status
    },
  }
  let preparedPageCount = 0
  const countingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithGrowingPage } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      './constants': { ...constants, WIKI_PAGE_FILE_LIMIT_BYTES: 1_000 },
      'node:fs/promises': growingFileSystem,
      './wikiPageWorker': countingWorker,
    },
    { URL },
  )
  const reader = await startReaderWithGrowingPage(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act: the overview, five more times, each answered before the next is asked for, then the page besides it.
  const response = await fetch(reader.url)
  const answer = {
    status: response.status,
    // The overview's address under this reader's random prefix, written as OVERVIEW.
    body: (await response.text()).replaceAll(
      new URL(reader.url).pathname,
      'OVERVIEW',
    ),
  }
  const preparedForTheOverview = preparedPageCount
  const laterAnswers: { status: number; sentence: string }[] = []
  // Five more grown overviews, so six pages were refused as too large; each is noted by its status and the sentence of its refusal page.
  for (let request = 0; request < 5; request += 1) {
    const grownResponse = await fetch(reader.url)
    const grownBody = await grownResponse.text()
    laterAnswers.push({
      status: grownResponse.status,
      sentence: grownBody.slice(
        grownBody.indexOf('<p>') + '<p>'.length,
        grownBody.indexOf('</p>'),
      ),
    })
  }
  const nextResponse = await fetch(new URL('later.html', reader.url))
  const next = { status: nextResponse.status, body: await nextResponse.text() }

  // Assert
  assert.deepEqual(
    { answer, preparedForTheOverview, laterAnswers, next },
    {
      answer: {
        status: 503,
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not shown</title></head><body><p>This page is too large for Codebook to prepare for reading. An earlier Codebook may have published a page this large, or its file may have been changed by hand. If you changed it, restore the page or move your change aside, then press Update LLM Wiki; otherwise ask the editor chat to split it into smaller pages and update the Wiki.</p></body></html>',
      },
      preparedForTheOverview: 0,
      laterAnswers: Array.from({ length: 5 }, () => ({
        status: 503,
        sentence:
          'This page is too large for Codebook to prepare for reading. An earlier Codebook may have published a page this large, or its file may have been changed by hand. If you changed it, restore the page or move your change aside, then press Update LLM Wiki; otherwise ask the editor chat to split it into smaller pages and update the Wiki.',
      })),
      next: { status: 200, body: '<p>Prepared page</p>' },
    },
  )
})

// Value: protects=a page file of exactly the reader's limit, which the limit's doc names the largest page read and prepared; fails_when=the size check or the read's bound is off by one, so a page of exactly the limit is refused as too large; why_new=the P2P2 test's pages are 2,021 and 33 bytes, far from the limit; seam=the reader loaded with loadModule, a 1,000-byte limit and a counting page worker; no_claim=the real 8 MB limit (a smaller limit stands in)
test('a page file of exactly the reader’s limit is read and served', async (context) => {
  // Arrange: an overview of exactly 1,000 bytes and a reader that prepares pages of 1,000 bytes at most.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-limit-page-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  await writeFile(
    join(outputDirectory, 'index.html'),
    `<!doctype html><body>${'x'.repeat(972)}</body>`,
  )
  let preparedPageCount = 0
  const countingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithSmallPageLimit } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        './constants': { ...constants, WIKI_PAGE_FILE_LIMIT_BYTES: 1_000 },
        './wikiPageWorker': countingWorker,
      },
      { URL },
    )
  const reader = await startReaderWithSmallPageLimit(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const response = await fetch(reader.url)
  const answer = { status: response.status, body: await response.text() }

  // Assert
  assert.deepEqual(
    {
      answer,
      preparedPageCount,
      pageBytes: (await lstat(join(outputDirectory, 'index.html'))).size,
    },
    {
      answer: { status: 200, body: '<p>Prepared page</p>' },
      preparedPageCount: 1,
      pageBytes: 1_000,
    },
  )
})

// Value: protects=every request of the open Wiki reader, and the few threads of the editor host's file system, against a named pipe at the path of a page the manifest lists; fails_when=the reader looks only at the size of the entry at a page's path (a pipe has none), so it opens the pipe, and the open holds a thread of the host's file system until a writer comes, which may be never; why_new=Cycle 0047 row 12 (P3CR-1); seam=none (a real named pipe, whose waiting reader the test releases when it ends); no_claim=Windows, which has no named pipe in a folder
test(
  'a page whose path holds a named pipe is refused at once with 403, and no open of it waits for a writer',
  {
    timeout: 5_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange: a Wiki whose manifest lists a page that is a named pipe nobody writes to.
    const projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-pipe-page-')),
    )
    const { outputDirectory, manifestPath } =
      await writeMinimalWiki(projectRoot)
    const pipePath = join(outputDirectory, 'pipe.html')
    await promisify(execFile)('mkfifo', [pipePath])
    const browserTab = new AbortController()
    // An open that waits on the pipe would keep this process alive: a writer that opens and closes ends it, also when the body was stopped at its time bound.
    context.after(async () => {
      browserTab.abort()
      await open(
        pipePath,
        openConstants.O_WRONLY | openConstants.O_NONBLOCK,
      ).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await rm(projectRoot, { recursive: true, force: true })
    })
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        pages: [{ path: 'pipe.html' }],
        assets: [],
        includedSources: [],
      }),
    )
    const reader = await startDeepWikiReader(
      outputDirectory,
      projectRoot,
      async () => ({ handoff: 'not asked' }),
    )
    context.after(() => reader.close())

    // Act
    const answer = await within(
      fetch(new URL('pipe.html', reader.url), {
        signal: browserTab.signal,
      }).then(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
      2_000,
    )

    // Assert
    assert.deepEqual(answer, {
      status: 403,
      body: '{"error":"The Wiki file is no regular file; a pipe, a device or a folder at its path is not served."}',
    })
  },
)

// Value: protects=the editor's machine against a Wiki page that names a page of the Wiki many times as an image, media, a style sheet, a font, a track or a script (the page policy lets it load them from the reader's address), so that every such request starts a page worker that may keep a core busy until the deadline; fails_when=the reader prepares a page for a request the browser makes for anything but a page it opens (a Sec-Fetch-Dest other than document or iframe), or it refuses a page the browser opens as a document or in a frame, or one asked for by a client that names no destination; why_new=P2RT3; seam=the reader loaded with loadModule and a stand-in page-worker module that counts the pages it is asked to prepare; no_claim=a browser that sends no Sec-Fetch-Dest (it is served as before)
test('a Wiki page asked for as an image, media, a style sheet, a font, a track, a script or by a fetch is refused with 403 before any page preparation starts, while a page opened as a document, in a frame or by a client that names no destination is served', async (context) => {
  // Arrange: the one-page Wiki and a reader whose page worker counts the pages it prepares.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-destination-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  let preparedPageCount = 0
  const countingWorker: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: async () => {
      preparedPageCount += 1
      return { state: 'served', html: '<p>Prepared page</p>' }
    },
  }
  const { startDeepWikiReader: startReaderWithCountingWorker } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      { './wikiPageWorker': countingWorker },
      { URL },
    )
  const reader = await startReaderWithCountingWorker(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act: the overview, asked for once with each destination a browser names, and once with none.
  const answers: Record<string, { status: number; body: string }> = {}
  for (const destination of [
    'image',
    'audio',
    'video',
    'style',
    'font',
    'track',
    'script',
    'empty',
    'document',
    'iframe',
    undefined,
  ]) {
    const response = await fetch(
      reader.url,
      destination === undefined
        ? {}
        : { headers: { 'Sec-Fetch-Dest': destination } },
    )
    answers[destination ?? 'none'] = {
      status: response.status,
      body: await response.text(),
    }
  }

  // Assert: seven refusals and three pages, and only the three pages were prepared.
  const refusal = {
    status: 403,
    body: '{"error":"A Wiki page is served only to be opened as a page."}',
  }
  const page = { status: 200, body: '<p>Prepared page</p>' }
  assert.deepEqual(
    { answers, preparedPageCount },
    {
      answers: {
        image: refusal,
        audio: refusal,
        video: refusal,
        style: refusal,
        font: refusal,
        track: refusal,
        script: refusal,
        empty: refusal,
        document: page,
        iframe: page,
        none: page,
      },
      preparedPageCount: 3,
    },
  )
})

// Value: protects=the reader's own script and the Wiki's style sheets and images, which a browser asks for as a script, a style and an image; fails_when=the destination refusal of pages also covers files that are no page, so every browser gets 403 for the Q&A script, styles and images; why_new=the P2RT3 test asks for the overview alone; no test sends Sec-Fetch-Dest for a file that is no page; seam=none; no_claim=a real browser's headers (fetch sends the header by hand)
test('the reader’s own script, a style sheet and an image of the Wiki are served to a browser that asks for them as a script, a style and an image', async (context) => {
  // Arrange: the one-page Wiki with a style sheet and an image that its manifest names.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-subresource-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(join(outputDirectory, 'wiki.css'), 'body { margin: 0; }')
  await writeFile(join(outputDirectory, 'diagram.png'), 'PNG bytes')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['wiki.css', 'diagram.png'],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act: each file asked for with the destination a browser names for it.
  const answers: Record<string, { status: number; type: string | null }> = {}
  for (const [file, destination] of [
    ['codebook-qa.js', 'script'],
    ['wiki.css', 'style'],
    ['diagram.png', 'image'],
  ] as const) {
    const response = await fetch(new URL(file, reader.url), {
      headers: { 'Sec-Fetch-Dest': destination },
    })
    await response.arrayBuffer()
    answers[file] = {
      status: response.status,
      type: response.headers.get('content-type'),
    }
  }

  // Assert
  assert.deepEqual(answers, {
    'codebook-qa.js': {
      status: 200,
      type: 'text/javascript; charset=utf-8',
    },
    'wiki.css': { status: 200, type: 'text/css; charset=utf-8' },
    'diagram.png': { status: 200, type: 'application/octet-stream' },
  })
})

// Value: protects=the editor's extension host against a page with many style sheets, images and fonts: each of them, the reader's own script and a page asked for as a part of a page read and parsed the whole manifest (up to 64 MiB) on the host's thread, one read for each request and with no bound; fails_when=a request that is no page reads the manifest while another such read is in flight instead of joining it, or the reader's own script or a page refused as a part of a page reads the manifest at all; why_new=Cycle 0047 row 229 (P2OCR2a1-1); seam=the reader loaded with loadModule, a manifest reader that notes each read after the reader's start and holds it until the test lets it go, and a node:http whose server notes each request it hands the reader; no_claim=the time and the memory a read takes (the reads are counted)
test('a style sheet, an image and a font asked for at once cost one manifest read between them, and the reader’s own script and a page asked for as an image are answered without one', async (context) => {
  // Arrange: a Wiki with a style sheet, an image and a font; a manifest reader that notes each read after the reader's start and holds it until the test lets it go; and a server that notes each request it hands the reader.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-shared-manifest-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(join(outputDirectory, 'wiki.css'), 'body { margin: 0; }')
  await writeFile(join(outputDirectory, 'diagram.png'), 'PNG bytes')
  await writeFile(join(outputDirectory, 'text.woff2'), 'font bytes')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['wiki.css', 'diagram.png', 'text.woff2'],
      includedSources: [],
    }),
  )
  let isReaderStarted = false
  let manifestReadsAfterTheStart = 0
  let letReadsGoOn = (): void => {}
  const readsMayGoOn = new Promise<void>((resolveGoOn) => {
    letReadsGoOn = resolveGoOn
  })
  const holdingManifestReader: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: async (...parameters) => {
      // The reader's start reads the manifest as always; every later read is noted and held.
      if (parameters[1] === 'manifest' && isReaderStarted) {
        manifestReadsAfterTheStart += 1
        await readsMayGoOn
      }
      return readWikiFileToOpen(...parameters)
    },
  }
  const server = httpNotingTheReadersRequests()
  const { startDeepWikiReader: startReaderHoldingManifestReads } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        'node:http': server.http,
        './utils/readWikiFileToOpen': holdingManifestReader,
      },
      { URL },
    )
  const reader = await startReaderHoldingManifestReads(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // A held read is let go also when the test fails, so its requests end.
  context.after(() => letReadsGoOn())
  isReaderStarted = true

  // Act: the reader's own script and the overview asked for as an image, each answered before the next is asked; then the three files at once, until the reader has taken all three in; then the held reads go on.
  const ownScript = await within(
    fetch(new URL('codebook-qa.js', reader.url), {
      headers: { 'Sec-Fetch-Dest': 'script' },
    }).then(async (response) => {
      await response.arrayBuffer()
      return response.status
    }),
    1_000,
  )
  const pageAsAnImage = await within(
    fetch(reader.url, { headers: { 'Sec-Fetch-Dest': 'image' } }).then(
      async (response) => {
        await response.arrayBuffer()
        return response.status
      },
    ),
    1_000,
  )
  const files = (
    [
      ['wiki.css', 'style'],
      ['diagram.png', 'image'],
      ['text.woff2', 'font'],
    ] as const
  ).map(([file, destination]) =>
    fetch(new URL(file, reader.url), {
      headers: { 'Sec-Fetch-Dest': destination },
    }).then(async (response) => {
      await response.arrayBuffer()
      return response.status
    }),
  )
  const filesTakenIn = await within(server.requestsHanded(5), 2_000)
  letReadsGoOn()
  const fileStatuses = await within(Promise.all(files), 2_000)

  // Assert
  assert.deepEqual(
    {
      ownScript,
      pageAsAnImage,
      filesTakenIn,
      fileStatuses,
      manifestReadsAfterTheStart,
    },
    {
      ownScript: 200,
      pageAsAnImage: 403,
      filesTakenIn: 'handed',
      fileStatuses: [200, 200, 200],
      manifestReadsAfterTheStart: 1,
    },
  )
})

// Value: protects=the editor's extension host against pages opened at once (tabs restored, or a page and the pages it names): each page read and parsed the whole manifest (up to 64 MiB) on the host's thread on its own, so six pages at once stalled the host six times over (a probe with a manifest of 53 MiB: 1.4 s of stall for six pages, 0.4 s for one); fails_when=a page asked for while another manifest read is in flight reads the manifest again instead of joining that read; why_new=Cycle 0048 task 18 (S11-N14); seam=the reader loaded with loadModule, a manifest reader that notes each read after the reader's start and holds it until the test lets it go, and a node:http whose server notes each request it hands the reader; no_claim=the time and the memory a read takes (the reads are counted)
test('six pages asked for at once cost one manifest read between them and are all served', async (context) => {
  // Arrange: the one-page Wiki, a manifest reader that notes each read after the reader's start and holds it until the test lets it go, and a server that notes each request it hands the reader.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-shared-pages-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  let isReaderStarted = false
  let manifestReadsAfterTheStart = 0
  let letReadsGoOn = (): void => {}
  const readsMayGoOn = new Promise<void>((resolveGoOn) => {
    letReadsGoOn = resolveGoOn
  })
  const holdingManifestReader: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: async (...parameters) => {
      // The reader's start reads the manifest as always; every later read is noted and held.
      if (parameters[1] === 'manifest' && isReaderStarted) {
        manifestReadsAfterTheStart += 1
        await readsMayGoOn
      }
      return readWikiFileToOpen(...parameters)
    },
  }
  const server = httpNotingTheReadersRequests()
  const { startDeepWikiReader: startReaderHoldingManifestReads } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        'node:http': server.http,
        './utils/readWikiFileToOpen': holdingManifestReader,
      },
      { URL },
    )
  const reader = await startReaderHoldingManifestReads(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // A held read is let go also when the test fails, so its requests end.
  context.after(() => letReadsGoOn())
  isReaderStarted = true

  // Act: six pages at once, until the reader has taken all six in; then the held read goes on.
  const pages = Array.from({ length: 6 }, () =>
    fetch(reader.url, { headers: { 'Sec-Fetch-Dest': 'document' } }).then(
      async (response) => {
        await response.arrayBuffer()
        return response.status
      },
    ),
  )
  const pagesTakenIn = await within(server.requestsHanded(6), 2_000)
  letReadsGoOn()
  const pageStatuses = await within(Promise.all(pages), 10_000)

  // Assert
  assert.deepEqual(
    { pagesTakenIn, pageStatuses, manifestReadsAfterTheStart },
    {
      pagesTakenIn: 'handed',
      pageStatuses: [200, 200, 200, 200, 200, 200],
      manifestReadsAfterTheStart: 1,
    },
  )
})

// Value: protects=a learner whose Wiki an update publishes while the reader stays open: the files of the Wiki share one manifest read while it is in flight, and that read must end for them once it has ended, or a style sheet or an image the update added is refused as not published until the editor reloads; fails_when=the shared manifest read is kept after it has ended, so a file the manifest lists only since a later publish is answered with 404; why_new=Cycle 0047 row 273 (P3TEST-17): the end of the shared read (row 229) had no test; seam=none (the reader's real manifest reads); no_claim=the publisher's own swap (the test writes the new manifest in place)
test('a style sheet that an update adds after the reader has served a file of the Wiki is served', async (context) => {
  // Arrange: a Wiki whose manifest lists no style sheet yet, and a style sheet beside it.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-added-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(join(outputDirectory, 'wiki.css'), 'body { margin: 0; }')
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  /** Asks for the style sheet as a browser does, and answers its status and body. */
  const askForTheStyleSheet = async (): Promise<{
    status: number
    body: string
  }> => {
    const response = await fetch(new URL('wiki.css', reader.url), {
      headers: { 'Sec-Fetch-Dest': 'style' },
    })
    return { status: response.status, body: await response.text() }
  }

  // Act: the style sheet before the update lists it, then the update's manifest, then the style sheet again.
  const beforeTheUpdate = await askForTheStyleSheet()
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['wiki.css'],
      includedSources: [],
    }),
  )
  const afterTheUpdate = await askForTheStyleSheet()

  // Assert
  assert.deepEqual(
    { beforeTheUpdate, afterTheUpdate },
    {
      beforeTheUpdate: {
        status: 404,
        body: '{"error":"This file is not published by the Wiki."}',
      },
      afterTheUpdate: { status: 200, body: 'body { margin: 0; }' },
    },
  )
})

// Value: protects=a learner whose browser asks for files of the Wiki while a publish replaces its manifest: a shared manifest read that fails answers every request that joined it with its error, and the next request must read the manifest again, or every file of the Wiki is answered with that error until the editor reloads; fails_when=a failed shared read is kept after it has ended, so a request after it gets the old error, or a request that joined the read gets another answer than its error; why_new=Cycle 0047 row 273 (P3TEST-17, P3SM-12: the shared read fails × a request that is no page arrives); seam=the reader loaded with loadModule, a manifest reader whose first read after the reader's start waits until the test lets it go and then fails, and a node:http whose server notes each request it hands the reader; no_claim=the publisher's own swap (the failure stands for a manifest read during it)
test('a shared manifest read that fails answers every file of the Wiki that joined it with its error, and a file asked for after it is read again and served', async (context) => {
  // Arrange: a Wiki with a style sheet and an image, a manifest reader whose first read after the reader's start is held and then fails, and a server that notes each request it hands the reader.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-failed-shared-read-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(join(outputDirectory, 'wiki.css'), 'body { margin: 0; }')
  await writeFile(join(outputDirectory, 'diagram.png'), 'PNG bytes')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['wiki.css', 'diagram.png'],
      includedSources: [],
    }),
  )
  let isReaderStarted = false
  let manifestReadsAfterTheStart = 0
  let letTheFailingReadGoOn = (): void => {}
  const failingReadMayGoOn = new Promise<void>((resolveGoOn) => {
    letTheFailingReadGoOn = resolveGoOn
  })
  const manifestReaderFailingOnce: typeof readWikiFileToOpenModule = {
    readWikiFileToOpen: async (...parameters) => {
      // The reader's start reads the manifest as always; the first read after it is held, then fails.
      if (parameters[1] === 'manifest' && isReaderStarted) {
        manifestReadsAfterTheStart += 1
        if (manifestReadsAfterTheStart === 1) {
          await failingReadMayGoOn
          throw new Error('The manifest is being replaced.')
        }
      }
      return readWikiFileToOpen(...parameters)
    },
  }
  const server = httpNotingTheReadersRequests()
  const { startDeepWikiReader: startReaderFailingOneRead } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      'node:http': server.http,
      './utils/readWikiFileToOpen': manifestReaderFailingOnce,
    },
    { URL },
  )
  const reader = await startReaderFailingOneRead(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held read is let go also when the test fails, so its requests end.
  context.after(() => letTheFailingReadGoOn())
  isReaderStarted = true
  /** Asks for a file of the Wiki as a browser does, and answers its status and body. */
  const askFor = async (
    file: string,
    destination: string,
  ): Promise<{ status: number; body: string }> => {
    const response = await fetch(new URL(file, reader.url), {
      headers: { 'Sec-Fetch-Dest': destination },
    })
    return { status: response.status, body: await response.text() }
  }

  // Act: the style sheet and the image at once, until the reader has taken both in; then the held read fails; then the style sheet again.
  const joined = Promise.all([
    askFor('wiki.css', 'style'),
    askFor('diagram.png', 'image'),
  ])
  const bothTakenIn = await within(server.requestsHanded(2), 2_000)
  letTheFailingReadGoOn()
  const joinedAnswers = await within(joined, 2_000)
  const after = await within(askFor('wiki.css', 'style'), 2_000)

  // Assert
  assert.deepEqual(
    { bothTakenIn, joinedAnswers, after, manifestReadsAfterTheStart },
    {
      bothTakenIn: 'handed',
      joinedAnswers: [
        {
          status: 500,
          body: '{"error":"Error: The manifest is being replaced."}',
        },
        {
          status: 500,
          body: '{"error":"Error: The manifest is being replaced."}',
        },
      ],
      after: { status: 200, body: 'body { margin: 0; }' },
      manifestReadsAfterTheStart: 2,
    },
  )
})

// Value: protects=the editor's extension host against a large file the manifest lists as an asset (a style sheet, a script, an image), asked for several times at once: each request read it whole into the host's memory, with no size limit; fails_when=the reader reads a file that is no page whole (the module's readFile, or readFile through the file it opened) instead of sending it from its opened file in parts, follows bytes the file gained after its stat, or no longer sends it byte for byte; why_new=Cycle 0047 row 18 (P3SEC1 = S11-F2); Cycle 0047 row 74 (TEST-1) a whole read through the opened file passed the test; seam=the reader loaded with loadModule, a file system module that records which files the reader reads whole, and an opener whose opened image records a whole read through it and grows right after its stat; no_claim=the memory the host saves (each request holds one part of the file at a time)
test('an asset of the Wiki is sent byte for byte from its opened file in parts, only as far as its size at its stat, and no file is read whole into the editor’s process', async (context) => {
  // Arrange: an image of 300,000 bytes that the manifest names, a file system that notes the files the reader reads whole, and an opener whose opened image notes a whole read through it and grows right after its stat.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-streamed-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  const imagePath = join(outputDirectory, 'diagram.png')
  const imageBytes = Buffer.alloc(300_000, 'diagram ')
  await writeFile(imagePath, imageBytes)
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const filesReadWhole: string[] = []
  const recordingFileSystem = {
    ...fileSystemPromises,
    readFile: (...parameters: Parameters<typeof readFile>) => {
      filesReadWhole.push(basename(String(parameters[0])))
      return readFile(...parameters)
    },
  }
  const openerWhoseImageGrowsAfterItsStat: typeof openWithoutFollowingModule = {
    openWithoutFollowing: async (
      ...parameters: Parameters<typeof openWithoutFollowing>
    ) => {
      const file = await openWithoutFollowing(...parameters)
      // Only the image is watched: the manifest and the pages are opened as always.
      if (basename(parameters[0]) !== 'diagram.png') return file
      const statOfTheImage = file.stat.bind(file)
      const wholeReadOfTheImage = file.readFile.bind(file)
      return Object.assign(file, {
        stat: async (...statParameters: Parameters<typeof file.stat>) => {
          const status = await statOfTheImage(...statParameters)
          await appendFile(
            imagePath,
            'bytes the image gained after the reader’s stat',
          )
          return status
        },
        readFile: (
          ...readParameters: Parameters<typeof file.readFile>
        ): ReturnType<typeof file.readFile> => {
          filesReadWhole.push('diagram.png through its opened file')
          return wholeReadOfTheImage(...readParameters)
        },
      })
    },
  }
  const { startDeepWikiReader: startReaderWithRecordingFileSystem } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      {
        'node:fs/promises': recordingFileSystem,
        './utils/openWithoutFollowing': openerWhoseImageGrowsAfterItsStat,
      },
      { URL },
    )
  const reader = await startReaderWithRecordingFileSystem(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const response = await fetch(new URL('diagram.png', reader.url), {
    headers: { 'Sec-Fetch-Dest': 'image' },
  })
  const body = Buffer.from(await response.arrayBuffer())

  // Assert: the body is the image as its stat found it, 300,000 bytes, without the bytes it gained after.
  assert.deepEqual(
    {
      status: response.status,
      type: response.headers.get('content-type'),
      bodyBytes: body.length,
      bodyIsTheImageAtItsStat: body.equals(imageBytes),
      filesReadWhole,
    },
    {
      status: 200,
      type: 'application/octet-stream',
      bodyBytes: 300_000,
      bodyIsTheImageAtItsStat: true,
      filesReadWhole: [],
    },
  )
})

// Value: protects=the memory of the editor's extension host against the browser: each part of a file of the Wiki is read into a buffer that Node does not clear, and a file that shrank since its stat fills only the start of it, so only that start may be sent, never the old bytes of the host's memory behind it; fails_when=the reader sends the whole buffer of a part instead of the bytes the read put there, so the browser gets more bytes than the file holds; why_new=Cycle 0047 row 273 (P3TEST-19): the test of a streamed asset only grows the file after its stat; seam=the reader loaded with loadModule and an opener whose opened image shrinks to 100,000 bytes right after its stat; no_claim=what the old bytes hold (the length and the bytes sent are compared)
test('an image of the Wiki that shrinks after the reader looked at its size is sent only as far as the bytes it still holds', async (context) => {
  // Arrange: an image of 300,000 bytes that the manifest names, and an opener whose opened image shrinks to 100,000 bytes right after its stat, which is not the end of a part.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-shrunk-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  const imagePath = join(outputDirectory, 'diagram.png')
  const imageBytes = Buffer.alloc(300_000, 'diagram ')
  await writeFile(imagePath, imageBytes)
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['diagram.png'],
      includedSources: [],
    }),
  )
  const openerWhoseImageShrinksAfterItsStat: typeof openWithoutFollowingModule =
    {
      openWithoutFollowing: async (
        ...parameters: Parameters<typeof openWithoutFollowing>
      ) => {
        const file = await openWithoutFollowing(...parameters)
        // Only the image is watched: the manifest and the pages are opened as always.
        if (basename(parameters[0]) !== 'diagram.png') return file
        const statOfTheImage = file.stat.bind(file)
        return Object.assign(file, {
          stat: async (...statParameters: Parameters<typeof file.stat>) => {
            const status = await statOfTheImage(...statParameters)
            await truncate(imagePath, 100_000)
            return status
          },
        })
      },
    }
  const { startDeepWikiReader: startReaderWhoseImageShrinks } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      { './utils/openWithoutFollowing': openerWhoseImageShrinksAfterItsStat },
      { URL },
    )
  const reader = await startReaderWhoseImageShrinks(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const response = await fetch(new URL('diagram.png', reader.url), {
    headers: { 'Sec-Fetch-Dest': 'image' },
  })
  const body = Buffer.from(await response.arrayBuffer())

  // Assert: the body is the 100,000 bytes the image still holds.
  assert.deepEqual(
    {
      status: response.status,
      bodyBytes: body.length,
      bodyIsWhatTheImageStillHolds: body.equals(
        imageBytes.subarray(0, 100_000),
      ),
    },
    { status: 200, bodyBytes: 100_000, bodyIsWhatTheImageStillHolds: true },
  )
})

// Value: protects=an empty file of the Wiki folder that the manifest lists, such as a style sheet left empty by hand, which the reader serves as an empty answer; fails_when=the reader streams an empty file like any other, from byte 0 to byte -1, which Node refuses as out of range, so the file is answered with status 500; why_new=the test of a streamed asset sends an image of 300,000 bytes, and no test lists an empty file; seam=none; no_claim=none beyond protects
test('an empty style sheet of the Wiki is served as an empty answer with status 200', async (context) => {
  // Arrange: a style sheet of no bytes that the manifest names.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-empty-asset-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory, manifestPath } = await writeMinimalWiki(projectRoot)
  await writeFile(join(outputDirectory, 'notes.css'), '')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: projectRoot,
      pages: [],
      assets: ['notes.css'],
      includedSources: [],
    }),
  )
  const reader = await startDeepWikiReader(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())

  // Act
  const response = await fetch(new URL('notes.css', reader.url), {
    headers: { 'Sec-Fetch-Dest': 'style' },
  })
  const answer = {
    status: response.status,
    type: response.headers.get('content-type'),
    body: await response.text(),
  }

  // Assert
  assert.deepEqual(answer, {
    status: 200,
    type: 'text/css; charset=utf-8',
    body: '',
  })
})

// Value: protects=every request of the open Wiki reader, and the few threads of the editor host's file system, against a named pipe at the path of an asset the manifest lists; fails_when=the reader reads a file that is no page without looking at what it is, so the read of the pipe holds a thread of the host's file system until a writer comes, which may be never; why_new=Cycle 0047 row 18 (P3SEC1 = S11-F2); seam=none (a real named pipe, whose waiting reader the test releases when it ends); no_claim=Windows, which has no named pipe in a folder
test(
  'an asset whose path holds a named pipe is refused at once with 403, and no read of it waits for a writer',
  {
    timeout: 5_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange: a Wiki whose manifest lists a style sheet that is a named pipe nobody writes to.
    const projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-pipe-asset-')),
    )
    const { outputDirectory, manifestPath } =
      await writeMinimalWiki(projectRoot)
    const pipePath = join(outputDirectory, 'wiki.css')
    await promisify(execFile)('mkfifo', [pipePath])
    const browserTab = new AbortController()
    // A read that waits on the pipe would keep this process alive: a writer that opens and closes ends it, also when the body was stopped at its time bound.
    context.after(async () => {
      browserTab.abort()
      await open(
        pipePath,
        openConstants.O_WRONLY | openConstants.O_NONBLOCK,
      ).then(
        (writer) => writer.close(),
        () => undefined,
      )
      await rm(projectRoot, { recursive: true, force: true })
    })
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        pages: [],
        assets: ['wiki.css'],
        includedSources: [],
      }),
    )
    const reader = await startDeepWikiReader(
      outputDirectory,
      projectRoot,
      async () => ({ handoff: 'not asked' }),
    )
    context.after(() => reader.close())

    // Act
    const answer = await within(
      fetch(new URL('wiki.css', reader.url), {
        headers: { 'Sec-Fetch-Dest': 'style' },
        signal: browserTab.signal,
      }).then(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
      2_000,
    )

    // Assert
    assert.deepEqual(answer, {
      status: 403,
      body: '{"error":"The Wiki file is no regular file; a pipe, a device or a folder at its path is not served."}',
    })
  },
)

// Value: protects=the reader when another entry takes a listed file's path after its look and before its open; fails_when=the isFile check after the open is dropped, so the folder that took a page's path is read and the connection closes with no answer instead of 403; why_new=the pipe tests refuse at the look, before the open; seam=none; no_claim=the real race's timing (the folder takes the path at the look), and Windows, whose open looks at the path itself
test(
  'a page and an asset whose path a folder takes after the reader’s look and before its open are refused with 403 as no regular file',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows has no O_NOFOLLOW: its open looks at the path itself and refuses the folder before the reader’s check after the open'
        : false,
  },
  async (context) => {
    // Arrange: the overview and a style sheet the manifest names, and a file system whose lstat lets a folder take the looked-at path right after the reader's look found a regular file there.
    const projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-swap-after-look-')),
    )
    context.after(() => rm(projectRoot, { recursive: true, force: true }))
    const { outputDirectory, manifestPath } =
      await writeMinimalWiki(projectRoot)
    await writeFile(join(outputDirectory, 'notes.css'), 'p { color: red; }')
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        pages: [],
        assets: ['notes.css'],
        includedSources: [],
      }),
    )
    const fileSystemWhoseLookedAtFileBecomesAFolder = {
      ...fileSystemPromises,
      lstat: async (...parameters: Parameters<typeof lstat>) => {
        const look = await lstat(...parameters)
        // Only the two served files are swapped, after the look saw them as regular files.
        if (
          ['index.html', 'notes.css'].includes(basename(String(parameters[0])))
        ) {
          await rm(parameters[0])
          await mkdir(parameters[0])
        }
        return look
      },
    }
    const { startDeepWikiReader: startReaderWhosePathsAreTaken } =
      await loadModule<typeof deepWikiReaderModule>(
        join(__dirname, '..', 'deepWikiReader.js'),
        { 'node:fs/promises': fileSystemWhoseLookedAtFileBecomesAFolder },
        { URL },
      )
    const reader = await startReaderWhosePathsAreTaken(
      outputDirectory,
      projectRoot,
      async () => ({ handoff: 'not asked' }),
    )
    context.after(() => reader.close())

    // Act
    const pageResponse = await fetch(reader.url)
    const page = {
      status: pageResponse.status,
      body: await pageResponse.text(),
    }
    const assetResponse = await fetch(new URL('notes.css', reader.url), {
      headers: { 'Sec-Fetch-Dest': 'style' },
    })
    const asset = {
      status: assetResponse.status,
      body: await assetResponse.text(),
    }

    // Assert
    assert.deepEqual(
      { page, asset },
      {
        page: {
          status: 403,
          body: '{"error":"The Wiki file is no regular file; a pipe, a device or a folder at its path is not served."}',
        },
        asset: {
          status: 403,
          body: '{"error":"The Wiki file is no regular file; a pipe, a device or a folder at its path is not served."}',
        },
      },
    )
  },
)

// Value: protects=every page after pages whose path another entry took between the reader's look and its open: each is refused with 403 and must give its place among the pages in hand back; fails_when=a page refused so keeps its place, so the page asked for after six of them is refused as busy until the editor reloads; why_new=Cycle 0047 row 192 (S2SM-U35, the 403 after the open of deepWikiReader.ts); seam=the reader loaded with loadModule and a file system whose lstat puts a regular file back at the page's path before each look and lets a folder take it after the look; no_claim=the real race's timing (the folder takes the path at the look), and Windows, whose open looks at the path itself
test(
  'six pages whose path a folder takes after the reader’s look are each refused with 403 and give their places back, so the page asked for after them is served',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows has no O_NOFOLLOW: its open looks at the path itself and refuses the folder before the reader’s check after the open'
        : false,
  },
  async (context) => {
    // Arrange: a page whose path a folder takes after each look, a page besides it, and a file system that puts the page back as a regular file before each look.
    const projectRoot = await realpath(
      await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-swaps-give-back-')),
    )
    context.after(() => rm(projectRoot, { recursive: true, force: true }))
    const { outputDirectory, manifestPath } =
      await writeMinimalWiki(projectRoot)
    const swappedPage = join(outputDirectory, 'swapped.html')
    await writeFile(swappedPage, '<!doctype html><body>Swapped</body>')
    await writeFile(
      join(outputDirectory, 'later.html'),
      '<!doctype html><body>Later</body>',
    )
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        pages: [{ path: 'swapped.html' }, { path: 'later.html' }],
        assets: [],
        includedSources: [],
      }),
    )
    const fileSystemWhosePageBecomesAFolderAfterEachLook = {
      ...fileSystemPromises,
      lstat: async (...parameters: Parameters<typeof lstat>) => {
        const isSwapped = basename(String(parameters[0])) === 'swapped.html'
        // Each look finds the page as a regular file, and a folder takes its path right after.
        if (isSwapped) {
          await rm(parameters[0], { recursive: true, force: true })
          await writeFile(parameters[0], '<!doctype html><body>Swapped</body>')
        }
        const look = await lstat(...parameters)
        if (isSwapped) {
          await rm(parameters[0])
          await mkdir(parameters[0])
        }
        return look
      },
    }
    const { startDeepWikiReader: startReaderWhosePageIsTaken } =
      await loadModule<typeof deepWikiReaderModule>(
        join(__dirname, '..', 'deepWikiReader.js'),
        { 'node:fs/promises': fileSystemWhosePageBecomesAFolderAfterEachLook },
        { URL },
      )
    const reader = await startReaderWhosePageIsTaken(
      outputDirectory,
      projectRoot,
      async () => ({ handoff: 'not asked' }),
    )
    context.after(() => reader.close())

    // Act: six pages one after another, each answered before the next is asked for, then the page besides them.
    const refusals: { status: number; body: string }[] = []
    for (let request = 0; request < 6; request += 1) {
      const response = await fetch(new URL('swapped.html', reader.url))
      refusals.push({ status: response.status, body: await response.text() })
    }
    const nextResponse = await fetch(new URL('later.html', reader.url))
    const next = {
      status: nextResponse.status,
      body: await nextResponse.text(),
    }

    // Assert: the page besides them is served with the reader's tag, so only its start is compared.
    assert.deepEqual(
      {
        refusals,
        next: {
          status: next.status,
          start: next.body.slice(0, '<!doctype html><body>Later'.length),
        },
      },
      {
        refusals: Array.from({ length: 6 }, () => ({
          status: 403,
          body: '{"error":"The Wiki file is no regular file; a pipe, a device or a folder at its path is not served."}',
        })),
        next: { status: 200, start: '<!doctype html><body>Later' },
      },
    )
  },
)

// Value: protects=the editor's machine against a crafted page that is reloaded or whose tab is closed: the page's worker must stop with the request instead of keeping a core busy until the deadline; fails_when=the reader no longer aborts the page's preparation when the response closes before it is finished, so the worker is abandoned and runs on; why_new=P2T5; seam=the reader loaded with loadModule and a stand-in page-worker module that keeps the signal it is handed and answers only when that signal aborts; no_claim=the real worker's stop at an abort (the page-worker tests cover it)
test('a page whose browser tab goes while the page is prepared has its preparation stopped', async (context) => {
  // Arrange: the one-page Wiki and a reader whose page worker answers only when its request goes.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-page-abort-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  let preparationSignal: AbortSignal | undefined
  let notePreparationStarted = (): void => {}
  const preparationStarted = new Promise<void>((resolveStarted) => {
    notePreparationStarted = resolveStarted
  })
  const workerAnsweringOnlyAtAbort: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: (_html, _options, limits) =>
      new Promise((resolvePage) => {
        preparationSignal = limits.signal
        limits.signal.addEventListener(
          'abort',
          () => resolvePage({ state: 'failed' }),
          { once: true },
        )
        notePreparationStarted()
      }),
  }
  const { startDeepWikiReader: startReaderWithStandInWorker } =
    await loadModule<typeof deepWikiReaderModule>(
      join(__dirname, '..', 'deepWikiReader.js'),
      { './wikiPageWorker': workerAnsweringOnlyAtAbort },
      { URL },
    )
  const reader = await startReaderWithStandInWorker(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  const browserTab = new AbortController()
  const opening = fetch(reader.url, { signal: browserTab.signal }).catch(
    () => 'request gone',
  )
  await preparationStarted

  // Act: the tab goes while the page is prepared.
  browserTab.abort()
  await opening
  const preparationEnd = await within(
    new Promise<'stopped'>((resolveStop) => {
      if (preparationSignal?.aborted) resolveStop('stopped')
      preparationSignal?.addEventListener('abort', () => resolveStop('stopped'))
    }),
    2_000,
  )

  // Assert
  assert.equal(preparationEnd, 'stopped')
})

// Value: protects=the editor's machine against a crafted page whose tab closes while the reader still reads the page file; fails_when=the reader starts listening for the response's close only after the file read, so a request gone during the read is prepared until the deadline; why_new=the P2T5 test closes the tab after the preparation started; Cycle 0047 row 228: the reader reads no page whose tab went while it opened the file, so the read is held here, after the open; seam=the reader loaded with loadModule, a page read that waits for the test, and a stand-in page worker; no_claim=a real browser's close timing
test('a page whose browser tab goes while the reader reads its file has its preparation stopped', async (context) => {
  // Arrange: the one-page Wiki, a page read that waits until the test lets it go on, and a page worker that answers only when its request goes.
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-reader-read-abort-')),
  )
  context.after(() => rm(projectRoot, { recursive: true, force: true }))
  const { outputDirectory } = await writeMinimalWiki(projectRoot)
  let noteReadAsked = (): void => {}
  const readAsked = new Promise<void>((resolveAsked) => {
    noteReadAsked = resolveAsked
  })
  let letReadGoOn = (): void => {}
  const readMayGoOn = new Promise<void>((resolveGoOn) => {
    letReadGoOn = resolveGoOn
  })
  const heldPageRead: typeof readUpToLimitModule = {
    readUpToLimit: async (...parameters) => {
      noteReadAsked()
      await readMayGoOn
      return readUpToLimit(...parameters)
    },
  }
  let preparationSignal: AbortSignal | undefined
  let notePreparationStarted = (): void => {}
  const preparationStarted = new Promise<void>((resolveStarted) => {
    notePreparationStarted = resolveStarted
  })
  const workerAnsweringOnlyAtAbort: typeof wikiPageWorkerModule = {
    servedWikiPageOffThread: (_html, _options, limits) =>
      new Promise((resolvePage) => {
        preparationSignal = limits.signal
        if (limits.signal.aborted) resolvePage({ state: 'failed' })
        limits.signal.addEventListener(
          'abort',
          () => resolvePage({ state: 'failed' }),
          { once: true },
        )
        notePreparationStarted()
      }),
  }
  const { startDeepWikiReader: startReaderWithHeldRead } = await loadModule<
    typeof deepWikiReaderModule
  >(
    join(__dirname, '..', 'deepWikiReader.js'),
    {
      './utils/readUpToLimit': heldPageRead,
      './wikiPageWorker': workerAnsweringOnlyAtAbort,
    },
    { URL },
  )
  const reader = await startReaderWithHeldRead(
    outputDirectory,
    projectRoot,
    async () => ({ handoff: 'not asked' }),
  )
  context.after(() => reader.close())
  // The held read is let go also when the test fails, so its request ends.
  context.after(() => letReadGoOn())
  const browserTab = new AbortController()
  const opening = fetch(reader.url, { signal: browserTab.signal }).catch(
    () => 'request gone',
  )
  await readAsked

  // Act: the tab goes while the page file is read, then the read goes on.
  browserTab.abort()
  await opening
  await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  letReadGoOn()
  await preparationStarted
  const preparationEnd = await within(
    new Promise<'stopped'>((resolveStop) => {
      if (preparationSignal?.aborted) resolveStop('stopped')
      preparationSignal?.addEventListener('abort', () => resolveStop('stopped'))
    }),
    2_000,
  )

  // Assert
  assert.equal(preparationEnd, 'stopped')
})

// Value: protects=the reader's origin, whose page may ask the editor's model, against a script file written into the Wiki folder and named by the manifest, which a page file points at with a script tag, plainly or through a tag it leaves open before the reader's own; fails_when=the reader serves a `.js` file of the Wiki folder as JavaScript again, so the policy's `'self'` lets it run, or a response of the reader (a page, an asset, its own script, an answer, a refusal) comes without `nosniff`, so a browser may run a file of another type as script; why_new=Cycle 0046 /ship Codex review CX16: under a nonce, a script tag left open before the reader's own takes over its nonce in a browser that does not refuse such a tag (Chromium refuses it, Firefox and Safari were not tried); Cycle 0047 row 7 (S11-F5) puts the reader's tag at the body end the parser found, and the open-tag page has none (its `</body>` ends the open tag), so the tag stands at the page's end, inside the open script's text; seam=none (the reader's real responses)
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
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=' 'sha256-IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='; object-src 'none'; base-uri 'none'",
        body: '<!doctype html><body><article><script src="assets/planted.js"></script></article><script src="CLIENT"></script></body>',
      },
      openTag: {
        type: 'text/html; charset=utf-8',
        sniffing: 'nosniff',
        policy:
          "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=' 'sha256-IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='; object-src 'none'; base-uri 'none'",
        body: '<!doctype html><body><article></article><script src="planted.js" </body><script src="CLIENT"></script>',
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

// Value: protects=the shell's own script (the theme button, the offline note of the question form) on every page the reader serves, of this build and of the Wikis earlier builds published; fails_when=the reader's policy no longer names the hash of the script the bundled shell or the shell of 0.2.29.0 carries, so that script is refused and the page's theme button stops working, or a shell's script changes without its hash in the reader's list; why_new=Cycle 0046 /ship repeat review SC1: the shell's script runs by its hash instead of the nonce (D2 changed the bundled shell's script, so the two shells carry two scripts now); seam=none
test('the reader’s policy names the hash of the one script the shell of this build carries and of the one the shell of 0.2.29.0 and every shell before it carries', async (context) => {
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
        ['IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='],
        ['yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s='],
      ],
      policy:
        "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'none'; form-action 'self'; script-src 'self' 'sha256-yZ7XQG21AcjN1eDrvBaukNy20JSJCNwWq5GLQSr8J3s=' 'sha256-IQM/39cvrMJGhTu7L3jOcv4X2HfR2w4pg1fpcbs7+lE='; object-src 'none'; base-uri 'none'",
    },
  )
})
