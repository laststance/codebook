import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
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

test('a manifest changed after its publish stops the update before any chat request instead of letting the watch time out', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  const manifestPath = join(wiki.outputDirectory, 'codebook-wiki.json')
  const editedManifest = `${await readFile(manifestPath, 'utf8')}\n`
  await writeFile(manifestPath, editedManifest)
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
        cause: 'edited-manifest',
        paths: ['codebook-wiki.json'],
        site: 'kept',
      },
    )
    assert.deepEqual(wiki.chatRequests, [])
    assert.equal(wiki.errors.length, 1)
    assert.equal(await readFile(manifestPath, 'utf8'), editedManifest)
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
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
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
      /^An earlier chat or another editor window appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written \d{1,2}:\d{2}[^)]*\)\. Codebook waits for it until \d{1,2}:\d{2}[^.]*\. If that chat was stopped, choose Update anyway in the editor’s notification\.$/,
    )
    assert.deepEqual(wiki.chatRequests, [])
    assert.equal(wiki.errors.length, 1)
    assert.match(
      wiki.errors[0] ?? '',
      /^Update failed at \d{1,2}:\d{2}(?:\s?[AP]M)?: An earlier chat or another editor window appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written [^)]+\)\. Codebook waits for it until [^.]+\. If that chat was stopped, choose Update anyway in the editor’s notification\. Nothing had been replaced by then\.$/,
    )
  } finally {
    await wiki.close()
  }
})

// Value: protects=the one agent per Wiki that "Update anyway" must keep; fails_when=the button ignores every leftover at the time of its press, so a press in the Notification Center after another chat staged a new candidate starts a second agent beside it; why_new=Cycle 0045 pre-landing review PL-24 (row 32 of Cycle 0046); seam=the learner's press of the notification's button, which the test makes after the new candidate was written
test('Update anyway pressed after a new candidate was written since the refusal is refused again, names the new candidate and sends no chat request', async () => {
  // Arrange: a candidate refuses the press; the learner presses Update anyway on that notification later.
  let pressUpdateAnyway = (): void => {}
  const laterPress = new Promise<string>((resolvePress) => {
    pressUpdateAnyway = (): void => resolvePress('Update anyway')
  })
  let offersOfUpdateAnyway = 0
  const wiki = await openPublishedWikiWindow({
    // Only the first refusal's button is pressed; the second refusal is left alone.
    chooseAction: (_message, actions) => {
      if (!actions.includes('Update anyway')) return undefined
      offersOfUpdateAnyway += 1
      return offersOfUpdateAnyway === 1 ? laterPress : undefined
    },
  })
  try {
    const firstStage = await wiki.prepare()
    await wiki.clickUpdate()
    const refused = wiki.status()
    // Another chat prepares its own candidate after the refusal.
    await agentTakesAMoment()
    const newStage = await wiki.prepare()

    // Act
    pressUpdateAnyway()
    const deadline = Date.now() + 6_000
    while (wiki.offeredActions.length < 2 && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))

    // Assert
    const refusedAgain = wiki.status()
    assert.equal(refused.state, 'failed')
    assert.match(
      refused.state === 'failed' ? refused.reason : '',
      new RegExp(`\\(candidate ${basename(firstStage)}, written `),
    )
    assert.equal(refusedAgain.state, 'failed')
    assert.match(
      refusedAgain.state === 'failed' ? refusedAgain.reason : '',
      new RegExp(
        `^An earlier chat or another editor window appears to be updating this Wiki \\(candidate ${basename(newStage)}, written \\d{1,2}:\\d{2}[^)]*\\)\\. Codebook waits for it until \\d{1,2}:\\d{2}[^.]*\\. If that chat was stopped, choose Update anyway in the editor’s notification\\.$`,
      ),
    )
    assert.deepEqual(
      wiki.offeredActions.map((offered) => offered.actions),
      [
        ['Update anyway', 'Open LLM Wiki'],
        ['Update anyway', 'Open LLM Wiki'],
      ],
    )
    assert.deepEqual(wiki.chatRequests, [])
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
      /^An earlier chat or another editor window appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written /,
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

test('a watched VS Code run parses the candidates once while nothing is written, not at every look', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  try {
    await wiki.clickUpdate()

    // Act: the watch looks every 20 ms in this window; nothing writes to the Wiki or beside it.
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))

    // Assert: the watch looked many times, and still there is one listing by the start guard before the run and one by the watch's first look.
    assert.equal(wiki.status().state, 'running')
    assert.ok(
      wiki.looks.stampReads >= 5,
      `the watch looked ${wiki.looks.stampReads} times in 400 ms`,
    )
    assert.equal(wiki.looks.candidateListings, 2)
  } finally {
    await wiki.close()
  }
})

