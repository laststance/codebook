import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import {
  exists,
  openProjectWithoutWiki,
  publishGeneratedWiki,
} from './utils/openProjectWithoutWiki'
import { publishedWikiFixture } from './utils/publishedWikiFixture'
import { openWikiUpdateWindow } from './utils/wikiUpdateWindow'

type Window = Awaited<ReturnType<typeof openWikiUpdateWindow>>

const STATE_KEY = 'codebook.llmWiki.state'
const GENERATE_COMMAND = 'codebook.generateDeepWiki'
/** A debounce and a poll short enough to wait for. */
const FAST = { LLM_WIKI_REFRESH_DEBOUNCE_MS: 40, LLM_WIKI_POLL_MS: 120 }
const WATCHED_ENDINGS =
  '{/codebook-wiki.json,.update-run.json,.publish-lock.json,.publish-journal.json}'

const idsOf = (window: Window): string[] =>
  window.llmWiki.rows().map((row) => row.id)
const rowOf = (window: Window, rowId: string) =>
  window.llmWiki.rows().find((row) => row.id === rowId)

/** Waits until the view has read its state for the first time. */
const untilFirstRead = (window: Window) =>
  waitUntil(
    () => window.llmWiki.contextKeys[STATE_KEY] !== 'loading',
    'the first read of the LLM Wiki state',
    6_000,
  )
/** Waits until a row with this id is shown, or gone. */
const untilRow = (window: Window, rowId: string, isShown = true) =>
  waitUntil(
    () => (rowOf(window, rowId) !== undefined) === isShown,
    `the ${rowId} row ${isShown ? 'to show' : 'to go'}`,
    6_000,
  )
/** Waits until the Wiki row's freshness check has answered. */
const untilFreshness = (window: Window) =>
  waitUntil(
    () => rowOf(window, 'wiki')?.description !== 'Checking freshness…',
    'the freshness label',
    6_000,
  )

/** Opens a window on a project with a real published Wiki. */
async function openPublishedWiki(
  context: TestContext,
  options: Partial<Parameters<typeof openWikiUpdateWindow>[0]> = {},
  prepare: (
    wiki: Awaited<ReturnType<typeof publishedWikiFixture>>,
  ) => Promise<void> = async () => {},
) {
  const wiki = await publishedWikiFixture()
  await prepare(wiki)
  const window = await openWikiUpdateWindow({
    constants: FAST,
    ...options,
    projectRoot: wiki.projectRoot,
    openReader: false,
  })
  context.after(async () => {
    await window.close()
    await wiki.cleanup()
  })
  await untilFirstRead(window)
  return { wiki, window }
}

/** Opens a window on a project with no Wiki, with the view's short timing. */
async function openEmptyProject(
  context: TestContext,
  options: Parameters<typeof openProjectWithoutWiki>[0] = {},
) {
  const project = await openProjectWithoutWiki({ constants: FAST, ...options })
  context.after(() => project.close())
  await untilFirstRead(project)
  return project
}

// Value: protects=AC 1 and AC 2 (loading), the welcome content not showing before the first read; fails_when=the state key is not `loading` until the first read ends, or the tree shows no reading row; no_claim=the welcome text; seam=a start check held open
test('until its first read ends the view shows Reading the LLM Wiki state and the state key is loading, then none', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    constants: FAST,
    holdAtOpen: ['start-block'],
  })
  context.after(() => project.close())

  // Act
  const whileLoading = {
    contextState: project.llmWiki.contextKeys[STATE_KEY],
    labels: project.llmWiki.rows().map((row) => row.label),
  }
  project.hold('start-block').release()
  await untilFirstRead(project)

  // Assert
  assert.deepEqual(whileLoading, {
    contextState: 'loading',
    labels: ['Reading the LLM Wiki state…'],
  })
  assert.equal(project.llmWiki.contextKeys[STATE_KEY], 'none')
})

// Value: protects=AC 1, the empty state; fails_when=a folder with no Wiki returns a row, sets a TreeView message or leaves the state key other, so the welcome content with Generate LLM Wiki never shows; no_claim=the welcome text (manifest test); seam=the stubbed editor's tree view
test('a folder with no Wiki returns no rows and no message and sets the state key none, with the host key vscode', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)

  // Act
  const shown = {
    rows: project.llmWiki.rows(),
    message: project.llmWiki.message(),
    state: project.llmWiki.contextKeys[STATE_KEY],
    host: project.llmWiki.contextKeys['codebook.host'],
  }

  // Assert
  assert.deepEqual(shown, {
    rows: [],
    message: undefined,
    state: 'none',
    host: 'vscode',
  })
})

// Value: protects=AC 1, the welcome content chosen by host; fails_when=Cursor sets the VS Code host key, so Cursor's welcome shows the Copilot Chat sentence; no_claim=the welcome text; seam=the stubbed editor's context keys
test('Cursor sets the host key cursor', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, { cursor: true })

  // Act
  const host = project.llmWiki.contextKeys['codebook.host']

  // Assert
  assert.equal(host, 'cursor')
})

