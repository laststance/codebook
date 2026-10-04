import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import type { WikiFreshness } from '../utils/inspectDeepWikiFreshness'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import {
  openWikiUpdateWindow,
  type CancellableProgress,
} from './utils/wikiUpdateWindow'

/** A local hour and minute as the editor's locale writes it, for example `21:10` or `09:10 PM`. */
const CLOCK_TIME = String.raw`\d{1,2}:\d{2}(?:\s?[AP]M)?`

const CURRENT: WikiFreshness = {
  status: 'current',
  changedPaths: [],
  addedPaths: [],
}

const INDEX_PAGE = '<title>Wiki</title>'

/** Writes a published manifest and its receipt the way a publish through the publisher would: both as new files, the receipt naming the manifest's hash. */
async function writePublishedWiki(
  outputDirectory: string,
  projectRoot: string,
  sourceHash: string,
  options: { excludedPaths?: string[]; recordsPageHashes?: boolean } = {},
): Promise<void> {
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  const receiptPath = join(outputDirectory, 'codebook-publication.json')
  const manifestText = JSON.stringify({
    schemaVersion: 1,
    repositoryRoot: projectRoot,
    generated: { revision: 'a1b2c3d4e5f6a7b8' },
    pages: [],
    assets: [],
    excludedPaths: options.excludedPaths ?? [],
    includedSources: [{ path: 'src/a.ts', sha256: sourceHash }],
    // The publisher records the hash of every generated file; a Wiki published before it did has none.
    ...(options.recordsPageHashes
      ? {
          ownedFiles: {
            'index.html': createHash('sha256').update(INDEX_PAGE).digest('hex'),
          },
        }
      : {}),
  })
  // Each file is written beside the old one and moved over it, so it has another inode than the one it replaces.
  await writeFile(`${manifestPath}.next`, manifestText)
  await rename(`${manifestPath}.next`, manifestPath)
  await writeFile(
    `${receiptPath}.next`,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'published',
      manifestSha256: createHash('sha256').update(manifestText).digest('hex'),
    }),
  )
  await rename(`${receiptPath}.next`, receiptPath)
}

/** Opens a window on a project with a hand-written published Wiki and records what the learner sees of an update; `recordsPageHashes` publishes the Wiki with the hash of its index page, as the publisher does today. */
async function openWikiWindow(
  options: Omit<
    Parameters<typeof openWikiUpdateWindow>[0],
    'projectRoot' | 'outputSetting'
  > & { outputSetting?: string; recordsPageHashes?: boolean } = {},
) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-'))
  const projectRoot = await realpath(projectDirectory)
  const outputSetting = options.outputSetting ?? '.codebook/wiki'
  const outputDirectory = join(projectRoot, outputSetting)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'index.html'), INDEX_PAGE)
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  /** Publishes the Wiki again the way an agent's publish would change it. */
  const publish = (
    sourceHash: string,
    excludedPaths: string[] = [],
  ): Promise<void> =>
    writePublishedWiki(outputDirectory, projectRoot, sourceHash, {
      excludedPaths,
      recordsPageHashes: options.recordsPageHashes,
    })
  await publish('a'.repeat(64))
  const window = await openWikiUpdateWindow({
    ...options,
    projectRoot,
    outputSetting,
  })
  return {
    ...window,
    projectRoot,
    outputDirectory,
    manifestPath,
    publish,
    /** Closes the window and keeps the project on disk, for a test that looks at what a closed window still does. */
    closeWindow: (): Promise<void> => window.close(),
    async close(): Promise<void> {
      await window.close()
      await rm(projectDirectory, { recursive: true, force: true })
    },
  }
}

/** Waits until the update state leaves `running`, polling the way the reader page does. */
async function waitForEnd(
  status: () => WikiUpdateStatus,
  limitMs = 6_000,
): Promise<WikiUpdateStatus> {
  const deadline = Date.now() + limitMs
  while (status().state === 'running' && Date.now() < deadline)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  return status()
}

test('a VS Code Wiki update shows running, then the new identity once the editor agent publishes', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    // Act
    await wiki.clickUpdate()
    const whileWaiting = wiki.status()
    wiki.setFreshness(CURRENT)
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(whileWaiting.state, 'running')
    assert.equal(ended.state, 'succeeded')
    assert.match(
      ended.state === 'succeeded' ? ended.identity : '',
      /^a1b2c3d4e5f6\+[0-9a-f]{8}$/,
    )
    assert.deepEqual(
      wiki.chatRequests.map((request) => request.name),
      ['workbench.action.chat.open'],
    )
    assert.equal(wiki.notices.length, 1)
    assert.match(
      wiki.notices[0] ?? '',
      new RegExp(
        `^Updated at ${CLOCK_TIME} to revision a1b2c3d4e5f6 \\(index [0-9a-f]{8}\\)\\. Reload the browser reader to read the new pages\\.$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})

test('cancelling a VS Code Wiki update ends it as cancelled and leaves the published site byte-identical', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openWikiWindow({ cancellable: progress })
  const manifestBefore = await readFile(wiki.manifestPath)
  const indexBefore = await readFile(join(wiki.outputDirectory, 'index.html'))
  try {
    await wiki.clickUpdate()

    // Act
    progress[0]!.cancel()
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'cancelled')
    assert.deepEqual(
      ended.state === 'cancelled' ? [ended.host, ended.site] : [],
      ['vscode', 'kept'],
    )
    assert.deepEqual(wiki.progressTitles, [
      'Watching for the LLM Wiki update from the editor chat (Cancel stops watching, not the chat)',
    ])
    assert.equal(wiki.notices.length, 1)
    assert.match(
      wiki.notices[0] ?? '',
      new RegExp(
        `^Stopped watching at ${CLOCK_TIME}\\. The VS Code chat may still be working and can still publish; stop it in the chat to cancel the update itself\\. Nothing has been replaced so far\\.$`,
      ),
    )
    assert.deepEqual(wiki.errors, [])
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
    assert.deepEqual(
      await readFile(join(wiki.outputDirectory, 'index.html')),
      indexBefore,
    )
  } finally {
    await wiki.close()
  }
})

// Value: protects=every update running inside the editor's progress notification, the only place its Cancel button is, in tests as in a real editor; fails_when=the test window offers the notification only to a test that collects Cancel buttons, so every other test runs a fallback no editor takes, or the notification's task no longer runs the watch or the agent; why_new=Cycle 0045 D-L8 with PC-5.10 (the title is recorded before the task runs, so the end of each run is asserted too); seam=none
test('every Wiki update shows one progress notification that can be cancelled, also when nobody cancels it', async () => {
  // Arrange: one window per host, and neither collects a Cancel button.
  const vsCodeWiki = await openWikiWindow()
  let publishFromCursor: (() => Promise<void>) | undefined
  const cursorWiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await publishFromCursor!()
      return 'Updated'
    },
  })
  publishFromCursor = async (): Promise<void> => {
    cursorWiki.setFreshness(CURRENT)
    await cursorWiki.publish('c'.repeat(64))
  }
  try {
    // Act: each run ends through the task of its notification, the watch in VS Code and the agent in Cursor.
    await vsCodeWiki.clickUpdate()
    vsCodeWiki.setFreshness(CURRENT)
    await vsCodeWiki.publish('b'.repeat(64))
    const vsCodeEnd = await waitForEnd(vsCodeWiki.status)
    await cursorWiki.clickUpdate()

    // Assert
    assert.deepEqual(vsCodeWiki.progressTitles, [
      'Watching for the LLM Wiki update from the editor chat (Cancel stops watching, not the chat)',
    ])
    assert.deepEqual(cursorWiki.progressTitles, [
      'Updating LLM Wiki with Cursor Agent',
    ])
    assert.equal(vsCodeEnd.state, 'succeeded')
    assert.equal(cursorWiki.status().state, 'succeeded')
  } finally {
    await vsCodeWiki.close()
    await cursorWiki.close()
  }
})

test('a Wiki that already matches the source says so and opens no chat request', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  wiki.setFreshness(CURRENT)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'already-current')
    assert.deepEqual(wiki.chatRequests, [])
    assert.equal(wiki.notices.length, 1)
    assert.match(
      wiki.notices[0] ?? '',
      new RegExp(
        `^Already current \\(checked ${CLOCK_TIME}\\): this Wiki matches the source, so no update started\\.$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})

test('a chat that cannot open ends the update as failed, says what to install and shows one error notice with Open LLM Wiki that does not claim the update could not start', async () => {
  // Arrange
  const wiki = await openWikiWindow({ chatFails: true })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'The editor chat could not be opened (Chat is unavailable). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.',
    )
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
      new RegExp(
        `^Update failed at ${CLOCK_TIME}: The editor chat could not be opened \\(Chat is unavailable\\)\\. Install or enable GitHub Copilot Chat, then press Update LLM Wiki again\\. The last usable site is kept\\.$`,
      ),
    )
    assert.deepEqual(wiki.offeredActions, [
      { message: wiki.errors[0], actions: ['Open LLM Wiki'] },
    ])
  } finally {
    await wiki.close()
  }
})

