import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import { publishedWikiFixture } from './utils/publishedWikiFixture'
import {
  openWikiUpdateWindow,
  type CancellableProgress,
} from './utils/wikiUpdateWindow'

/** Opens a window on a project whose Wiki the real publisher published, with a learner's own file in the folder. */
async function openPublishedWikiWindow(
  options: Omit<Parameters<typeof openWikiUpdateWindow>[0], 'projectRoot'> = {},
) {
  const wiki = await publishedWikiFixture(options.outputSetting)
  const window = await openWikiUpdateWindow({
    ...options,
    projectRoot: wiki.projectRoot,
  })
  return {
    ...wiki,
    ...window,
    async close(): Promise<void> {
      await window.close()
      await wiki.cleanup()
    },
  }
}

/** Waits until the update state satisfies the test's condition, polling the way the reader page does. */
async function waitForStatus(
  status: () => WikiUpdateStatus,
  isReached: (current: WikiUpdateStatus) => boolean,
  limitMs = 6_000,
): Promise<WikiUpdateStatus> {
  const deadline = Date.now() + limitMs
  while (!isReached(status()) && Date.now() < deadline)
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
  return status()
}

const hasEnded = (current: WikiUpdateStatus): boolean =>
  current.state !== 'running'

/** An agent needs a moment before it stages anything; the pause also lets the file system's clock pass the run's start. */
const agentTakesAMoment = (): Promise<void> =>
  new Promise((resolveWait) => setTimeout(resolveWait, 50))

test('a generated page the learner edited by hand stops the update before any chat request and names the page', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  await writeFile(
    join(wiki.outputDirectory, 'index.html'),
    '<h1>My own wording</h1>',
  )
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'conflict')
    assert.deepEqual(
      status.state === 'conflict'
        ? { cause: status.cause, paths: status.paths, site: status.site }
        : {},
      { cause: 'edited-page', paths: ['index.html'], site: 'kept' },
    )
    assert.deepEqual(wiki.chatRequests, [])
    assert.equal(wiki.warnings.length, 1)
    assert.match(
      wiki.warnings[0] ?? '',
      /^Update not started \(\d{1,2}:\d{2}(?:\s?[AP]M)?\): a generated page was edited by hand \(index\.html\), and the publisher will not overwrite it\. Move your change aside or restore the page, then press Update LLM Wiki again\.$/,
    )
    assert.equal(
      await readFile(join(wiki.outputDirectory, 'index.html'), 'utf8'),
      '<h1>My own wording</h1>',
    )
  } finally {
    await wiki.close()
  }
})

test('an earlier publish that did not finish stops the update before any chat request and names its journal', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  await writeFile(
    `${wiki.outputDirectory}.publish-journal.json`,
    JSON.stringify({ operation: 'publish', pid: 99_999_999 }),
  )
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'conflict')
    assert.deepEqual(
      status.state === 'conflict'
        ? { cause: status.cause, paths: status.paths, site: status.site }
        : {},
      {
        cause: 'unfinished-publish',
        paths: ['wiki.publish-journal.json'],
        site: 'kept',
      },
    )
    assert.deepEqual(wiki.chatRequests, [])
  } finally {
    await wiki.close()
  }
})

test('a candidate the agent staged in a folder of its own name ends the watched run as a conflict over the learner’s file and leaves the Wiki folder byte-identical', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  await mkdir(join(wiki.outputDirectory, 'pages'))
  await writeFile(join(wiki.outputDirectory, 'pages', 'notes.html'), 'mine')
  const hashBefore = await wiki.hashOutput()
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()

    // Act: the agent prepares with `--stage`, writes a page where the learner's file is, and the real publisher refuses it.
    const stage = await wiki.prepare(
      join(dirname(wiki.outputDirectory), 'wiki-next'),
    )
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })
    await assert.rejects(
      wiki.publish(stage),
      /A manual Wiki file conflicts with the update: pages\/notes\.html/,
    )
    const ended = await waitForStatus(wiki.status, hasEnded)

    // Assert
    assert.equal(ended.state, 'conflict')
    assert.deepEqual(
      ended.state === 'conflict'
        ? { cause: ended.cause, paths: ended.paths, site: ended.site }
        : {},
      { cause: 'learner-file', paths: ['pages/notes.html'], site: 'kept' },
    )
    assert.equal(wiki.warnings.length, 1)
    assert.match(
      wiki.warnings[0] ?? '',
      /^Update stopped at \d{1,2}:\d{2}(?:\s?[AP]M)?: it would overwrite your own file in the Wiki folder \(pages\/notes\.html\)\. Nothing was replaced\. Move or rename the file, then press Update LLM Wiki again\.$/,
    )
    assert.equal(await wiki.hashOutput(), hashBefore)
  } finally {
    await wiki.close()
  }
})