// Value: protects=AC 2 row 1 and the loading label; fails_when=the Wiki row hides while the freshness check runs, never shows Checking freshness…, or opens anything but the browser Wiki; no_claim=the freshness check; seam=a freshness inspection held open
test('a published Wiki opens in the browser from its row and reads Checking freshness… until the check answers', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(context, {
    holdAtOpen: ['freshness-inspection'],
  })
  const whileChecking = rowOf(window, 'wiki')

  // Act
  window.hold('freshness-inspection').release()
  await untilFreshness(window)

  // Assert
  assert.deepEqual(
    [
      whileChecking?.description,
      whileChecking?.command?.command,
      rowOf(window, 'wiki')?.description,
      idsOf(window),
      window.llmWiki.contextKeys[STATE_KEY],
    ],
    [
      'Checking freshness…',
      'codebook.openDeepWiki',
      'Source changed · Update available',
      ['wiki', 'output'],
      'other',
    ],
  )
})

// Value: protects=AC 10 (accepted X1) with a manifest the real publisher wrote; fails_when=the tooltip names no revision, or one that is not the first 7 characters of the manifest's revision; no_claim=the date's locale; seam=a Wiki published by the shipped publisher
test('the Wiki row tooltip names the first seven characters of the manifest revision and the date of the publication', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(context)

  // Act
  const tooltip = rowOf(window, 'wiki')?.tooltip

  // Assert
  assert.match(tooltip ?? '', /^Generated from a1b2c3d on .+\nClick to open/)
})

const ATTENTION_HOST_CASES: Array<{
  name: string
  prepare: (
    wiki: Awaited<ReturnType<typeof publishedWikiFixture>>,
  ) => Promise<void>
  label: string
  shortCause: string
  isWikiShown: boolean
}> = [
  {
    name: 'edited-page',
    prepare: async (wiki): Promise<void> =>
      writeFile(join(wiki.outputDirectory, 'index.html'), '<h1>Mine</h1>'),
    label: 'Wiki files changed by hand',
    shortCause: 'page edited by hand',
    isWikiShown: true,
  },
  {
    name: 'missing-page',
    prepare: async (wiki): Promise<void> =>
      rm(join(wiki.outputDirectory, 'index.html')),
    label: 'Wiki files changed by hand',
    shortCause: 'page missing',
    isWikiShown: true,
  },
  {
    name: 'special-file',
    prepare: async (wiki): Promise<void> =>
      symlink(wiki.learnerFile, join(wiki.outputDirectory, 'shared.md')),
    label: 'Wiki files changed by hand',
    shortCause: 'link or special file',
    isWikiShown: true,
  },
  {
    name: 'edited-manifest',
    prepare: async (wiki): Promise<void> => {
      const manifestPath = join(wiki.outputDirectory, 'codebook-wiki.json')
      await writeFile(manifestPath, `${await readFile(manifestPath, 'utf8')}\n`)
    },
    label: 'Wiki manifest needs recovery',
    shortCause: 'manifest edited',
    isWikiShown: false,
  },
  {
    name: 'unreadable-manifest',
    prepare: async (wiki): Promise<void> =>
      writeFile(
        join(wiki.outputDirectory, 'codebook-wiki.json'),
        '{ "schemaVersion": 1, "pages": [',
      ),
    label: 'Wiki manifest needs recovery',
    shortCause: 'manifest unreadable',
    isWikiShown: false,
  },
  {
    name: 'unfinished-publish',
    prepare: async (wiki): Promise<void> => {
      const journal = `${wiki.outputDirectory}.publish-journal.json`
      await writeFile(journal, JSON.stringify({ operation: 'publish' }))
      const longAgo = new Date(Date.now() - 3_600_000)
      await utimes(journal, longAgo, longAgo)
    },
    label: 'Publish in progress or stopped',
    shortCause: 'unfinished publish',
    isWikiShown: true,
  },
  {
    name: 'held-publish-lock',
    prepare: async (wiki): Promise<void> => {
      const lock = `${wiki.outputDirectory}.publish-lock.json`
      await writeFile(lock, JSON.stringify({ pid: 99_999_999 }))
      const longAgo = new Date(Date.now() - 3_600_000)
      await utimes(lock, longAgo, longAgo)
    },
    label: 'Publish in progress or stopped',
    shortCause: 'publish lock found',
    isWikiShown: true,
  },
  {
    name: 'not-a-folder',
    prepare: async (wiki): Promise<void> => {
      await rm(wiki.outputDirectory, { recursive: true })
      await writeFile(wiki.outputDirectory, 'a file where the folder was')
    },
    label: 'Wiki folder belongs elsewhere',
    shortCause: 'output is a file or link',
    isWikiShown: false,
  },
  {
    name: 'linked-parent',
    prepare: async (wiki): Promise<void> => {
      const movedAside = join(wiki.projectRoot, 'moved-codebook')
      await rename(join(wiki.projectRoot, '.codebook'), movedAside)
      await symlink(movedAside, join(wiki.projectRoot, '.codebook'), 'junction')
    },
    label: 'Wiki folder belongs elsewhere',
    shortCause: 'link on the folder path',
    isWikiShown: false,
  },
]