// Value: protects=the next step on the Wiki page when the editor's chat command fails with a long error; fails_when=the failure is recorded as an outside text, so the page cuts it at 160 characters and "Install or enable GitHub Copilot Chat…" is hidden in the disclosure, or the editor's text is quoted without a bound; why_new=Cycle 0045 local review wiki-1 #9; seam=none
test('a chat that cannot open with a long error is recorded as Codebook’s own sentence, with the error cut and the next step kept', async () => {
  // Arrange: the chat command throws a text of 150 characters.
  const wiki = await openWikiWindow({
    chatFails:
      `No chat provider is registered for this window: ${'the extension host did not answer. '.repeat(3)}`.slice(
        0,
        150,
      ),
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.deepEqual(
      status.state === 'failed'
        ? [status.reason, status.isCodebookSentence]
        : [],
      [
        'The editor chat could not be opened (No chat provider is registered for this window: the extension host did not answer. the extension host did not answer. th…). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.',
        true,
      ],
    )
  } finally {
    await wiki.close()
  }
})

test('a configured Wiki output folder is the one the update state names', async () => {
  // Arrange
  const wiki = await openWikiWindow({ outputSetting: 'docs/my-wiki' })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'running')
    assert.equal(
      status.state === 'running' ? status.outputDirectory : '',
      join(wiki.projectRoot, 'docs/my-wiki'),
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update that fails ends as failed with the agent message and keeps the site', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      throw new Error('Cursor Agent exited with code 1.')
    },
  })
  const manifestBefore = await readFile(wiki.manifestPath)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent exited with code 1.',
    )
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
      new RegExp(
        `^Update failed at ${CLOCK_TIME}: Cursor Agent exited with code 1\\. The last usable site is kept\\.$`,
      ),
    )
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update the learner cancels ends as cancelled and shows a cancelled notice, no error', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openWikiWindow({
    cursor: true,
    cancellable: progress,
    cursorAgent: async () => {
      progress[0]!.cancel()
      throw new Error('The Wiki update was cancelled.')
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'cancelled')
    assert.deepEqual(wiki.errors, [])
    assert.equal(wiki.notices.length, 1)
    assert.match(
      wiki.notices[0] ?? '',
      new RegExp(
        `^Update cancelled at ${CLOCK_TIME}\\. Cursor Agent was stopped\\. The last usable site is kept\\.$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor Wiki update that publishes ends as succeeded with the new identity', async () => {
  // Arrange
  let publishNew: (() => Promise<void>) | undefined
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await publishNew!()
      return 'Updated'
    },
  })
  publishNew = async (): Promise<void> => {
    wiki.setFreshness(CURRENT)
    await wiki.publish('c'.repeat(64))
  }
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'succeeded')
    assert.match(
      status.state === 'succeeded' ? status.identity : '',
      /^a1b2c3d4e5f6\+[0-9a-f]{8}$/,
    )
    assert.equal(wiki.notices.length, 1)
    assert.match(
      wiki.notices[0] ?? '',
      new RegExp(
        `^Updated at ${CLOCK_TIME} to revision a1b2c3d4e5f6 \\(index [0-9a-f]{8}\\)\\. Reload the browser reader to read the new pages\\.$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})

test('a VS Code update that publishes the same sources and revision again still ends as succeeded', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act: the agent resolves the stale state by excluding a new file; sources and revision stay as they were.
    wiki.setFreshness(CURRENT)
    await wiki.publish('a'.repeat(64), ['scratch'])
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'succeeded')
    assert.equal(
      ended.state === 'succeeded' ? ended.identity : '',
      'a1b2c3d4e5f6+296fae53',
    )
  } finally {
    await wiki.close()
  }
})

test('a publish that no longer matches the source says the site was replaced and how many files changed', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act
    wiki.setFreshness({
      status: 'changed',
      changedPaths: ['src/a.ts', 'src/b.ts'],
      addedPaths: [],
    })
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(ended.state === 'failed' ? ended.site : '', 'replaced')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The editor agent published a new Wiki, but 2 source files changed while it worked (first: src/a.ts). Press Update LLM Wiki again.',
    )
  } finally {
    await wiki.close()
  }
})

test('a publish Codebook cannot check against the source passes the reason on and says a retry will not help', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act
    wiki.setFreshness({
      status: 'unknown',
      changedPaths: [],
      addedPaths: [],
      reason:
        'Added source files could not be checked against the generated revision.',
    })
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(ended.state === 'failed' ? ended.site : '', 'replaced')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The editor agent published a new Wiki, but Codebook cannot check it against the source: Added source files could not be checked against the generated revision. Updating again will not change this; ask the editor chat to republish with the full commit hash in generated.revision.',
    )
  } finally {
    await wiki.close()
  }
})

