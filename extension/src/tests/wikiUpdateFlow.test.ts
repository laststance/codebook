import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** Opens a window on a project with a hand-written published Wiki and records what the learner sees of an update. */
async function openWikiWindow(
  options: Omit<
    Parameters<typeof openWikiUpdateWindow>[0],
    'projectRoot' | 'outputSetting'
  > & { outputSetting?: string } = {},
) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'codebook-wiki-flow-'))
  const projectRoot = await realpath(projectDirectory)
  const outputSetting = options.outputSetting ?? '.codebook/wiki'
  const outputDirectory = join(projectRoot, outputSetting)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'index.html'), '<title>Wiki</title>')
  const manifestPath = join(outputDirectory, 'codebook-wiki.json')
  /** Writes the published manifest the way an agent's publish would change it. */
  const publish = (
    sourceHash: string,
    excludedPaths: string[] = [],
  ): Promise<void> =>
    writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: projectRoot,
        generated: { revision: 'a1b2c3d4e5f6a7b8' },
        pages: [],
        assets: [],
        excludedPaths,
        includedSources: [{ path: 'src/a.ts', sha256: sourceHash }],
      }),
    )
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

test('a chat that cannot open ends the update as failed, says what to install and shows one error that does not claim the update could not start', async () => {
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

test('a failure before any state is recorded says the update could not start, without an "Error:" prefix', async () => {
  // Arrange
  const wiki = await openWikiWindow()
  await writeFile(
    wiki.manifestPath,
    JSON.stringify({ schemaVersion: 1, repositoryRoot: '/another/checkout' }),
  )
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(wiki.errors, [
      'Codebook could not start the Wiki update: The DeepWiki manifest does not identify this opened project.',
    ])
    assert.equal(wiki.status().state, 'idle')
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
        query: `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(wiki.manifestPath)} and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, and generated.revision is the full commit hash of HEAD. If you cannot publish, say why in your reply and stop. Then report changed pages and citations. Do not start a debugger or application.`,
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
      `/codebook Update LLM Wiki for this opened repository. Read ${JSON.stringify(wiki.manifestPath)} and the installed Codebook skill. Reinspect current source, preserve manual files and the last usable Wiki on failure. Codebook is watching this folder and shows the learner "Updated" only if you publish through the installed publisher within 15 minutes and the published manifest matches the source at that moment: every includedSources sha256 equals the file on disk, and generated.revision is the full commit hash of HEAD. If you cannot publish, say why in your reply and stop. Do not start a debugger or application.`,
    ])
  } finally {
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