for (const attentionCase of ATTENTION_HOST_CASES) {
  // Value: protects=AC 2, each start block the update start finds is a row of the view with its label and its Wiki row rule; fails_when=the cause shows another label, or hides the readable Wiki for a cause that leaves it readable, or keeps an unusable one; no_claim=the learner-file cause, which only a run's end finds (the pure matrix); seam=a Wiki published by the shipped publisher, then damaged on disk
  test(`the view shows ${attentionCase.label} for a published Wiki with ${attentionCase.name}`, async (context) => {
    // Arrange
    const { window } = await openPublishedWiki(
      context,
      {},
      attentionCase.prepare,
    )
    await untilRow(window, 'attention')

    // Act
    const attention = rowOf(window, 'attention')

    // Assert
    assert.deepEqual(
      [
        attention?.label,
        attention?.description,
        rowOf(window, 'wiki') !== undefined,
      ],
      [
        attentionCase.label,
        attentionCase.shortCause,
        attentionCase.isWikiShown,
      ],
    )
  })
}

// Value: protects=AC 2 (the foreign manifest), a Wiki folder of another checkout; fails_when=a manifest naming another checkout shows the Wiki row or any label but the one that sends the learner to Change location; no_claim=the refusal sentences of Generate and Update; seam=a hand-written manifest of another repository
test('a manifest of another checkout shows Wiki folder belongs elsewhere with Change location and no Wiki row', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({ constants: FAST })
  context.after(() => project.close())
  await publishGeneratedWiki(
    project.outputDirectory,
    project.projectRoot,
    '/somewhere/else',
  )
  await project.runCommand('codebook.refreshLlmWiki')
  await untilRow(project, 'attention')

  // Act
  const attention = rowOf(project, 'attention')

  // Assert
  assert.deepEqual(
    [
      attention?.label,
      attention?.description,
      attention?.contextValue,
      idsOf(project),
    ],
    [
      'Wiki folder belongs elsewhere',
      'another checkout',
      '[change-location]',
      ['attention', 'output'],
    ],
  )
})

// Value: protects=AC 2 (the row click shows the cause's sentence with Copy details); fails_when=clicking the attention row shows another sentence than the update's, offers no Copy details, or copies the home folder instead of ~; no_claim=every cause's wording (describeWikiUpdate tests); seam=a hand-edited page
test('clicking the attention row shows the update’s sentence with the page it names and Copy details copies it', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(
    context,
    { chooseAction: (_message, actions) => actions[0] },
    async (wiki) =>
      writeFile(join(wiki.outputDirectory, 'index.html'), '<h1>Mine</h1>'),
  )
  await untilRow(window, 'attention')
  const click = rowOf(window, 'attention')?.command

  // Act
  await window.runCommand(click?.command ?? '', ...(click?.arguments ?? []))
  await waitUntil(
    () => window.clipboard.length > 0,
    'the copied details',
    6_000,
  )

  // Assert
  assert.deepEqual(
    [
      { command: click?.command, arguments: click?.arguments },
      window.warnings[0]?.includes('index.html'),
      window.offeredActions[0]?.actions,
      window.clipboard[0] === window.warnings[0]?.split(homedir()).join('~'),
    ],
    [
      { command: 'codebook.showLlmWikiAttention', arguments: ['attention'] },
      true,
      ['Copy details'],
      true,
    ],
  )
})

// Value: protects=AC 2 (the folder and trust rows); fails_when=a window without a folder shows no Open Folder row, an untrusted folder shows no Manage Workspace Trust row, or trust granted later does not replace it; no_claim=the editor's own trust dialog; seam=the stubbed editor's trust and folder state
test('a window without a folder offers Open Folder and an untrusted folder offers Manage Workspace Trust until trust is granted', async (context) => {
  // Arrange
  const noFolder = await openWikiUpdateWindow({
    projectRoot: tmpdir(),
    openReader: false,
    noFolder: true,
    constants: FAST,
  })
  context.after(() => noFolder.close())
  const { window: untrusted } = await openPublishedWiki(context, {
    trusted: false,
  })
  const whileUntrusted = idsOf(untrusted)

  // Act
  untrusted.grantTrust()
  await untilRow(untrusted, 'wiki')

  // Assert
  assert.deepEqual(
    [
      noFolder.llmWiki
        .rows()
        .map((row) => [row.id, row.label, row.contextValue]),
      whileUntrusted,
      idsOf(untrusted),
    ],
    [
      [['folder', 'Open a folder to use the LLM Wiki', '[open-folder]']],
      ['trust'],
      ['wiki', 'output'],
    ],
  )
})

// Value: protects=the manage-trust id decision; fails_when=the action runs an id the editor does not list, or runs none and says nothing; no_claim=that the id exists in Cursor (native trial); seam=the stubbed editor's command list
test('Manage Workspace Trust runs the first known trust command the editor lists, and says where to find it when it lists none', async (context) => {
  // Arrange
  const { window: listed } = await openPublishedWiki(context, {
    trusted: false,
    extraEditorCommands: ['workbench.action.manageTrust'],
  })
  const { window: unlisted } = await openPublishedWiki(context, {
    trusted: false,
  })

  // Act
  await listed.runCommand('codebook.llmWiki.manageTrust')
  await unlisted.runCommand('codebook.llmWiki.manageTrust')

  // Assert
  assert.deepEqual(
    [listed.executedCommands, unlisted.executedCommands, unlisted.notices],
    [
      ['workbench.action.manageTrust'],
      [],
      [
        'Run "Workspaces: Manage Workspace Trust" from the Command Palette to trust this folder.',
      ],
    ],
  )
})