test('the bound a Cursor update is stopped at is the bound its page and its request name', async () => {
  // Arrange
  let boundTheAgentIsStoppedAt: number | undefined
  let timeoutOnThePage: number | undefined
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async (_root, _prompt, _signal, timeoutMs) => {
      boundTheAgentIsStoppedAt = timeoutMs
      const running = wiki.status()
      timeoutOnThePage =
        running.state === 'running' ? running.timeoutMs : undefined
      return 'Updated'
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(timeoutOnThePage, 900_000)
    assert.equal(boundTheAgentIsStoppedAt, 900_000)
  } finally {
    await wiki.close()
  }
})

test('a Cursor update that runs past its bound ends as timed out, the state VS Code reports for the same event', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      const timedOut = new Error('Cursor Agent timed out updating the Wiki.')
      timedOut.name = 'WikiUpdateTimedOut'
      throw timedOut
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'timed-out')
    assert.equal(status.state === 'timed-out' ? status.site : '', 'kept')
    assert.equal(status.state === 'timed-out' ? status.timeoutMs : 0, 900_000)
  } finally {
    await wiki.close()
  }
})

test('a Cursor agent that publishes and then fails is shown as a failure that replaced the site, not one that kept it', async () => {
  // Arrange
  let publishNew: (() => Promise<void>) | undefined
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await publishNew?.()
      throw new Error('Cursor Agent stopped with exit code 1 before finishing.')
    },
  })
  // The window's freshness stays "changed": this publish does not match the source, so the agent's failure is what the run ends with. A publish that matches ends as Updated whatever the CLI reported.
  publishNew = (): Promise<void> => wiki.publish('c'.repeat(64))
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.state === 'failed' ? status.site : '', 'replaced')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent stopped with exit code 1 before finishing.',
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor agent that ends its turn without publishing is a failure that kept the site', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => 'I could not update the Wiki.',
  })
  const manifestBefore = await readFile(wiki.manifestPath)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.state === 'failed' ? status.site : '', 'kept')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'Cursor Agent finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
    )
    assert.deepEqual(await readFile(wiki.manifestPath), manifestBefore)
  } finally {
    await wiki.close()
  }
})

// Value: protects=the browser's update link starting nothing unless the learner confirms it in the editor, since any page can open that link; fails_when=a dismissed confirmation still starts the update, so a chat request is sent and a watch begins; why_new=Cycle 0045 D-L7 (no test dismissed the confirmation through this window); seam=none
test("dismissing the confirmation of the browser's update link starts no update: no chat request, no watch, and the update state stays idle", async () => {
  // Arrange: the learner dismisses the modal confirmation.
  const wiki = await openWikiWindow({ declineConfirmation: true })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(wiki.confirmations, [
      'Update this project’s LLM Wiki with the editor agent?',
    ])
    assert.deepEqual(wiki.chatRequests, [])
    assert.deepEqual(wiki.progressTitles, [])
    assert.equal(wiki.status().state, 'idle')
  } finally {
    await wiki.close()
  }
})

test('a second start from the browser link is refused before the confirmation is shown and says where the progress is', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.confirmations.length, 1)
    assert.deepEqual(wiki.notices, [
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
    ])
    assert.equal(wiki.chatRequests.length, 1)
  } finally {
    await wiki.close()
  }
})

// Value: protects=one update run per window when two entries start it before the first has finished its start checks; fails_when=the second start no longer joins the first while its checks still run, so both pass the running check and two chat requests and two watches begin; why_new=the second-start tests press again only once the first run is recorded as running; seam=none
test('the update command and the browser link pressed while the first start is still in its start checks send one chat request and start one watch', async () => {
  // Arrange: the freshness inspection of the first start's checks is held open.
  const wiki = await openWikiWindow({ cancellable: [] })
  try {
    const inspection = wiki.hold('freshness-inspection')
    const commandStart = wiki.runUpdateCommand()
    await inspection.started

    // Act: the browser link is confirmed before the held check answers.
    const linkStart = wiki.clickUpdate()
    inspection.release()
    await Promise.all([commandStart, linkStart])

    // Assert
    assert.deepEqual(
      wiki.chatRequests.map((request) => request.name),
      ['workbench.action.chat.open'],
    )
    assert.deepEqual(wiki.progressTitles, [
      'Watching for the LLM Wiki update from the editor chat (Cancel stops watching, not the chat)',
    ])
    assert.equal(wiki.status().state, 'running')
    assert.deepEqual(wiki.errors, [])
  } finally {
    await wiki.close()
  }
})

test('updating before any Wiki exists says to generate one first instead of showing a file error', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  await rm(wiki.outputDirectory, { recursive: true })
  try {
    // Act
    await wiki.runUpdateCommand()

    // Assert
    assert.deepEqual(wiki.errors, [
      'Codebook found no LLM Wiki in .codebook/wiki. Ask the editor chat "/codebook Generate the LLM Wiki for this project", then update it.',
    ])
    assert.equal(wiki.status().state, 'idle')
    assert.deepEqual(wiki.chatRequests, [])
  } finally {
    await wiki.close()
  }
})

test('an update of a Wiki that belongs to another checkout says the update could not start, without an "Error:" prefix, and the page reads the same reason as a failed start', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  const foreignManifest = JSON.stringify({
    schemaVersion: 1,
    repositoryRoot: '/another/checkout',
  })
  await writeFile(wiki.manifestPath, foreignManifest)
  await writeFile(
    join(wiki.outputDirectory, 'codebook-publication.json'),
    JSON.stringify({
      kind: 'published',
      manifestSha256: createHash('sha256')
        .update(foreignManifest)
        .digest('hex'),
    }),
  )
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(wiki.errors, [
      'Codebook could not start the Wiki update: The DeepWiki manifest does not identify this opened project.',
    ])
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'The DeepWiki manifest does not identify this opened project.',
    )
    assert.equal(status.state === 'failed' ? status.site : '', 'kept')
    assert.deepEqual(wiki.chatRequests, [])
  } finally {
    await wiki.close()
  }
})

test('the VS Code update request tells the chat that the publish must match the source within the 15 minute watch', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(wiki.chatRequests, [
      {
        name: 'workbench.action.chat.open',
        query: `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(wiki.manifestPath)} and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths. If you cannot publish, say why in your reply and stop. Then report changed pages and citations. Do not start a debugger or application.`,
      },
    ])
  } finally {
    await wiki.close()
  }
})

