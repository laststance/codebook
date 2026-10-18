import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { constants as openConstants } from 'node:fs'
import { mkdtemp, open, realpath, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { promisify } from 'node:util'

import {
  createLinkIfAllowed,
  LINK_NOT_ALLOWED,
} from './utils/createLinkIfAllowed'
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

/**
 * Puts a link to a named pipe that nobody writes to at a path of the window's Wiki, in place of the file there; a read that waits on the pipe is released when the test ends, also when its body was stopped at its time bound.
 * @param context - The test, at whose end a writer opens and closes the pipe.
 * @param projectRoot - The window's project, in which the pipe is made.
 * @param wikiFilePath - The file of the Wiki that the link replaces.
 * @returns Whether the link exists; `false` when this user may not create one.
 * @example
 * if (!(await replaceByLinkToPipe(context, window.projectRoot, manifestPath))) return context.skip(LINK_NOT_ALLOWED)
 */
async function replaceByLinkToPipe(
  context: TestContext,
  projectRoot: string,
  wikiFilePath: string,
): Promise<boolean> {
  const pipePath = join(projectRoot, 'a-pipe-nobody-writes-to')
  await promisify(execFile)('mkfifo', [pipePath])
  context.after(() =>
    open(pipePath, openConstants.O_WRONLY | openConstants.O_NONBLOCK).then(
      (writer) => writer.close(),
      () => undefined,
    ),
  )
  await rm(wikiFilePath)
  return createLinkIfAllowed(pipePath, wikiFilePath)
}

// Value: protects=the learner who opens the Wiki of a checkout whose repository carries the Wiki's manifest as a link (row 186: a link to a pipe held "Open LLM Wiki" for good, one to an endless device read 670 MiB first); fails_when=the owner check reads the manifest by name, which follows a link and waits on a pipe without a bound; why_new=Cycle 0046 row 186; seam=none (a real named pipe)
test(
  'Open LLM Wiki on a Wiki whose manifest path holds a link to a named pipe ends at once with a sentence that names the file, and no reader starts',
  {
    timeout: 2_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange
    const window = await openWikiOpeningWindow()
    const manifestPath = join(
      window.projectRoot,
      '.codebook',
      'wiki',
      'codebook-wiki.json',
    )
    const isLinked = await replaceByLinkToPipe(
      context,
      window.projectRoot,
      manifestPath,
    )
    // Registered after the pipe's release, so the project is removed only once no read waits on the pipe.
    context.after(() => window.close())
    if (!isLinked) return context.skip(LINK_NOT_ALLOWED)

    // Act
    await window.open().catch(() => undefined)

    // Assert
    assert.deepEqual(
      { errors: window.errors, readersStarted: window.readers.length },
      {
        errors: [
          `Codebook could not open DeepWiki: Error: The Wiki’s manifest (${manifestPath}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first. Generate it through /codebook in this project, then retry.`,
        ],
        readersStarted: 0,
      },
    )
  },
)

// Value: protects=the learner who opens the Wiki of a checkout whose repository carries the Wiki's entry page as a link (row 186); fails_when=the check of the entry page reads it by name, which follows a link and waits on a pipe without a bound; why_new=Cycle 0046 row 186; seam=none (a real named pipe)
test(
  'Open LLM Wiki on a Wiki whose entry page path holds a link to a named pipe ends at once with a sentence that names the file, and no reader starts',
  {
    timeout: 2_000,
    skip:
      process.platform === 'win32'
        ? 'Windows has no named pipe in a folder, and no mkfifo to create one'
        : false,
  },
  async (context) => {
    // Arrange
    const window = await openWikiOpeningWindow()
    const entryPath = join(
      window.projectRoot,
      '.codebook',
      'wiki',
      'index.html',
    )
    const isLinked = await replaceByLinkToPipe(
      context,
      window.projectRoot,
      entryPath,
    )
    // Registered after the pipe's release, so the project is removed only once no read waits on the pipe.
    context.after(() => window.close())
    if (!isLinked) return context.skip(LINK_NOT_ALLOWED)

    // Act
    await window.open().catch(() => undefined)

    // Assert
    assert.deepEqual(
      { errors: window.errors, readersStarted: window.readers.length },
      {
        errors: [
          `Codebook could not open DeepWiki: Error: The Wiki’s entry page (${entryPath}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first. Generate it through /codebook in this project, then retry.`,
        ],
        readersStarted: 0,
      },
    )
  },
)

// Value: protects=the rule that the Wiki's manifest and entry page are read as files of the Wiki folder and never through a link, on every system (on Windows a link to a file is the case a repository can carry); fails_when=either read follows a link to a regular file elsewhere, so a Wiki whose two files lie outside its folder is opened; why_new=Cycle 0046 row 186: the pipe cases cannot run on Windows; seam=none
test('Open LLM Wiki does not open a Wiki whose manifest or entry page is a link to a regular file elsewhere, and names the file that is no file of its own', async (context) => {
  // Arrange: two windows; in the first the manifest, in the second the entry page is moved out of the Wiki folder and a link to it is left in its place.
  const withLinkedManifest = await openWikiOpeningWindow()
  context.after(() => withLinkedManifest.close())
  const withLinkedEntry = await openWikiOpeningWindow()
  context.after(() => withLinkedEntry.close())
  const manifestPath = join(
    withLinkedManifest.projectRoot,
    '.codebook',
    'wiki',
    'codebook-wiki.json',
  )
  const entryPath = join(
    withLinkedEntry.projectRoot,
    '.codebook',
    'wiki',
    'index.html',
  )
  const manifestElsewhere = join(withLinkedManifest.projectRoot, 'moved.json')
  const entryElsewhere = join(withLinkedEntry.projectRoot, 'moved.html')
  await rename(manifestPath, manifestElsewhere)
  await rename(entryPath, entryElsewhere)
  if (
    !(await createLinkIfAllowed(manifestElsewhere, manifestPath)) ||
    !(await createLinkIfAllowed(entryElsewhere, entryPath))
  )
    return context.skip(LINK_NOT_ALLOWED)

  // Act
  await withLinkedManifest.open().catch(() => undefined)
  await withLinkedEntry.open().catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      withLinkedManifest: {
        errors: withLinkedManifest.errors,
        readersStarted: withLinkedManifest.readers.length,
      },
      withLinkedEntry: {
        errors: withLinkedEntry.errors,
        readersStarted: withLinkedEntry.readers.length,
      },
    },
    {
      withLinkedManifest: {
        errors: [
          `Codebook could not open DeepWiki: Error: The Wiki’s manifest (${manifestPath}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first. Generate it through /codebook in this project, then retry.`,
        ],
        readersStarted: 0,
      },
      withLinkedEntry: {
        errors: [
          `Codebook could not open DeepWiki: Error: The Wiki’s entry page (${entryPath}) is no regular file or is larger than Codebook reads; a link, a folder or a pipe at that path must be removed first. Generate it through /codebook in this project, then retry.`,
        ],
        readersStarted: 0,
      },
    },
  )
})