// Value: protects=AC 2 (error row); fails_when=a read that throws leaves the tree empty or on loading, writes no cause to Output, or does not recover at Refresh; no_claim=the cause's wording; seam=a folder that no longer exists
test('a read that throws shows Could not read the LLM Wiki state, records the cause in Output and recovers at Refresh', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)
  const realRoot = project.projectRoot
  project.openWorkspace(join(realRoot, 'does-not-exist'))

  // Act
  await project.runCommand('codebook.refreshLlmWiki')
  const errorRow = rowOf(project, 'error')
  project.openWorkspace(realRoot)
  await project.runCommand('codebook.refreshLlmWiki')

  // Assert
  assert.deepEqual(
    [
      errorRow?.label,
      errorRow?.description,
      errorRow?.command?.command,
      project.outputLines.some((line) =>
        line.startsWith('error: The LLM Wiki view could not read its state: '),
      ),
      project.llmWiki.contextKeys[STATE_KEY],
    ],
    [
      'Could not read the LLM Wiki state',
      'Refresh to retry',
      'codebook.showWikiOutput',
      true,
      'none',
    ],
  )
})

// Value: protects=AC 2 (refresh on a change of the Wiki files); fails_when=a manifest created on disk does not show the Wiki row after the watcher's event, an event of an unrelated file reads the state, or the view polls when no run row shows; no_claim=VS Code's real watcher; seam=the fake file watching
test('a manifest created in the output folder shows the Wiki row after the watcher event, and an unrelated file’s event reads nothing', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)
  const readsAtStart = project.looks.publishTokenReads

  // Act
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  project.reportFileEvent('create', join(project.projectRoot, 'notes.md'))
  await new Promise((resolve) => setTimeout(resolve, 300))
  const idsBeforeTheEvent = idsOf(project)
  const readsBeforeTheEvent = project.looks.publishTokenReads
  project.reportFileEvent(
    'create',
    join(project.outputDirectory, 'codebook-wiki.json'),
  )
  await untilRow(project, 'wiki')

  // Assert
  assert.deepEqual(
    [idsBeforeTheEvent, readsBeforeTheEvent - readsAtStart],
    [[], 0],
  )
})

// Value: protects=AC 2 (the trailing debounce); fails_when=a burst of events reads the state once per event, or the last event of the burst is dropped; no_claim=the 1 second value (a constant); seam=five events 10 ms apart, with the debounce shortened to 40 ms
test('five file events inside the debounce become one read that shows the last state', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)
  const readsAtStart = project.looks.publishTokenReads
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  const manifestPath = join(project.outputDirectory, 'codebook-wiki.json')

  // Act
  for (let event = 0; event < 5; event += 1) {
    project.reportFileEvent('change', manifestPath)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await untilRow(project, 'wiki')
  // gstack-timing-ok: proves no second read follows; waits six times the shortened 40 ms debounce after the last event
  await new Promise((resolve) => setTimeout(resolve, 250))

  // Assert
  assert.equal(project.looks.publishTokenReads - readsAtStart, 1)
})

// Value: protects=AC 2 (refresh on the setting and on visibility); fails_when=changing codebook.wikiOutputDirectory or showing the view again does not read the state, or the watcher stays on the old folder; no_claim=VS Code's settings UI; seam=the stubbed configuration event and visibility event
test('changing the output setting and showing the view again read the state again and move the watcher', async (context) => {
  // Arrange
  const { wiki, window } = await openPublishedWiki(context)
  const patternsAtStart = window.watchedPatterns().length
  await publishGeneratedWiki(
    join(wiki.projectRoot, 'docs', 'wiki'),
    wiki.projectRoot,
  )

  // Act
  window.setOutputSetting('docs/wiki')
  await waitUntil(
    () => rowOf(window, 'output')?.label === 'Output: docs/wiki',
    'the new output folder',
    6_000,
  )
  const watchedAfterTheSetting = window.watchedPatterns().at(-1)
  await rm(join(wiki.projectRoot, 'docs'), { recursive: true })
  window.llmWiki.setVisible(true)
  await untilRow(window, 'wiki', false)

  // Assert
  assert.deepEqual(
    [
      window.watchedPatterns().length > patternsAtStart,
      watchedAfterTheSetting?.base,
      watchedAfterTheSetting?.pattern,
      window.llmWiki.contextKeys[STATE_KEY],
    ],
    [true, join(wiki.projectRoot, 'docs'), `wiki${WATCHED_ENDINGS}`, 'none'],
  )
})