test('the Cursor update request carries the same contract but asks for no report nobody would read', async () => {
  // Arrange
  const prompts: string[] = []
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async (_root, prompt) => {
      prompts.push(prompt)
      return 'Updated'
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(prompts, [
      `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(wiki.manifestPath)} and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, generated.revision is the full commit hash of HEAD, and every file added since that revision is indexed or covered by excludedPaths. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.`,
    ])
  } finally {
    await wiki.close()
  }
})

// Value: protects=the request an agent gets in a project without Git (it must not be asked for a commit hash, and must be told not to create a repository in the learner's project); fails_when=the freshness check reports the missing repository on its `current` answer only, so every run that starts is worded for a Git repository; why_new=Cycle 0045 local review wiki-1 #1 (the window's fake freshness hid it); seam=none
test('the update request for a project without a Git repository asks for no revision and tells the chat not to create a repository', async () => {
  // Arrange: the real freshness check runs, on a project folder that is in no Git repository and whose indexed source is gone.
  const ceilingBefore = process.env.GIT_CEILING_DIRECTORIES
  const wiki = await openWikiWindow({ realFreshnessCheck: true })
  // An enclosing repository of the temporary folder, if a machine has one, must not answer for the project.
  process.env.GIT_CEILING_DIRECTORIES = dirname(wiki.projectRoot)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(wiki.chatRequests, [
      {
        name: 'workbench.action.chat.open',
        query: `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(wiki.manifestPath)} and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk. This folder has no Git repository: record no revision and do not create one. If you cannot publish, say why in your reply and stop. Then report changed pages and citations. Do not start a debugger or application.`,
      },
    ])
  } finally {
    if (ceilingBefore === undefined) delete process.env.GIT_CEILING_DIRECTORIES
    else process.env.GIT_CEILING_DIRECTORIES = ceilingBefore
    await wiki.close()
  }
})

test('closing the window while a VS Code update is watched stops the watch and shows no notification to a window that is gone', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  await wiki.clickUpdate()
  const whileWatched = wiki.status()

  // Act
  await wiki.close()

  // Assert
  assert.equal(whileWatched.state, 'running')
  assert.equal(wiki.status().state, 'cancelled')
  assert.deepEqual(wiki.notices, [])
})

// Value: protects=the first press after a window was reloaded during a VS Code watch; fails_when=the closing window records that its chat "may still be updating", although the chat ended with the window, so the reloaded window refuses the press for up to fifteen minutes; why_new=Cycle 0045 local review wiki-1 #8; seam=none
test('a window that was reloaded while it watched a VS Code update starts the next update at once', async () => {
  // Arrange: one window before and after its reload shares the workspace state.
  const workspaceState = new Map<string, unknown>()
  const wiki = await openWikiWindow({ workspaceState })
  await wiki.clickUpdate()
  const whileWatched = wiki.status().state
  await wiki.closeWindow()
  const reloaded = await openWikiUpdateWindow({
    projectRoot: wiki.projectRoot,
    workspaceState,
  })
  try {
    // Act
    await reloaded.clickUpdate()

    // Assert
    assert.equal(whileWatched, 'running')
    assert.equal(wiki.status().state, 'cancelled')
    assert.equal(reloaded.status().state, 'running')
    assert.equal(reloaded.chatRequests.length, 1)
    assert.deepEqual(reloaded.errors, [])
  } finally {
    await reloaded.close()
    await rm(wiki.projectRoot, { recursive: true, force: true })
  }
})

// The bound is twice the default termination grace: an agent that is never started fails this test instead of hanging its file.
test(
  'closing the window stops the Cursor agent and waits until its process has closed',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const agent = { sawAbort: false, hasClosed: false }
    let reportAgentStarted = (): void => {}
    const agentStarted = new Promise<void>((resolveStarted) => {
      reportAgentStarted = resolveStarted
    })
    const wiki = await openWikiWindow({
      cursor: true,
      // This agent ends only when its run is aborted, and then needs a moment to close, like a real process.
      cursorAgent: (_root, _prompt, signal) =>
        new Promise((_resolve, reject) => {
          reportAgentStarted()
          signal?.addEventListener('abort', () => {
            agent.sawAbort = true
            setTimeout(() => {
              agent.hasClosed = true
              reject(new Error('The Wiki update was cancelled.'))
            }, 100)
          })
        }),
    })
    const click = wiki.clickUpdate()
    // The update has passed its start checks once the agent is called, however long they took.
    await agentStarted
    const whileRunning = wiki.status()

    // Act
    await wiki.close()

    // Assert
    assert.equal(whileRunning.state, 'running')
    assert.deepEqual(agent, { sawAbort: true, hasClosed: true })
    assert.equal(wiki.status().state, 'cancelled')
    assert.deepEqual(wiki.notices, [])
    await click
  },
)

// Cycle 0044 review B-M1: red while an update that was still in its start checks at shutdown went on to start its run, which the closing window had already looked for and nothing aborted.
test('closing the window while a Cursor update is still in its start checks starts no agent once the checks have ended', async () => {
  // Arrange: the freshness inspection of the start checks is held open.
  let agentStarts = 0
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      agentStarts += 1
      return 'Updated'
    },
  })
  try {
    const inspection = wiki.hold('freshness-inspection')
    const click = wiki.clickUpdate()
    await inspection.started

    // Act: the window closes, then the held check answers.
    await wiki.closeWindow()
    inspection.release()
    await click

    // Assert
    assert.equal(agentStarts, 0)
    assert.equal(wiki.status().state, 'idle')
  } finally {
    await wiki.close()
  }
})

test('closing the window while a VS Code update is still in its start checks sends no chat request and starts no watch once the checks have ended', async () => {
  // Arrange: the freshness inspection of the start checks is held open.
  const wiki = await openWikiWindow({ cancellable: [] })
  try {
    const inspection = wiki.hold('freshness-inspection')
    const click = wiki.clickUpdate()
    await inspection.started

    // Act: the window closes, then the held check answers.
    await wiki.closeWindow()
    inspection.release()
    await click

    // Assert
    assert.deepEqual(wiki.chatRequests, [])
    assert.deepEqual(wiki.progressTitles, [])
    assert.equal(wiki.status().state, 'idle')
  } finally {
    await wiki.close()
  }
})

test('closing the window while the VS Code chat is still opening ends the update as cancelled and starts no watch once the chat has opened', async () => {
  // Arrange: the run has begun and the chat command has not answered yet.
  const wiki = await openWikiWindow({ cancellable: [] })
  try {
    const chat = wiki.hold('chat-open')
    const click = wiki.clickUpdate()
    await chat.started
    const whileChatOpens = wiki.status().state

    // Act: the window closes, then the chat opens.
    await wiki.closeWindow()
    chat.release()
    await click

    // Assert
    assert.equal(whileChatOpens, 'running')
    assert.deepEqual(wiki.progressTitles, [])
    assert.equal(wiki.status().state, 'cancelled')
    assert.deepEqual(wiki.notices, [])
  } finally {
    await wiki.close()
  }
})