test('a candidate that exists before the click refuses the start as somebody else’s update and sends no chat request', async () => {
  // Arrange: another editor window on the same project has prepared its update a moment ago.
  const wiki = await openPublishedWikiWindow()
  await wiki.prepare()
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    const status = wiki.status()
    assert.equal(status.state, 'failed')
    assert.equal(status.state === 'failed' ? status.site : '', 'kept')
    assert.match(
      status.state === 'failed' ? status.reason : '',
      /^Another editor window or an earlier chat appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written \d{1,2}:\d{2}[^)]*\)\. Wait for it to finish, or delete that folder, then press Update LLM Wiki again\.$/,
    )
    assert.deepEqual(wiki.chatRequests, [])
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
      /^Update failed at \d{1,2}:\d{2}(?:\s?[AP]M)?: Another editor window or an earlier chat appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written [^)]+\)\. Wait for it to finish, or delete that folder, then press Update LLM Wiki again\. The last usable site is kept\.$/,
    )
  } finally {
    await wiki.close()
  }
})

test('a retry after this window’s own run ended starts again although that run’s abandoned candidate is still there, and does not blame it', async () => {
  // Arrange: the first run ends as a conflict and leaves its candidate behind.
  const wiki = await openPublishedWikiWindow()
  await mkdir(join(wiki.outputDirectory, 'pages'))
  await writeFile(join(wiki.outputDirectory, 'pages', 'notes.html'), 'mine')
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })
    const firstRun = await waitForStatus(wiki.status, hasEnded)

    // Act
    await wiki.runUpdateCommand()
    await agentTakesAMoment()
    await agentTakesAMoment()

    // Assert
    assert.equal(firstRun.state, 'conflict')
    const retry = wiki.status()
    assert.equal(retry.state, 'running')
    assert.equal(
      retry.state === 'running' ? retry.candidateStaged : undefined,
      false,
    )
    assert.equal(wiki.chatRequests.length, 2)
  } finally {
    await wiki.close()
  }
})

test('a candidate the earlier chat keeps writing after this window stopped watching refuses the retry', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openPublishedWikiWindow({ cancellable: progress })
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await waitForStatus(
      wiki.status,
      (current) => current.state === 'running' && current.candidateStaged,
    )
    progress[0]?.cancel()
    const stopped = await waitForStatus(wiki.status, hasEnded)
    // Cancel stopped only the watch: the chat goes on and writes its candidate.
    await agentTakesAMoment()
    await wiki.writeCandidate(stage, { heading: 'Still working' })

    // Act
    await wiki.runUpdateCommand()

    // Assert
    assert.equal(stopped.state, 'cancelled')
    const retry = wiki.status()
    assert.equal(retry.state, 'failed')
    assert.match(
      retry.state === 'failed' ? retry.reason : '',
      /^Another editor window or an earlier chat appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written /,
    )
    assert.equal(wiki.chatRequests.length, 1)
  } finally {
    await wiki.close()
  }
})

test('a watched VS Code run says the chat is preparing a new site once the real publisher staged a candidate', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  try {
    await wiki.clickUpdate()
    const beforeStaging = wiki.status()
    await agentTakesAMoment()

    // Act
    await wiki.prepare()
    const afterStaging = await waitForStatus(
      wiki.status,
      (current) => current.state === 'running' && current.candidateStaged,
      2_000,
    )

    // Assert
    assert.equal(
      beforeStaging.state === 'running'
        ? beforeStaging.candidateStaged
        : undefined,
      false,
    )
    assert.equal(
      afterStaging.state === 'running'
        ? afterStaging.candidateStaged
        : undefined,
      true,
    )
  } finally {
    await wiki.close()
  }
})

test('a running Cursor update says the agent is preparing a new site once the real publisher staged a candidate', async () => {
  // Arrange
  const seenWhileRunning: WikiUpdateStatus[] = []
  let stageAndWatch: (() => Promise<void>) | undefined
  const wiki = await openPublishedWikiWindow({
    cursor: true,
    cursorAgent: async () => {
      await stageAndWatch?.()
      return 'I stopped before publishing.'
    },
  })
  stageAndWatch = async (): Promise<void> => {
    seenWhileRunning.push(wiki.status())
    await agentTakesAMoment()
    await wiki.prepare()
    seenWhileRunning.push(
      await waitForStatus(
        wiki.status,
        (current) => current.state === 'running' && current.candidateStaged,
        5_000,
      ),
    )
  }
  try {
    // Act
    await wiki.clickUpdate()

    // Assert
    assert.deepEqual(
      seenWhileRunning.map((status) =>
        status.state === 'running' ? status.candidateStaged : status.state,
      ),
      [false, true],
    )
  } finally {
    await wiki.close()
  }
})