// Value: protects=AC 2 (the 30 second poll for rows 2b); fails_when=a marker whose window died leaves a row for another window forever because no file event arrives; no_claim=the 30 second value; seam=a marker removed without a file event, the poll shortened to 120 ms
test('another window’s run row disappears at the next poll after its marker is removed without a file event', async (context) => {
  // Arrange
  const { wiki, window } = await openPublishedWiki(
    context,
    {},
    async (fixture) => {
      await writeFile(
        `${fixture.outputDirectory}.update-run.json`,
        JSON.stringify({
          pid: process.pid,
          windowId: 'the-other-window',
          host: 'vscode',
          startedAtMs: Date.now() - 60_000,
          runKind: 'update',
        }),
      )
    },
  )
  const rowsWhileItRuns = idsOf(window)

  // Act
  await unlink(`${wiki.outputDirectory}.update-run.json`)
  await untilRow(window, 'elsewhere', false)

  // Assert
  assert.deepEqual(
    [rowsWhileItRuns, rowOf(window, 'wiki')?.contextValue, idsOf(window)],
    [['wiki', 'elsewhere', 'output'], '[update]', ['wiki', 'output']],
  )
})

// Value: protects=AC 2 (an output outside the workspace); fails_when=an output folder outside the project shows no Wiki, or the label is not its absolute path; no_claim=the editor's watch outside the workspace; seam=an absolute output setting
test('an output folder outside the project shows its Wiki with the absolute folder as its label', async (context) => {
  // Arrange
  const outside = await mkdtemp(join(tmpdir(), 'codebook-outside-wiki-'))
  context.after(() => rm(outside, { recursive: true, force: true }))
  const project = await openProjectWithoutWiki({
    constants: FAST,
    outputSetting: join(outside, 'wiki'),
  })
  context.after(() => project.close())
  await publishGeneratedWiki(join(outside, 'wiki'), project.projectRoot)

  // Act
  await project.runCommand('codebook.refreshLlmWiki')

  // Assert
  assert.deepEqual(
    [rowOf(project, 'output')?.label, project.watchedPatterns().at(-1)?.base],
    [`Output: ${join(outside, 'wiki')}`, outside],
  )
})

// Value: protects=AC 2 (a missing output parent) and Eng decision 78; fails_when=the watcher stands on a folder that does not exist, or is not made again on the folder a run creates; no_claim=VS Code's watcher on the root; seam=a Cursor generation whose agent waits
test('in a fresh project the watcher stands on the project and moves to .codebook once a run makes it', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    cursor: true,
    cursorAgent: (_root, _prompt, signal) =>
      new Promise<string>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('stopped'))),
      ),
  })
  const watchedAtStart = project.watchedPatterns().at(-1)

  // Act
  void project.runCommand(GENERATE_COMMAND)
  await untilRow(project, 'run')
  await waitUntil(
    () => project.watchedPatterns().at(-1)?.base !== watchedAtStart?.base,
    'the watcher on .codebook',
    6_000,
  )
  await project.runCommand('codebook.llmWiki.cancelRun')

  // Assert
  assert.deepEqual(
    [watchedAtStart, project.watchedPatterns().at(-1)],
    [
      {
        base: project.projectRoot,
        pattern: `.codebook/wiki${WATCHED_ENDINGS}`,
      },
      {
        base: join(project.projectRoot, '.codebook'),
        pattern: `wiki${WATCHED_ENDINGS}`,
      },
    ],
  )
})

// Value: protects=AC 2 (an output folder deleted while the view is open); fails_when=the Wiki row stays after its folder is deleted, or the empty state does not come back; no_claim=the watcher's delete event of the real editor; seam=the fake delete event
test('an output folder deleted while the view is open brings back the empty state', async (context) => {
  // Arrange
  const { wiki, window } = await openPublishedWiki(context)

  // Act
  await rm(wiki.outputDirectory, { recursive: true })
  window.reportFileEvent(
    'delete',
    join(wiki.outputDirectory, 'codebook-wiki.json'),
  )
  await untilRow(window, 'wiki', false)

  // Assert
  assert.deepEqual(
    [window.llmWiki.rows(), window.llmWiki.contextKeys[STATE_KEY]],
    [[], 'none'],
  )
})

// Value: protects=AC 2 (a refresh with nothing new fires no tree change) and accessibility; fails_when=Refresh with an unchanged state fires a tree change, which a screen reader announces; no_claim=focus handling; seam=the tree view's change event count
test('Refresh with nothing new fires no tree change', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(context)
  await untilFreshness(window)
  const changesBefore = window.llmWiki.treeChangeCount()

  // Act
  await window.runCommand('codebook.refreshLlmWiki')
  await window.runCommand('codebook.refreshLlmWiki')
  // gstack-timing-ok: proves no tree change arrives later; waits five times the shortened 40 ms debounce
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Assert
  assert.equal(window.llmWiki.treeChangeCount() - changesBefore, 0)
})

// Value: protects=AC 2 (row 2 and the TreeView message in VS Code); fails_when=a VS Code generation shows no Generating row with Waiting for the chat to start, lacks Stop watching, Open Chat and Show Output as inline actions, shows them as the row click, or lacks the wrapping message; no_claim=the minutes (pure matrix); seam=a chat that never answers
test('a VS Code generation shows Generating… waiting for the chat, with its three inline actions and the watching message', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    chatReply: () => new Promise<never>(() => {}),
  })

  // Act
  void project.runCommand(GENERATE_COMMAND)
  await untilRow(project, 'run')
  const run = rowOf(project, 'run')

  // Assert
  assert.deepEqual(
    [
      run?.label,
      run?.description,
      run?.contextValue,
      run?.command,
      project.llmWiki.message(),
      project.llmWiki.contextKeys[STATE_KEY],
    ],
    [
      'Generating…',
      'Waiting for the chat to start',
      '[stop-watching][open-chat][show-output]',
      undefined,
      'Codebook is watching the chat. Stop watching does not stop the chat; stop it in the chat.',
      'other',
    ],
  )
})