// Value: protects=what a window leaves beside the Wiki when it closes while the VS Code chat is still opening; fails_when=the closing window does not wait for the run it aborted there, so the run's end is recorded after the shutdown looked for a reservation, and its marker stays on disk for other windows to read; why_new=Cycle 0045 local review runtime-2 #4; seam=the read of the publish token at the run's end, which is kept open
test('a window that closes while the VS Code chat is still opening waits until the run it stopped has ended, and leaves no marker beside the Wiki', async () => {
  // Arrange: the chat command has not answered, and the read the run's end begins with is kept open.
  const wiki = await openWikiWindow({ cancellable: [] })
  try {
    const chat = wiki.hold('chat-open')
    const click = wiki.clickUpdate()
    await chat.started
    const endOfTheRun = wiki.hold('publish-token-read')

    // Act: the window closes; the stopped run reaches its end and is held there for a moment.
    let hasWindowClosed = false
    const closing = wiki.closeWindow().then(() => {
      hasWindowClosed = true
    })
    await endOfTheRun.started
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    const closedBeforeTheRunEnded = hasWindowClosed
    endOfTheRun.release()
    await closing
    const stateWhenClosed = wiki.status().state
    const markerWhenClosed = await access(
      `${wiki.outputDirectory}.update-run.json`,
    ).then(
      () => 'on disk',
      () => 'gone',
    )
    chat.release()
    await click

    // Assert
    assert.equal(closedBeforeTheRunEnded, false)
    assert.equal(stateWhenClosed, 'cancelled')
    assert.equal(markerWhenClosed, 'gone')
    assert.deepEqual(wiki.progressTitles, [])
  } finally {
    await wiki.close()
  }
})

test(
  'a Cursor agent that does not stop is not waited for longer than the termination grace when the window closes',
  { timeout: 5_000 },
  async () => {
    // Arrange
    let agentStarts = 0
    let reportAgentStarted = (): void => {}
    const agentStarted = new Promise<void>((resolveStarted) => {
      reportAgentStarted = resolveStarted
    })
    const wiki = await openWikiWindow({
      cursor: true,
      constants: { WIKI_CURSOR_TERMINATION_GRACE_MS: 100 },
      // This agent never ends, also not when its run is aborted.
      cursorAgent: () => {
        agentStarts += 1
        reportAgentStarted()
        return new Promise(() => {})
      },
    })
    void wiki.clickUpdate()
    // The update has passed its start checks once the agent is called, however long they took.
    await agentStarted
    const closeStartedAtMs = Date.now()

    // Act
    await wiki.close()

    // Assert
    const waitedMs = Date.now() - closeStartedAtMs
    assert.equal(agentStarts, 1)
    assert.ok(
      waitedMs >= 90 && waitedMs < 2_000,
      `the window waited ${waitedMs} ms for a grace of 100 ms`,
    )
  },
)

test('an update of a Wiki whose index.html was deleted is refused as a missing generated page that names index.html, with no file error and no chat request', async () => {
  // Arrange
  const wiki = await openWikiWindow({ recordsPageHashes: true })
  await rm(join(wiki.outputDirectory, 'index.html'))
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'conflict')
    assert.equal(
      status.state === 'conflict' ? status.cause : '',
      'missing-page',
    )
    assert.deepEqual(status.state === 'conflict' ? status.paths : [], [
      'index.html',
    ])
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
      new RegExp(
        `^Update not started \\(${CLOCK_TIME}\\): a generated page is missing \\(index\\.html\\)\\. Restore it from Git or the editor’s local history; if you cannot, move the Wiki folder aside and ask the editor chat "/codebook Generate the LLM Wiki for this project"\\.$`,
      ),
    )
    assert.deepEqual(wiki.chatRequests, [])
  } finally {
    await wiki.close()
  }
})

test('with an unchanged source a deleted generated page is still refused as missing, not answered as Already current', async () => {
  // Arrange
  const wiki = await openWikiWindow({ recordsPageHashes: true })
  wiki.setFreshness(CURRENT)
  await rm(join(wiki.outputDirectory, 'index.html'))
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'conflict')
    assert.equal(
      status.state === 'conflict' ? status.cause : '',
      'missing-page',
    )
    assert.deepEqual(wiki.notices, [])
  } finally {
    await wiki.close()
  }
})

test('an update of a Wiki published without recorded page hashes whose index.html was deleted starts', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  await rm(join(wiki.outputDirectory, 'index.html'))
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'running')
    assert.equal(wiki.chatRequests.length, 1)
    assert.deepEqual(wiki.errors, [])
  } finally {
    await wiki.close()
  }
})

test('an update whose start checks throw is answered on the page as a start that failed, with the reason, instead of a wait for a confirmation', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    publishTokenReadFails: 'EIO: i/o error, read',
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'EIO: i/o error, read',
    )
    assert.equal(status.state === 'failed' ? status.site : '', 'kept')
    assert.deepEqual(wiki.errors, [
      'Codebook could not start the Wiki update: EIO: i/o error, read',
    ])
  } finally {
    await wiki.close()
  }
})

test('an update that fails with a thrown object that only carries a message shows that message, not [object Object]', async () => {
  // Arrange
  const thrownByTheAgent: unknown = { message: 'The agent lost its session.' }
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      throw thrownByTheAgent
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'The agent lost its session.',
    )
  } finally {
    await wiki.close()
  }
})

test('a VS Code watch that itself fails ends the update as failed with that reason and frees the button', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    watchClock: {
      now: () => {
        throw new Error('The clock stopped.')
      },
      sleep: async () => {},
    },
  })
  try {
    // Act
    await wiki.clickUpdate()
    const ended = await waitForEnd(wiki.status)
    await wiki.clickUpdate()
    await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The clock stopped.',
    )
    assert.match(
      wiki.errors[0] ?? '',
      new RegExp(
        `^Update failed at ${CLOCK_TIME}: The clock stopped\\. The last usable site is kept\\.$`,
      ),
    )
    // The second press was not refused as "already updating": it sent its own request.
    assert.equal(wiki.chatRequests.length, 2)
    assert.equal(wiki.errors.length, 2)
  } finally {
    await wiki.close()
  }
})

test('a Cursor update during which another repository was opened ends as failed and says to reopen the Wiki', async () => {
  // Arrange
  const otherRepository = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-other-')),
  )
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      // The learner opens another folder in this window while the agent works.
      wiki.openWorkspace(otherRepository)
      return 'Updated'
    },
  })
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(
      status.state === 'failed' ? status.reason : '',
      'The opened repository changed during the Wiki update. Reopen its Wiki to see the result.',
    )
  } finally {
    await wiki.close()
    await rm(otherRepository, { recursive: true, force: true })
  }
})