test('a running Cursor update parses the candidates once while nothing is written, not at every look', async () => {
  // Arrange
  const listingsWhileRunning: number[] = []
  const looksWhileRunning: number[] = []
  let idle: (() => Promise<void>) | undefined
  const wiki = await openPublishedWikiWindow({
    cursor: true,
    constants: { WIKI_UPDATE_WATCH_POLL_MS: 20 },
    cursorAgent: async () => {
      await idle?.()
      return 'I stopped before publishing.'
    },
  })
  idle = async (): Promise<void> => {
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))
    listingsWhileRunning.push(wiki.looks.candidateListings)
    looksWhileRunning.push(wiki.looks.stampReads)
  }
  try {
    // Act
    await wiki.clickUpdate()

    // Assert: the run looked many times, and still there is one listing by the start guard and one by the first look beside the agent; the look at the run's end adds a third.
    assert.ok(
      (looksWhileRunning[0] ?? 0) >= 5,
      `the run looked ${looksWhileRunning[0]} times in 400 ms`,
    )
    assert.deepEqual(listingsWhileRunning, [2])
    assert.equal(wiki.looks.candidateListings, 3)
  } finally {
    await wiki.close()
  }
})

test('a publish the real publisher refuses over the learner’s file ends the watched run as a conflict, and the previous site, its manifest, its receipt and the learner’s files are byte-identical', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  await mkdir(join(wiki.outputDirectory, 'pages'))
  await writeFile(join(wiki.outputDirectory, 'pages', 'notes.html'), 'mine')
  const hashBefore = await wiki.hashOutput()
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()

    // Act: the agent prepares the default stage, writes a page where the learner's file is, and tries to publish.
    const stage = await wiki.prepare()
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
    assert.equal(await wiki.hashOutput(), hashBefore)
    assert.equal(await readFile(wiki.learnerFile, 'utf8'), 'my own notes\n')
  } finally {
    await wiki.close()
  }
})

test('cancelling a watched run while the agent has a candidate staged leaves the whole Wiki folder byte-identical', async () => {
  // Arrange
  const progress: CancellableProgress[] = []
  const wiki = await openPublishedWikiWindow({ cancellable: progress })
  const hashBefore = await wiki.hashOutput()
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    await waitForStatus(
      wiki.status,
      (current) => current.state === 'running' && current.candidateStaged,
    )

    // Act
    progress[0]?.cancel()
    const ended = await waitForStatus(wiki.status, hasEnded)

    // Assert
    assert.equal(ended.state, 'cancelled')
    assert.equal(ended.state === 'cancelled' ? ended.site : '', 'kept')
    assert.equal(await wiki.hashOutput(), hashBefore)
  } finally {
    await wiki.close()
  }
})

test(
  'a watched run in which nothing is published ends as timed out when its fifteen minutes have passed, warns in the editor and leaves the Wiki folder byte-identical',
  { timeout: 30_000 },
  async () => {
    // Arrange: the watch's clock is the test's, so fifteen minutes pass in as many looks without waiting.
    let nowMs = 0
    const wiki = await openPublishedWikiWindow({
      watchClock: {
        now: () => nowMs,
        sleep: async (delayMs: number): Promise<void> => {
          nowMs += delayMs
          await new Promise((resolveTurn) => setImmediate(resolveTurn))
        },
      },
    })
    const hashBefore = await wiki.hashOutput()
    try {
      // Act
      await wiki.clickUpdate()
      const ended = await waitForStatus(wiki.status, hasEnded, 20_000)

      // Assert
      assert.equal(ended.state, 'timed-out')
      assert.deepEqual(
        ended.state === 'timed-out' ? [ended.timeoutMs, ended.site] : [],
        [900_000, 'kept'],
      )
      assert.equal(nowMs, 900_000)
      assert.equal(wiki.errors.length, 1)
      assert.match(
        wiki.errors[0] ?? '',
        /^No new site appeared within 15 minutes, so Codebook stopped watching at \d{1,2}:\d{2}(?:\s?[AP]M)?\. Nothing had been replaced by then\. Check the VS Code chat: answer it if it waits for you; let it finish if it is still working \(it can still publish, and the Wiki page says when it has\)\. If it stopped or reported a problem, press Update LLM Wiki, then Update anyway in the editor’s notification if Codebook still waits for that chat\.$/,
      )
      assert.equal(await wiki.hashOutput(), hashBefore)
    } finally {
      await wiki.close()
    }
  },
)