// Value: protects=AC 2 (row 2c) and AC 4; fails_when=Stop watching leaves no Waiting for chat row with its retry time, or the message goes with the run row; no_claim=the reservation's bound (marker tests); seam=a chat that never answers, stopped through the view's own action
test('Stop watching in the view ends the generation and leaves a Waiting for chat row with the retry time', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    chatReply: () => new Promise<never>(() => {}),
  })
  void project.runCommand(GENERATE_COMMAND)
  await untilRow(project, 'run')

  // Act
  await project.runCommand('codebook.llmWiki.stopWatching')
  await untilRow(project, 'reservation')

  // Assert
  assert.deepEqual(
    [
      idsOf(project),
      rowOf(project, 'reservation')?.label,
      rowOf(project, 'reservation')?.description?.startsWith('retry after '),
      rowOf(project, 'reservation')?.contextValue,
      rowOf(project, 'last-attempt')?.description,
      project.llmWiki.message(),
    ],
    [
      ['run', 'reservation', 'last-attempt', 'output'].filter(
        (id) => id !== 'run',
      ),
      'Waiting for chat',
      true,
      '[open-chat]',
      'stopped watching',
      'Codebook is watching the chat. Stop watching does not stop the chat; stop it in the chat.',
    ],
  )
})

// Value: protects=the late-publication notice and AC 4 (a late publication shows as published, no run claims it); fails_when=a Wiki the chat publishes after Stop watching shows no notice with Open in Browser, leaves the reservation or the last-attempt row, or shows the notice twice; no_claim=the browser opening; seam=a publication written after the watch stopped, with the watcher event
test('a Wiki published after Stop watching shows the notice with Open in Browser and replaces the reservation and the last attempt', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    chatReply: () => new Promise<never>(() => {}),
  })
  void project.runCommand(GENERATE_COMMAND)
  await untilRow(project, 'run')
  await project.runCommand('codebook.llmWiki.stopWatching')
  await untilRow(project, 'reservation')
  const noticesBefore = project.notices.length

  // Act
  // gstack-timing-ok: separates the publication's file times from the earlier read; no assertion measures the wait
  await new Promise((resolve) => setTimeout(resolve, 20))
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  project.reportFileEvent(
    'create',
    join(project.outputDirectory, 'codebook-wiki.json'),
  )
  await untilRow(project, 'wiki')
  await project.runCommand('codebook.refreshLlmWiki')

  // Assert
  assert.deepEqual(
    [
      idsOf(project),
      project.notices.slice(noticesBefore),
      project.offeredActions.at(-1),
    ],
    [
      ['wiki', 'output'],
      ['An LLM Wiki was published in .codebook/wiki.'],
      {
        message: 'An LLM Wiki was published in .codebook/wiki.',
        actions: ['Open in Browser'],
      },
    ],
  )
})

// Value: protects=AC 2 row 3 and AC 4; fails_when=a Cursor generation whose agent exits 1 without publishing shows no Last generation stopped row with its cause and Try again, the click shows another sentence, or Try again starts nothing; no_claim=the end sentence's wording (generate flow tests); seam=an agent that fails with an exit code
test('a Cursor generation that ends with exit code 1 shows Last generation stopped, its sentence on click and Try again', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    cursor: true,
    cursorAgent: async () => {
      throw Object.assign(new Error('The agent stopped.'), {
        exitCode: 1,
        exitSignal: null,
      })
    },
  })
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await untilRow(project, 'last-attempt')
  const row = rowOf(project, 'last-attempt')

  // Act
  await project.runCommand(
    row?.command?.command ?? '',
    ...(row?.command?.arguments ?? []),
  )

  // Assert
  assert.deepEqual(
    [
      row?.label,
      row?.description,
      row?.contextValue,
      project.warnings.length,
      idsOf(project),
    ],
    [
      'Last generation stopped',
      'agent exit 1',
      '[try-again]',
      1,
      ['last-attempt', 'output'],
    ],
  )
})

// Value: protects=AC 2 (row 2 in Cursor, no Open Chat, no message); fails_when=a Cursor run shows Stop watching or Open Chat, the VS Code message, or no cursor-agent progress; no_claim=the agent's work; seam=a Cursor agent that waits for its abort
test('a Cursor generation shows cursor-agent progress with Cancel and Show Output and no watching message, and Cancel ends it', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    cursor: true,
    cursorAgent: (_root, _prompt, signal) =>
      new Promise<string>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('stopped'))),
      ),
  })
  void project.runCommand(GENERATE_COMMAND)
  await untilRow(project, 'run')
  const run = rowOf(project, 'run')

  // Act
  await project.runCommand('codebook.llmWiki.cancelRun')
  await untilRow(project, 'run', false)

  // Assert
  assert.deepEqual(
    [
      run?.description,
      run?.contextValue,
      project.llmWiki.message(),
      rowOf(project, 'last-attempt')?.description,
    ],
    [
      'cursor-agent · 0 min of 55',
      '[cancel-run][show-output]',
      undefined,
      'cancelled',
    ],
  )
})