test('a chat that never opens ends the update as failed at its bound, and the next press can start', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    constants: { WIKI_CHAT_OPEN_TIMEOUT_MS: 100 },
  })
  const chatThatNeverOpens = wiki.hold('chat-open')
  try {
    // Act: the press is raced against two seconds, so a start that waits for the chat forever fails here instead of hanging.
    const firstPress = await Promise.race([
      wiki.clickUpdate().then(() => 'ended'),
      new Promise((resolveWait) =>
        setTimeout(() => resolveWait('still waiting for the chat'), 2_000),
      ),
    ])
    const afterFirstPress = wiki.status()
    chatThatNeverOpens.release()
    await wiki.clickUpdate()

    // Assert
    assert.equal(firstPress, 'ended')
    assert.equal(afterFirstPress.state, 'failed')
    assert.equal(
      afterFirstPress.state === 'failed' ? afterFirstPress.reason : '',
      'The editor chat did not open within 0.1 seconds. Check that GitHub Copilot Chat is installed and enabled, then press Update LLM Wiki again.',
    )
    assert.equal(wiki.status().state, 'running')
  } finally {
    chatThatNeverOpens.release()
    await wiki.close()
  }
})

test('in Cursor a second Update LLM Wiki command while the agent works says that Codebook is already updating and starts no second agent', async () => {
  // Arrange
  let agentStarts = 0
  let reportAgentStart = (): void => {}
  const agentStarted = new Promise<void>((resolveStarted) => {
    reportAgentStart = resolveStarted
  })
  let letAgentFinish = (): void => {}
  const agentMayFinish = new Promise<void>((resolveFinish) => {
    letAgentFinish = resolveFinish
  })
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      agentStarts += 1
      reportAgentStart()
      await agentMayFinish
      return 'Updated'
    },
  })
  try {
    const firstCommand = wiki.runUpdateCommand()
    await agentStarted

    // Act
    const secondCommand = wiki.runUpdateCommand()
    const noticesWhileTheAgentWorks = [...wiki.notices]
    letAgentFinish()
    await Promise.all([firstCommand, secondCommand])

    // Assert
    assert.deepEqual(noticesWhileTheAgentWorks, [
      'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.',
    ])
    assert.equal(agentStarts, 1)
  } finally {
    letAgentFinish()
    await wiki.close()
  }
})

test('a second window’s Update is refused while the first window’s run has staged nothing yet', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  const secondWindow = await openWikiUpdateWindow({
    projectRoot: wiki.projectRoot,
  })
  try {
    await wiki.clickUpdate()

    // Act
    await secondWindow.clickUpdate()

    // Assert
    const refused = secondWindow.status()
    assert.equal(wiki.status().state, 'running')
    assert.equal(refused.state, 'failed')
    assert.match(
      refused.state === 'failed' ? refused.reason : '',
      /^Another editor window is updating this Wiki \(VS Code, started \d{1,2}:\d{2}[^)]*\)\. Wait for it to finish, then press Update LLM Wiki again\.$/,
    )
    assert.deepEqual(secondWindow.chatRequests, [])
  } finally {
    await secondWindow.close()
    await wiki.close()
  }
})

// Value: protects=the Update button after an editor was killed during an update and its process id went to another process; fails_when=the start check takes the leftover marker for another window's running update for as long as that id answers, and refuses every press with a sentence that offers no "Update anyway"; why_new=Cycle 0045 local review wiki-1 #2; seam=none
test('a marker a killed editor left seventeen minutes ago does not refuse the update, although a process has its id', async () => {
  // Arrange: the marker of another window's run; its recorded process is this test process, which runs.
  const wiki = await openWikiWindow()
  await writeFile(
    `${wiki.outputDirectory}.update-run.json`,
    JSON.stringify({
      pid: process.pid,
      windowId: 'a-window-that-was-killed',
      host: 'vscode',
      startedAtMs: Date.now() - 17 * 60_000,
    }),
  )
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.equal(wiki.status().state, 'running')
    assert.equal(wiki.chatRequests.length, 1)
    assert.deepEqual(wiki.errors, [])
  } finally {
    await wiki.close()
  }
})

test('Update anyway is not offered while another window’s update is running', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  const secondWindow = await openWikiUpdateWindow({
    projectRoot: wiki.projectRoot,
    // A learner who is offered the override takes it.
    chooseAction: (_message, actions) =>
      actions.find((action) => action === 'Update anyway'),
  })
  try {
    await wiki.clickUpdate()

    // Act
    await secondWindow.clickUpdate()

    // Assert
    assert.deepEqual(
      secondWindow.offeredActions.map((offered) => offered.actions),
      [['Open LLM Wiki']],
    )
    assert.deepEqual(secondWindow.chatRequests, [])
  } finally {
    await secondWindow.close()
    await wiki.close()
  }
})

test('a VS Code watch that was stopped before the chat staged anything still refuses the next press, until the learner chooses Update anyway', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  let isOverrideChosen = false
  const wiki = await openWikiWindow({
    cancellable: progress,
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
  try {
    await wiki.clickUpdate()
    progress[0]!.cancel()
    await waitForEnd(wiki.status)

    // Act: the chat was not stopped by the cancel, so the next press is refused; the one after it takes the override.
    await wiki.clickUpdate()
    const refused = wiki.status()
    const requestsAfterRefusal = wiki.chatRequests.length
    isOverrideChosen = true
    await wiki.clickUpdate()
    const deadline = Date.now() + 2_000
    while (wiki.status().state !== 'running' && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))

    // Assert
    assert.equal(refused.state, 'failed')
    assert.match(
      refused.state === 'failed' ? refused.reason : '',
      /^The VS Code chat this window asked at \d{1,2}:\d{2}[^;]* may still be updating this Wiki; Codebook stopped watching it at \d{1,2}:\d{2}[^.]* and waits for it until \d{1,2}:\d{2}[^.]*\. If that chat was stopped, choose Update anyway in the editor’s notification\.$/,
    )
    assert.equal(requestsAfterRefusal, 1)
    assert.deepEqual(wiki.offeredActions.at(-1)?.actions, [
      'Update anyway',
      'Open LLM Wiki',
    ])
    assert.equal(wiki.status().state, 'running')
    assert.equal(wiki.chatRequests.length, 2)
  } finally {
    await wiki.close()
  }
})