// Value: protects=the learner who runs "Open LLM Wiki" before any Wiki was generated, the ordinary first use; fails_when=the notice is the one of an entry that is there and is refused, and tells the learner to remove a link, a folder or a pipe at a path that holds nothing (row 231); why_new=Cycle 0046 row 231: a missing file has a sentence of its own; seam=none
test('Open LLM Wiki in a project without a Wiki says that no Wiki was found at its folder and how to generate one, and names nothing to remove', async (context) => {
  // Arrange: two windows; the first project has no Wiki folder at all, the second has a Wiki whose entry page is gone.
  const withoutAWiki = await openWikiOpeningWindow()
  context.after(() => withoutAWiki.close())
  const withoutAnEntryPage = await openWikiOpeningWindow()
  context.after(() => withoutAnEntryPage.close())
  const wikiOfTheFirst = join(withoutAWiki.projectRoot, '.codebook', 'wiki')
  const wikiOfTheSecond = join(
    withoutAnEntryPage.projectRoot,
    '.codebook',
    'wiki',
  )
  await rm(wikiOfTheFirst, { recursive: true })
  await rm(join(wikiOfTheSecond, 'index.html'))

  // Act
  await withoutAWiki.open().catch(() => undefined)
  await withoutAnEntryPage.open().catch(() => undefined)

  // Assert
  assert.deepEqual(
    {
      withoutAWiki: withoutAWiki.errors,
      withoutAnEntryPage: withoutAnEntryPage.errors,
    },
    {
      withoutAWiki: [
        `Codebook could not open DeepWiki: Error: No Wiki was found at ${wikiOfTheFirst}: its manifest (codebook-wiki.json) does not exist. Generate it through /codebook in this project, then retry.`,
      ],
      withoutAnEntryPage: [
        `Codebook could not open DeepWiki: Error: No Wiki was found at ${wikiOfTheSecond}: its entry page (index.html) does not exist. Generate it through /codebook in this project, then retry.`,
      ],
    },
  )
})