// Value: protects=AC 2 (row 1 beside a run); fails_when=a published Wiki disappears or keeps its Update action while an update runs; no_claim=the update's own work; seam=a Cursor update whose agent waits
test('a published Wiki stays readable beside a running update and offers no second Update', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(context, {
    cursor: true,
    cursorAgent: (_root, _prompt, signal) =>
      new Promise<string>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('stopped'))),
      ),
  })
  await untilFreshness(window)

  // Act
  void window.runUpdateCommand()
  await untilRow(window, 'run')
  const rows = window.llmWiki.rows()
  await window.runCommand('codebook.llmWiki.cancelRun')

  // Assert
  assert.deepEqual(
    rows.map((row) => [row.id, row.contextValue]),
    [
      ['wiki', ''],
      ['run', '[cancel-run][show-output]'],
      ['output', '[change-location]'],
    ],
  )
})

// Value: protects=AC 2 (a watcher that cannot be created); fails_when=the view fails, writes the cause more than once, or hides in the Output row that it refreshes on visibility and Refresh only; no_claim=the cause's wording; seam=a refused file watcher
test('a refused file watcher is recorded once in Output, said in the Output row’s tooltip, and Refresh still works', async (context) => {
  // Arrange
  const { wiki, window } = await openPublishedWiki(context, {
    wikiWatcherFails: 'no watcher available',
  })
  await window.runCommand('codebook.refreshLlmWiki')
  await unlink(join(wiki.outputDirectory, 'index.html'))

  // Act
  await window.runCommand('codebook.refreshLlmWiki')
  await untilRow(window, 'attention')

  // Assert
  assert.deepEqual(
    [
      window.outputLines.filter((line) => line.includes('could not watch')),
      rowOf(window, 'output')?.tooltip?.includes('refreshes when it is shown'),
    ],
    [
      [
        'error: The LLM Wiki view could not watch the Wiki folder: no watcher available',
      ],
      true,
    ],
  )
})

// Value: protects=AC 2 (the row actions are commands a keyboard reaches); fails_when=Open Chat, Change location, Copy recovery request or Reveal Wiki Folder run another editor command or copy another text; no_claim=what the editor does with them; seam=the stubbed editor's command log and clipboard
test('Open Chat, Change location, Reveal Wiki Folder and Copy recovery request run the editor commands and the copy the plan names', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)

  // Act
  await project.runCommand('codebook.llmWiki.openChat')
  await project.runCommand('codebook.llmWiki.changeLocation')
  await project.runCommand('codebook.revealWikiFolder')
  await project.runCommand('codebook.copyWikiRecoveryRequest')

  // Assert
  assert.deepEqual(
    [project.executedCommands, project.clipboard, project.notices],
    [
      [
        'workbench.action.chat.open',
        'workbench.action.openSettings',
        'revealFileInOS',
      ],
      ['/codebook Recover the unfinished LLM Wiki publish for this project'],
      ['Copied the recovery request. Paste it into the editor chat.'],
    ],
  )
})

// Value: protects=the view's folder row actions; fails_when=Open Folder runs a command other than the editor's folder dialog; no_claim=the dialog; seam=the stubbed editor's command log
test('Open Folder runs the editor’s folder dialog command', async (context) => {
  // Arrange
  const project = await openWikiUpdateWindow({
    projectRoot: tmpdir(),
    openReader: false,
    noFolder: true,
    constants: FAST,
  })
  context.after(() => project.close())

  // Act
  await project.runCommand('codebook.llmWiki.openFolder')

  // Assert
  assert.deepEqual(project.executedCommands, ['vscode.openFolder'])
})

// Value: protects=AC 14 (the view only reads); fails_when=reading the state makes the .codebook folder of a project that has none, which a later Generate must make itself after its confirmation; no_claim=the Generate flow's folder; seam=a project with no .codebook
test('reading the state of a project without a Wiki makes no folder', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)

  // Act
  await project.runCommand('codebook.refreshLlmWiki')

  // Assert
  assert.equal(await exists(join(project.projectRoot, '.codebook')), false)
})

// Value: protects=AC 2 (refresh on a change of the Wiki files) on Windows and macOS, where the editor may spell a path in another case; fails_when=an event whose path differs from the computed one only in case is dropped, so the view refreshes on poll, visibility and Refresh only; no_claim=the Windows drive-letter form (comparableFilePath tests); seam=the fake file watching reporting another spelling
test(
  'a watcher event that spells the manifest path in another case still refreshes the view',
  { skip: process.platform === 'linux' },
  async (context) => {
    // Arrange
    const project = await openEmptyProject(context)
    await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
    const manifestPath = join(project.outputDirectory, 'codebook-wiki.json')

    // Act
    project.reportFileEvent('create', manifestPath, manifestPath.toUpperCase())
    await untilRow(project, 'wiki')

    // Assert
    assert.deepEqual(idsOf(project), ['wiki', 'output'])
  },
)