// Value: protects=the editor's notification appearing together with the page's result; fails_when=the run records its ending, then waits for file work (the removal of its marker file) and only then tells the learner, so the page shows the result while the editor shows nothing yet; why_new=Cycle 0045 (found on the merged tree: the timed-out watch's test read no notification once under load, because the marker's removal stood between the recorded ending and the notice); seam=none
test(
  'the editor shows an ended update’s notification in the same turn the page’s status changes',
  { timeout: 30_000 },
  async () => {
    // Arrange: a watch whose fifteen minutes pass in as many looks, read once per event-loop turn.
    let nowMs = 0
    const wiki = await openPublishedWikiWindow({
      watchClock: {
        now: () => nowMs,
        sleep: async (delayMs) => {
          nowMs += delayMs
          await new Promise((resolveTurn) => setImmediate(resolveTurn))
        },
      },
    })
    try {
      // Act: note what the editor has shown in the first turn in which the status is no longer running.
      await wiki.clickUpdate()
      while (wiki.status().state === 'running')
        await new Promise((resolveTurn) => setImmediate(resolveTurn))
      const shownWhenStatusEnded = {
        state: wiki.status().state,
        errorNotices: wiki.errors.length,
      }

      // Assert
      assert.deepEqual(shownWhenStatusEnded, {
        state: 'timed-out',
        errorNotices: 1,
      })
    } finally {
      await wiki.close()
    }
  },
)

test('a publish into a configured Wiki folder is seen there, ends the run as succeeded and keeps the learner’s file', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow({ outputSetting: 'docs/my-wiki' })
  try {
    await wiki.clickUpdate()
    const whileRunning = wiki.status()
    await agentTakesAMoment()

    // Act: the agent publishes a new generation through the real publisher.
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/overview.html'],
    })
    wiki.setFreshness({ status: 'current', changedPaths: [], addedPaths: [] })
    await wiki.publish(stage)
    const ended = await waitForStatus(wiki.status, hasEnded)

    // Assert
    assert.equal(
      whileRunning.state === 'running' ? whileRunning.outputLabel : '',
      'docs/my-wiki',
    )
    assert.equal(ended.state, 'succeeded')
    assert.deepEqual(
      ended.state === 'succeeded'
        ? [ended.identity, ended.outputDirectory]
        : [],
      ['a1b2c3d4e5f6+0e819f59', join(wiki.projectRoot, 'docs/my-wiki')],
    )
    assert.equal(
      await readFile(
        join(wiki.projectRoot, 'docs/my-wiki/notes/mine.md'),
        'utf8',
      ),
      'my own notes\n',
    )
    assert.match(
      await readFile(
        join(wiki.projectRoot, 'docs/my-wiki/pages/overview.html'),
        'utf8',
      ),
      /Additional source explanation\./,
    )
  } finally {
    await wiki.close()
  }
})

test('a real publish that keeps the sources and the revision and only excludes a new file is seen and ends the run as succeeded', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()

    // Act: the same source hash and revision go into the new manifest; the page text and the exclusions differ.
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, {
      heading: 'First, with scratch files left out',
      excludedPaths: ['scratch'],
    })
    wiki.setFreshness({ status: 'current', changedPaths: [], addedPaths: [] })
    await wiki.publish(stage)
    const ended = await waitForStatus(wiki.status, hasEnded)

    // Assert: the displayed identity is the one the first generation had.
    assert.equal(ended.state, 'succeeded')
    assert.equal(
      ended.state === 'succeeded' ? ended.identity : '',
      'a1b2c3d4e5f6+0e819f59',
    )
  } finally {
    await wiki.close()
  }
})