// Value: protects=the folder outside the project that a cloned repository's `.codebook` link leads to, when the learner runs "Open LLM Wiki"; fails_when=the open command checks the Wiki's owner by reading its manifest through the link before the reader refuses the path, or opens a reader on the Wiki behind the link; why_new=Cycle 0046 /ship follow-up N3 (the rest of finding F1); seam=none (a junction on Windows, which needs no right)
test('Open LLM Wiki on a Wiki whose `.codebook` folder in the project is a link to a folder outside it refuses before it reads anything behind the link, names the link, and starts no reader', async (context) => {
  // Arrange: the one-page Wiki's `.codebook` folder is moved out of the project, and a link to it stands in its place.
  const window = await openWikiOpeningWindow()
  context.after(() => window.close())
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-opening-outside-')),
  )
  context.after(() => rm(outside, { recursive: true, force: true }))
  await rename(
    join(window.projectRoot, '.codebook'),
    join(outside, 'codebook-moved-out'),
  )
  await symlink(
    join(outside, 'codebook-moved-out'),
    join(window.projectRoot, '.codebook'),
    'junction',
  )

  // Act
  await window.open().catch(() => undefined)

  // Assert
  assert.deepEqual(
    { errors: window.errors, readersStarted: window.readers.length },
    {
      errors: [
        `Codebook could not open DeepWiki: The Wiki folder ${join(window.projectRoot, '.codebook', 'wiki')} lies behind a link or a file in the project (${join(window.projectRoot, '.codebook')}). Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to a folder of yours, move that folder’s files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
      ],
      readersStarted: 0,
    },
  )
})

// Value: protects=the folder outside the project that a cloned repository's `.codebook/wiki` link leads to, when the learner runs "Open LLM Wiki"; fails_when=the open command looks only at the folders above the Wiki folder, so a Wiki folder that is itself a link is read and opened from outside the project, while the publisher and the update start refuse it; why_new=Cycle 0046 /ship repeat review SC2 (critical; the rest of F1); seam=none (a junction on Windows, which needs no right)
test('Open LLM Wiki on a Wiki whose folder `.codebook/wiki` in the project is itself a link to a folder outside it refuses before it reads anything behind the link, names the folder, and starts no reader', async (context) => {
  // Arrange: the one-page Wiki's folder is moved out of the project, and a link to it stands in its place.
  const window = await openWikiOpeningWindow()
  context.after(() => window.close())
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-opening-outside-')),
  )
  context.after(() => rm(outside, { recursive: true, force: true }))
  const wikiFolder = join(window.projectRoot, '.codebook', 'wiki')
  await rename(wikiFolder, join(outside, 'wiki-moved-out'))
  await symlink(join(outside, 'wiki-moved-out'), wikiFolder, 'junction')

  // Act
  await window.open().catch(() => undefined)

  // Assert
  assert.deepEqual(
    { errors: window.errors, readersStarted: window.readers.length },
    {
      errors: [
        `Codebook could not open DeepWiki: The Wiki folder ${wikiFolder} is a link or a file, or leads out of the project. Codebook reads no Wiki through it. Replace it with a real folder (if it is a link to your Wiki’s folder, move its files into the new folder), or set codebook.wikiOutputDirectory to a folder outside the project, then open the Wiki again.`,
      ],
      readersStarted: 0,
    },
  )
})