// Value: protects=AC 2 (a Wiki folder whose name holds glob characters); fails_when=the watcher's glob embeds `wiki[1]` raw, so the editor reads it as a character class and never reports the manifest; no_claim=the editor's glob engine; seam=the pattern the view hands to createFileSystemWatcher
test('an output folder named wiki[1] is watched with its brackets escaped in the glob', async (context) => {
  // Arrange
  const project = await openEmptyProject(context)

  // Act
  project.setOutputSetting('wiki[1]')
  await waitUntil(
    () =>
      project.watchedPatterns().at(-1)?.pattern.startsWith('wiki[') === true,
    'the escaped glob',
    6_000,
  )

  // Assert
  assert.equal(
    project.watchedPatterns().at(-1)?.pattern,
    `wiki[[]1]${WATCHED_ENDINGS}`,
  )
})

// Value: protects=the accessible name of each row (label plus description); fails_when=a row's accessibility label is missing, so the editor reads the tooltip instead, or it drops the description; no_claim=what a screen reader says; seam=the tree item the view hands to the stubbed editor
test('each row of the view has the accessible name label plus description, and the label alone without a description', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(context, {}, async (wiki) =>
    writeFile(join(wiki.outputDirectory, 'index.html'), '<h1>Mine</h1>'),
  )
  await untilRow(window, 'attention')
  await untilFreshness(window)
  const noFolder = await openWikiUpdateWindow({
    projectRoot: tmpdir(),
    openReader: false,
    noFolder: true,
    constants: FAST,
  })
  context.after(() => noFolder.close())
  await untilFirstRead(noFolder)

  // Act
  const names = [...window.llmWiki.rows(), ...noFolder.llmWiki.rows()].map(
    (row) => [row.id, row.accessibleName],
  )

  // Assert
  assert.deepEqual(names, [
    [
      'wiki',
      `${rowOf(window, 'wiki')?.label}, ${rowOf(window, 'wiki')?.description}`,
    ],
    ['attention', 'Wiki files changed by hand, page edited by hand'],
    ['output', 'Output: .codebook/wiki, Change location'],
    ['folder', 'Open a folder to use the LLM Wiki'],
  ])
})

// Value: protects=the late-publication notice after one transient read error; fails_when=a failed read forgets that a reservation or failed generation stood, so the publication that follows shows no notice; no_claim=the notice wording; seam=a workspace folder that disappears for one read
test('a Wiki published after one failed read still shows the late-publication notice', async (context) => {
  // Arrange
  const project = await openEmptyProject(context, {
    chatReply: () => new Promise<never>(() => {}),
  })
  void project.runCommand(GENERATE_COMMAND)
  await untilRow(project, 'run')
  await project.runCommand('codebook.llmWiki.stopWatching')
  await untilRow(project, 'reservation')
  const noticesBefore = project.notices.length
  project.openWorkspace(join(project.projectRoot, 'does-not-exist'))
  await project.runCommand('codebook.refreshLlmWiki')
  project.openWorkspace(project.projectRoot)

  // Act
  // gstack-timing-ok: separates the publication's file times from the earlier read; no assertion measures the wait
  await new Promise((resolve) => setTimeout(resolve, 20))
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  await project.runCommand('codebook.refreshLlmWiki')

  // Assert
  assert.deepEqual(project.notices.slice(noticesBefore), [
    'An LLM Wiki was published in .codebook/wiki.',
  ])
})

// Value: protects=the freshness check running only for a shown Wiki row; fails_when=a manifest that needs recovery hides the Wiki row and the view still runs the Git freshness check for it; no_claim=the check's answer; seam=a freshness inspection held open and watched
test('a manifest that needs recovery runs no freshness check because no Wiki row is shown', async (context) => {
  // Arrange
  const { window } = await openPublishedWiki(
    context,
    { holdAtOpen: ['freshness-inspection'] },
    async (wiki) => {
      const manifestPath = join(wiki.outputDirectory, 'codebook-wiki.json')
      await writeFile(manifestPath, `${await readFile(manifestPath, 'utf8')}\n`)
    },
  )
  await untilRow(window, 'attention')

  // Act
  const didCheckStart = await Promise.race([
    window.hold('freshness-inspection').started.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
  ])

  // Assert
  assert.equal(didCheckStart, false)
})

// Value: protects=deactivation during a read; fails_when=a read that passed readFacts before dispose still creates a file watcher, which then leaks for the life of the editor; no_claim=the rows; seam=the first read held open at the start check, then the window closed
test('a read that ends after the window closed creates no file watcher', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    constants: FAST,
    holdAtOpen: ['start-block'],
  })
  context.after(() => project.close())
  const hold = project.hold('start-block')
  await hold.started

  // Act
  const closing = project.closeWindow()
  // gstack-timing-ok: lets the close dispose the view before the held read resumes
  await new Promise((resolve) => setTimeout(resolve, 100))
  hold.release()
  await closing
  // gstack-timing-ok: proves no watcher appears after the close; waits five times the shortened 40 ms debounce
  await new Promise((resolve) => setTimeout(resolve, 200))

  // Assert
  assert.equal(project.liveWatcherCount(), 0)
})