test('a second window’s Update is refused while the first window’s stopped watch is still inside its bound', async () => {
  // Arrange: the first window stops watching before its chat staged anything, so no run and no candidate show the chat's work.
  const progress: CancellableProgress[] = []
  let isOverrideChosen = false
  const wiki = await openWikiWindow({ cancellable: progress })
  const secondWindow = await openWikiUpdateWindow({
    projectRoot: wiki.projectRoot,
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
  try {
    await wiki.clickUpdate()
    progress[0]!.cancel()
    await waitForEnd(wiki.status)

    // Act: the second window's press is refused; its next press takes the override.
    await secondWindow.clickUpdate()
    const refused = secondWindow.status()
    const requestsAfterRefusal = secondWindow.chatRequests.length
    isOverrideChosen = true
    await secondWindow.clickUpdate()
    const deadline = Date.now() + 2_000
    while (secondWindow.status().state !== 'running' && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))

    // Assert
    assert.equal(refused.state, 'failed')
    assert.match(
      refused.state === 'failed' ? refused.reason : '',
      /^The VS Code chat another editor window asked at \d{1,2}:\d{2}[^;]* may still be updating this Wiki; that window stopped watching it at \d{1,2}:\d{2}[^.]* and Codebook waits for it until \d{1,2}:\d{2}[^.]*\. If that chat was stopped, choose Update anyway in the editor’s notification\.$/,
    )
    assert.equal(requestsAfterRefusal, 0)
    assert.deepEqual(secondWindow.offeredActions.at(-1)?.actions, [
      'Update anyway',
      'Open LLM Wiki',
    ])
    assert.equal(secondWindow.status().state, 'running')
    assert.equal(secondWindow.chatRequests.length, 1)
  } finally {
    await secondWindow.close()
    await wiki.close()
  }
})

test('a stopped watch’s reservation leaves the disk when its window closes, and not the marker of a window that took the update over', async () => {
  // Arrange: two windows stop their watches; in the second case another window takes the update over with Update anyway.
  const progress: CancellableProgress[] = []
  const closedAlone = await openWikiWindow({ cancellable: progress })
  const takenOver = await openWikiWindow({ cancellable: progress })
  const takingOver = await openWikiUpdateWindow({
    projectRoot: takenOver.projectRoot,
    chooseAction: (_message, actions) =>
      actions.find((action) => action === 'Update anyway'),
  })
  const markerOf = (window: { outputDirectory: string }): string =>
    `${window.outputDirectory}.update-run.json`
  const isOnDisk = (path: string): Promise<boolean> =>
    access(path).then(
      () => true,
      () => false,
    )
  try {
    await closedAlone.clickUpdate()
    progress[0]!.cancel()
    await waitForEnd(closedAlone.status)
    await takenOver.clickUpdate()
    progress[1]!.cancel()
    await waitForEnd(takenOver.status)
    await takingOver.clickUpdate()
    const deadline = Date.now() + 2_000
    while (takingOver.status().state !== 'running' && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))
    const wasReservedWhileOpen = await isOnDisk(markerOf(closedAlone))

    // Act
    await closedAlone.closeWindow()
    await takenOver.closeWindow()

    // Assert
    assert.equal(wasReservedWhileOpen, true)
    assert.equal(await isOnDisk(markerOf(closedAlone)), false)
    assert.equal(takingOver.status().state, 'running')
    assert.equal(await isOnDisk(markerOf(takenOver)), true)
  } finally {
    await takingOver.close()
    await rm(closedAlone.projectRoot, { recursive: true, force: true })
    await rm(takenOver.projectRoot, { recursive: true, force: true })
  }
})