test('after a start refused for a candidate an earlier chat left, choosing Update anyway starts the update without deleting the folder', async () => {
  // Arrange
  let isOverrideChosen = false
  const wiki = await openPublishedWikiWindow({
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
  try {
    // A chat that was stopped left the candidate it had prepared.
    const leftover = await wiki.prepare()
    await wiki.clickUpdate()
    const refused = wiki.status()
    const offered = wiki.offeredActions.at(-1)

    // Act
    isOverrideChosen = true
    await wiki.clickUpdate()
    const started = await waitForStatus(
      wiki.status,
      (current) => current.state === 'running',
      2_000,
    )

    // Assert
    assert.equal(refused.state, 'failed')
    assert.deepEqual(offered?.actions, ['Update anyway', 'Open LLM Wiki'])
    assert.equal(started.state, 'running')
    assert.equal(wiki.chatRequests.length, 1)
    assert.equal((await stat(leftover)).isDirectory(), true)
  } finally {
    await wiki.close()
  }
})

test('after a window reload the candidate this window’s own ended update left behind does not refuse the next start', async () => {
  // Arrange
  const workspaceState = new Map<string, unknown>()
  let agentRuns = 0
  const wiki = await openPublishedWikiWindow({
    cursor: true,
    workspaceState,
    cursorAgent: async () => {
      agentRuns += 1
      await agentTakesAMoment()
      // The agent stages a candidate and ends its turn without publishing it.
      await wiki.prepare()
      return 'I stopped before publishing.'
    },
  })
  try {
    await wiki.clickUpdate()
    const firstEnd = wiki.status()

    // Act: the window is reloaded; what it kept is its workspace state.
    const reloaded = await openWikiUpdateWindow({
      projectRoot: wiki.projectRoot,
      cursor: true,
      workspaceState,
      cursorAgent: async () => {
        agentRuns += 1
        return 'I stopped before publishing.'
      },
    })
    await reloaded.clickUpdate()
    const secondEnd = reloaded.status()
    await reloaded.close()

    // Assert
    assert.equal(firstEnd.state, 'failed')
    assert.equal(agentRuns, 2)
    assert.equal(
      secondEnd.state === 'failed' ? secondEnd.reason : '',
      'Cursor Agent finished without publishing a new Wiki. Run "/codebook Update LLM Wiki" in Cursor chat to see its own message.',
    )
  } finally {
    await wiki.close()
  }
})

test('a learner file created after the candidate was staged ends the watch as blocked and names it', async () => {
  // Arrange
  const wiki = await openPublishedWikiWindow()
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })
    await waitForStatus(
      wiki.status,
      (current) => current.state === 'running' && current.candidateStaged,
    )
    // The watch has looked at the candidate and found nothing in its way.
    await agentTakesAMoment()

    // Act: the learner now saves a file of their own where the candidate has a page.
    await mkdir(join(wiki.outputDirectory, 'pages'), { recursive: true })
    await writeFile(
      join(wiki.outputDirectory, 'pages', 'notes.html'),
      'my own page\n',
    )
    const ended = await waitForStatus(wiki.status, hasEnded, 3_000)

    // Assert
    assert.equal(ended.state, 'conflict')
    assert.deepEqual(ended.state === 'conflict' ? ended.paths : [], [
      'pages/notes.html',
    ])
  } finally {
    await wiki.close()
  }
})

test('a staged-candidate look that returns after its run ended does not show the next run as preparing a new site', async () => {
  // Arrange
  let agentRuns = 0
  let letSecondAgentFinish = (): void => {}
  const secondAgentMayFinish = new Promise<void>((resolveFinish) => {
    letSecondAgentFinish = resolveFinish
  })
  let reportSecondAgentStart = (): void => {}
  const secondAgentStarted = new Promise<void>((resolveStarted) => {
    reportSecondAgentStart = resolveStarted
  })
  let lookInFlight: ReturnType<typeof wiki.hold> | undefined
  const wiki = await openPublishedWikiWindow({
    cursor: true,
    constants: { WIKI_UPDATE_WATCH_POLL_MS: 20 },
    cursorAgent: async () => {
      agentRuns += 1
      if (agentRuns === 1) {
        // The first agent stages a candidate; the look that lists it is still in flight when the agent ends.
        await agentTakesAMoment()
        lookInFlight = wiki.hold('candidate-listing')
        await wiki.prepare()
        await lookInFlight.started
        return 'I stopped before publishing.'
      }
      reportSecondAgentStart()
      await secondAgentMayFinish
      return 'I stopped before publishing.'
    },
  })
  try {
    await wiki.clickUpdate()

    // Act: the second run is under way when the first run's look returns.
    const secondPress = wiki.clickUpdate()
    await secondAgentStarted
    lookInFlight?.release()
    await agentTakesAMoment()
    const secondRun = wiki.status()
    letSecondAgentFinish()
    await secondPress

    // Assert
    assert.equal(secondRun.state, 'running')
    assert.equal(
      secondRun.state === 'running' ? secondRun.candidateStaged : undefined,
      false,
    )
  } finally {
    letSecondAgentFinish()
    lookInFlight?.release()
    await wiki.close()
  }
})