test('a press after a publish stopped inside its swap names the unfinished publish, not a missing Wiki', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  // A publisher that was stopped between its two moves: the old folder is the backup, the journal is left, no Wiki folder.
  await rename(wiki.outputDirectory, `${wiki.outputDirectory}.previous-stopped`)
  const journalPath = `${wiki.outputDirectory}.publish-journal.json`
  await writeFile(journalPath, '{}')
  const aMinuteAgo = new Date(Date.now() - 60_000)
  await utimes(journalPath, aMinuteAgo, aMinuteAgo)
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'conflict')
    assert.equal(
      status.state === 'conflict' ? status.cause : '',
      'unfinished-publish',
    )
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
      new RegExp(
        `^Update not started \\(${CLOCK_TIME}\\): an earlier publish did not finish \\(wiki\\.publish-journal\\.json\\)\\. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again\\.$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})

test('a Cursor run whose publish was stopped inside its swap says the Wiki is missing and names the recovery, and the next press names the same step', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      // The publisher moved the old folder away and was stopped before it moved the new one in.
      await rename(
        wiki.outputDirectory,
        `${wiki.outputDirectory}.previous-stopped`,
      )
      const journalPath = `${wiki.outputDirectory}.publish-journal.json`
      await writeFile(journalPath, '{}')
      const aMinuteAgo = new Date(Date.now() - 60_000)
      await utimes(journalPath, aMinuteAgo, aMinuteAgo)
      throw new Error(
        'Cursor Agent stopped on signal SIGKILL before finishing.',
      )
    },
  })
  try {
    // Act
    await wiki.clickUpdate()
    const ended = wiki.status()
    await wiki.clickUpdate()

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(ended.state === 'failed' ? ended.site : '', 'missing')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The Wiki is missing after a publish that did not finish. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
    )
    assert.equal(wiki.errors.length, 2)
    assert.match(
      wiki.errors[1] ?? '',
      /Ask the editor chat "\/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again\.$/,
    )
    assert.equal(wiki.status().state, 'conflict')
  } finally {
    await wiki.close()
  }
})

test('a new publish whose manifest stays unreadable ends the run after its grace with the recovery request, and the next press names the same step', async () => {
  // Arrange
  const wiki = await openWikiWindow({
    constants: { WIKI_UPDATE_UNREADABLE_MANIFEST_GRACE_MS: 100 },
  })
  try {
    await wiki.clickUpdate()

    // Act: the chat publishes a manifest that is no JSON, with a receipt that names it.
    const brokenManifest = '{ "schemaVersion": 1, "pages": ['
    await writeFile(`${wiki.manifestPath}.next`, brokenManifest)
    await rename(`${wiki.manifestPath}.next`, wiki.manifestPath)
    const receiptPath = join(wiki.outputDirectory, 'codebook-publication.json')
    await writeFile(
      `${receiptPath}.next`,
      JSON.stringify({
        kind: 'published',
        manifestSha256: createHash('sha256')
          .update(brokenManifest)
          .digest('hex'),
      }),
    )
    await rename(`${receiptPath}.next`, receiptPath)
    const ended = await waitForEnd(wiki.status, 3_000)
    await wiki.clickUpdate()

    // Assert
    assert.equal(ended.state, 'failed')
    assert.equal(
      ended.state === 'failed' ? ended.reason : '',
      'The editor agent published a new Wiki, but Codebook cannot read its manifest. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again.',
    )
    const refused = wiki.status()
    assert.equal(refused.state, 'conflict')
    assert.equal(
      refused.state === 'conflict' ? refused.cause : '',
      'unreadable-manifest',
    )
    assert.match(
      wiki.errors[1] ?? '',
      new RegExp(
        `^Update not started \\(${CLOCK_TIME}\\): Codebook cannot read the Wiki’s manifest \\(codebook-wiki\\.json\\)\\. Ask the editor chat "/codebook Recover the unfinished LLM Wiki publish for this project", then press Update LLM Wiki again\\.$`,
      ),
    )
    assert.equal(wiki.chatRequests.length, 1)
  } finally {
    await wiki.close()
  }
})

test('rewriting the manifest file without a publish is not recorded as Updated', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()
    wiki.setFreshness(CURRENT)

    // Act: the same bytes are put back under a new inode (a checkout, an editor's save); the old receipt still vouches for them.
    await writeFile(
      `${wiki.manifestPath}.copy`,
      await readFile(wiki.manifestPath),
    )
    await rename(`${wiki.manifestPath}.copy`, wiki.manifestPath)
    await new Promise((resolveWait) => setTimeout(resolveWait, 300))
    const afterSameBytes = wiki.status().state
    // Then other bytes are written, again without the publisher: no receipt names them.
    await writeFile(
      wiki.manifestPath,
      `${await readFile(wiki.manifestPath, 'utf8')}\n`,
    )
    await new Promise((resolveWait) => setTimeout(resolveWait, 300))
    const afterOtherBytes = wiki.status().state

    // Assert
    assert.equal(afterSameBytes, 'running')
    assert.equal(afterOtherBytes, 'running')
    assert.deepEqual(wiki.notices, [])
  } finally {
    await wiki.close()
  }
})

test('an update of a project without a Git repository ends as Updated and says that no revision is recorded and that added files are not checked', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act: what the freshness check answers in a folder without a Git repository once every indexed source matches.
    wiki.setFreshness({ ...CURRENT, addedFilesUnchecked: true })
    await wiki.publish('b'.repeat(64))
    const ended = await waitForEnd(wiki.status)

    // Assert
    assert.equal(ended.state, 'succeeded')
    assert.equal(ended.state === 'succeeded' ? ended.revision : '', undefined)
    assert.match(
      wiki.notices[0] ?? '',
      new RegExp(
        `^Updated at ${CLOCK_TIME} \\(index [0-9a-f]{8}; no Git revision recorded, so added files are not checked\\)\\. Reload the browser reader to read the new pages\\.$`,
      ),
    )
  } finally {
    await wiki.close()
  }
})

test('a failed, refused or timed-out update’s notification is an error notice with Open LLM Wiki, so the editor keeps it until dismissed', async () => {
  // Arrange
  let nowMs = 0
  const failed = await openWikiWindow({ chatFails: true })
  const refused = await openWikiWindow({ recordsPageHashes: true })
  await rm(join(refused.outputDirectory, 'index.html'))
  const timedOut = await openWikiWindow({
    watchClock: {
      now: () => nowMs,
      // The watch's own waits pass its fifteen minutes.
      sleep: async (delayMs) => {
        nowMs += delayMs
      },
    },
  })
  try {
    // Act
    await failed.clickUpdate()
    await refused.clickUpdate()
    await timedOut.clickUpdate()
    const timedOutEnd = await waitForEnd(timedOut.status)

    // Assert
    assert.equal(failed.status().state, 'failed')
    assert.equal(refused.status().state, 'conflict')
    assert.equal(timedOutEnd.state, 'timed-out')
    for (const window of [failed, refused, timedOut]) {
      assert.equal(window.errors.length, 1)
      assert.deepEqual(window.warnings, [])
      assert.deepEqual(window.offeredActions, [
        { message: window.errors[0], actions: ['Open LLM Wiki'] },
      ])
    }
  } finally {
    await failed.close()
    await refused.close()
    await timedOut.close()
  }
})

test('the confirmation of an update whose output lies outside the project says the chat will ask to approve each step there', async () => {
  // Arrange
  const projectRoot = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-inside-')),
  )
  const outsideDirectory = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-outside-')),
  )
  await writeFile(join(outsideDirectory, 'index.html'), INDEX_PAGE)
  await writePublishedWiki(outsideDirectory, projectRoot, 'a'.repeat(64))
  const approvalsNote =
    'This Wiki’s output lies outside the project, so the chat will ask to approve each step there; an output inside the project (codebook.wikiOutputDirectory) needs none.'
  const fromTheLink = await openWikiUpdateWindow({
    projectRoot,
    outputSetting: outsideDirectory,
  })
  try {
    // Act: once through the browser link, which confirms first, and once (in a window of its own) through the command, which does not.
    await fromTheLink.clickUpdate()
    const runningFromTheLink = fromTheLink.status()
    await fromTheLink.close()
    const fromTheCommand = await openWikiUpdateWindow({
      projectRoot,
      outputSetting: outsideDirectory,
    })
    await fromTheCommand.runUpdateCommand()
    const runningFromTheCommand = fromTheCommand.status()
    await fromTheCommand.close()

    // Assert
    assert.deepEqual(fromTheLink.confirmationDetails, [
      `${projectRoot}\n\nCopilot Chat receives the update request for this project. ${approvalsNote}`,
    ])
    for (const [window, running] of [
      [fromTheLink, runningFromTheLink],
      [fromTheCommand, runningFromTheCommand],
    ] as const) {
      assert.deepEqual(window.progressTitles, [
        `Watching for the LLM Wiki update from the editor chat (Cancel stops watching, not the chat). ${approvalsNote}`,
      ])
      assert.equal(
        running.state === 'running' ? running.isOutputOutsideProject : false,
        true,
      )
    }
    assert.deepEqual(fromTheCommand.confirmations, [])
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
    await rm(outsideDirectory, { recursive: true, force: true })
  }
})

test(
  'a publish that finishes while the start check waits for it is the generation the run starts from, not one the watch later takes for its own result',
  { timeout: 15_000 },
  async () => {
    // Arrange
    const wiki = await openWikiWindow()
    const journalPath = `${wiki.outputDirectory}.publish-journal.json`
    // Another chat's publish is in progress: its journal was written just now.
    await writeFile(journalPath, '{}')
    try {
      // Act: that publish lands while the start check waits for its second look at the journal.
      const press = wiki.clickUpdate()
      await new Promise((resolveWait) => setTimeout(resolveWait, 300))
      await wiki.publish('c'.repeat(64))
      await rm(journalPath)
      await press
      // The watch makes several looks at the folder.
      await new Promise((resolveWait) => setTimeout(resolveWait, 300))

      // Assert
      assert.equal(wiki.status().state, 'running')
      assert.equal(wiki.chatRequests.length, 1)
      assert.deepEqual(wiki.notices, [])
      assert.deepEqual(wiki.errors, [])
    } finally {
      await wiki.close()
    }
  },
)
