import assert from 'node:assert/strict'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import type { WikiUpdateStatus } from '../utils/wikiUpdateRun'

import { publishedWikiFixture } from './utils/publishedWikiFixture'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'
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
      /^Update stopped at \d{1,2}:\d{2}(?:\s?[AP]M)?: it would overwrite your own file in the Wiki folder \(pages\/notes\.html\)\. Nothing was replaced\. Move or rename the file\. The VS Code chat was not stopped: answer it and it can publish, or stop it and press Update LLM Wiki, then Update anyway if Codebook still waits for it\.$/,
    )
    assert.equal(await wiki.hashOutput(), hashBefore)
  } finally {
    await wiki.close()
  }
})

// Value: protects=the Wiki and the learner after a VS Code watch ended on a file of theirs while the chat that staged the site still works; fails_when=the press the sentence names sends a second request into a new chat beside the first (the run left no reservation and took the chat's candidate for its own leftover), or the refusal offers no Update anyway, or the chat, which the sentence says can still publish, can no longer do so once the file is out of the way; why_new=Cycle 0046 row 343; seam=none (the real publisher stages and publishes)
test('after a VS Code watch ended on a learner’s file while the chat still works, the learner moves the file and presses: no second request is sent, the press is answered with the wait for that chat and Update anyway, and the chat can still publish its site', async () => {
  // Arrange: the chat stages a page where the learner's file is, and the watch ends on it; the chat was not stopped.
  const wiki = await openPublishedWikiWindow()
  const notesPath = join(wiki.outputDirectory, 'pages', 'notes.html')
  await mkdir(dirname(notesPath))
  await writeFile(notesPath, 'mine')
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare(
      join(dirname(wiki.outputDirectory), 'wiki-next'),
    )
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })
    const atTheConflict = await waitForStatus(wiki.status, hasEnded)

    // Act: the learner moves the file aside and presses, as the sentence says; then the chat, which still works, publishes.
    await rename(notesPath, join(wiki.projectRoot, 'notes-kept.html'))
    await wiki.clickUpdate()
    const pressed = wiki.status()
    const offeredAtThePress = wiki.offeredActions.at(-1)?.actions
    const requestsAfterThePress = wiki.chatRequests.length
    await wiki.publish(stage)
    const publishedPage = await readFile(notesPath, 'utf8')

    // Assert
    assert.equal(atTheConflict.state, 'conflict')
    assert.equal(requestsAfterThePress, 1)
    assert.equal(pressed.state, 'failed')
    assert.match(
      wiki.errors[1] ?? '',
      /^Update failed at \d{1,2}:\d{2}(?:\s?[AP]M)?: The VS Code chat this window asked at \d{1,2}:\d{2}[^;(]* may still be updating this Wiki \(candidate wiki-next, written \d{1,2}:\d{2}[^)]*\); Codebook stopped watching it at \d{1,2}:\d{2}[^.]* and waits for it until \d{1,2}:\d{2}[^.]*\. If that chat was stopped, choose Update anyway in the editor’s notification\. Nothing had been replaced by then\.$/,
    )
    assert.deepEqual(offeredAtThePress, ['Update anyway', 'Open LLM Wiki'])
    assert.notEqual(publishedPage, 'mine')
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

// Value: protects=the retry after a run whose chat has stopped and left its candidate behind; fails_when=the start check takes that run's own abandoned candidate for somebody else's work in progress and refuses the retry, or the new run shows the old candidate as its own; why_new=Cycle 0045 (the own leftover), rewritten with Cycle 0046 row 343: its run used to end on a learner's file, after which the chat is not stopped and the retry is held back now; this run ends with the chat's complete reply; seam=the chat's reply, which the test completes after the candidate is staged
test('a retry after this window’s own run ended with the chat’s reply starts again although that run’s abandoned candidate is still there, and does not blame it', async () => {
  // Arrange: the chat of the first run stages a candidate, then completes its reply without publishing; a later chat works.
  let completeTheReply = (): void => {}
  let replyCount = 0
  const wiki = await openPublishedWikiWindow({
    chatReply: () => {
      replyCount += 1
      return replyCount === 1
        ? new Promise((resolveReply) => {
            completeTheReply = (): void => resolveReply({})
          })
        : Promise.resolve({ type: 'confirmation', kind: 'toolInvocation' })
    },
  })
  try {
    // The press returns once the chat showed a sign: the folder the publisher prepares is one.
    const press = wiki.clickUpdate()
    await waitForStatus(wiki.status, () => wiki.chatRequests.length === 1)
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, { heading: 'Second' })
    await press
    await waitForStatus(
      wiki.status,
      (current) => current.state === 'running' && current.candidateStaged,
    )
    completeTheReply()
    const firstRun = await waitForStatus(wiki.status, hasEnded)

    // Act
    await wiki.runUpdateCommand()
    await agentTakesAMoment()
    await agentTakesAMoment()

    // Assert
    assert.equal(firstRun.state, 'failed')
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

// Value: protects=the learner whose VS Code chat has stopped after the watch ended on a file of theirs; fails_when=Update anyway on the refused press starts no update, or the new run takes the earlier chat's abandoned candidate for its own, or the chat's candidate (which the watch saw) and the chat's stopped watch are named in two refusals, so one stopped chat needs Update anyway twice; why_new=Cycle 0046 row 343 (the step the sentence names for a start again), second ship P2SM2 (the refusal count); seam=none
test('after a VS Code watch ended on a learner’s file, Update anyway on the one refusal of the next press starts the update again, and the new run does not take the earlier chat’s candidate for its own', async () => {
  // Arrange: the first run ends as a conflict and leaves its candidate behind.
  let isOverrideChosen = false
  const wiki = await openPublishedWikiWindow({
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
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
    const offersBefore = wiki.offeredActions.length

    // Act: the press is refused, and Update anyway is chosen on its notification.
    isOverrideChosen = true
    await wiki.runUpdateCommand()
    const retry = await waitForStatus(
      wiki.status,
      (current) => current.state === 'running',
    )
    await agentTakesAMoment()
    await agentTakesAMoment()

    // Assert
    assert.equal(firstRun.state, 'conflict')
    const refusals = wiki.offeredActions
      .slice(offersBefore)
      .filter(({ actions }) => actions.includes('Update anyway'))
      .map(({ message }) => message)
    assert.equal(refusals.length, 1)
    assert.match(
      refusals[0] ?? '',
      new RegExp(
        `The VS Code chat this window asked at \\d{1,2}:\\d{2}[^;(]* may still be updating this Wiki \\(candidate ${basename(stage)}, written `,
      ),
    )
    assert.deepEqual(wiki.offeredActions.at(-1)?.actions, [
      'Update anyway',
      'Open LLM Wiki',
    ])
    assert.equal(retry.state, 'running')
    const afterAMoment = wiki.status()
    assert.equal(
      afterAMoment.state === 'running'
        ? afterAMoment.candidateStaged
        : undefined,
      false,
    )
    assert.equal(wiki.chatRequests.length, 2)
  } finally {
    await wiki.close()
  }
})

// Value: protects=the learner who presses Update LLM Wiki and chooses Update anyway right after a VS Code watch ended on a file of theirs, while this window still turns the ended run's marker into a stopped watch's reservation; fails_when=the start's claim meets the marker in that turn, which is this window's own, and the start is refused with "Another editor window is starting or ending an update of this Wiki", so the update does not start; why_new=Cycle 0052 task 27 (the test above failed once inside pnpm health's coverage run: under load Update anyway's start claimed while the reservation was written); seam=the write of the reservation beside the marker, which the test holds while the turn holds the claim on the marker; no_claim=another window's change of the marker, which still refuses the start
test('Update anyway chosen while this window still turns its ended run’s marker into a reservation starts the update once the turn is made, and no refusal names another editor window', async () => {
  // Arrange: the first run ends as a conflict; the write of its reservation, under the claim on the marker, is held.
  let isOverrideChosen = false
  const wiki = await openPublishedWikiWindow({
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
  await mkdir(join(wiki.outputDirectory, 'pages'))
  await writeFile(join(wiki.outputDirectory, 'pages', 'notes.html'), 'mine')
  const reservationWrite = wiki.hold('marker-write')
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })
    const firstRun = await waitForStatus(wiki.status, hasEnded)
    await reservationWrite.started

    // Act: the learner presses and chooses Update anyway on its refusal while the reservation is still written; Update anyway's start claims the marker; then the write ends.
    isOverrideChosen = true
    await wiki.runUpdateCommand()
    const errorsAfterThePress = wiki.errors.length
    await waitUntil(
      () => wiki.looks.markerClaims >= 2,
      'the claim of the start of Update anyway',
      READER_RESULT_BOUND_MS,
    )
    reservationWrite.release()
    await waitUntil(
      () =>
        wiki.status().state === 'running' ||
        wiki.errors.length > errorsAfterThePress,
      'the start of Update anyway or its refusal',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(firstRun.state, 'conflict')
    assert.deepEqual(wiki.errors.slice(errorsAfterThePress), [])
    assert.equal(wiki.status().state, 'running')
    assert.equal(wiki.chatRequests.length, 2)
  } finally {
    reservationWrite.release()
    await wiki.close()
  }
})

// Value: protects=Update anyway chosen while this window's ended run turned its marker into a reservation, when that turn ends between the start's claim meeting the marker in change and the start reading that answer: the start claims again and runs; fails_when=claimWikiMarkerForStart claims again only while the change still runs, so a change that ended just before is taken for another window's and the start is refused with "Another editor window is starting or ending an update of this Wiki" (Cycle 0052 task 27); why_new=pt3 /ship review (testing): the ended-change branch had no test; seam=the write of the reservation, held under the claim, and the moment after the start's claim answered, both held by the test; no_claim=how often this ordering occurs natively
test('Update anyway whose claim met this window’s marker turn, which ended before the start read the answer, starts the update', async () => {
  // Arrange: the first run ends as a conflict; the write of its reservation is held under the claim on the marker.
  let isOverrideChosen = false
  const wiki = await openPublishedWikiWindow({
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
  await mkdir(join(wiki.outputDirectory, 'pages'))
  await writeFile(join(wiki.outputDirectory, 'pages', 'notes.html'), 'mine')
  const reservationWrite = wiki.hold('marker-write')
  // Held from the act on; released in finally too, so a failed wait never leaves the start held while the window closes.
  let claimAnswer: ReturnType<typeof wiki.hold> | undefined
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const stage = await wiki.prepare()
    await wiki.writeCandidate(stage, {
      heading: 'Second',
      extraPages: ['pages/notes.html'],
    })
    const firstRun = await waitForStatus(wiki.status, hasEnded)
    await reservationWrite.started
    claimAnswer = wiki.hold('claim-answer')

    // Act: Update anyway's claim meets the marker in change and is held before the start reads the answer; the turn then ends, and only after it the start reads the answer.
    isOverrideChosen = true
    await wiki.runUpdateCommand()
    const errorsAfterThePress = wiki.errors.length
    await claimAnswer.started
    reservationWrite.release()
    await waitUntil(
      () => wiki.markerChanges.at(-1)?.answer !== undefined,
      'the end of the reservation turn',
      READER_RESULT_BOUND_MS,
    )
    claimAnswer.release()
    await waitUntil(
      () =>
        wiki.status().state === 'running' ||
        wiki.errors.length > errorsAfterThePress,
      'the start of Update anyway or its refusal',
      READER_RESULT_BOUND_MS,
    )

    // Assert
    assert.equal(firstRun.state, 'conflict')
    assert.deepEqual(wiki.markerChanges, [{ kind: 'reserve', answer: true }])
    assert.deepEqual(wiki.errors.slice(errorsAfterThePress), [])
    assert.equal(wiki.status().state, 'running')
    assert.equal(wiki.chatRequests.length, 2)
  } finally {
    reservationWrite.release()
    claimAnswer?.release()
    await wiki.close()
  }
})

// Value: protects=the one agent per Wiki after this window's VS Code watch was stopped before its chat staged anything and a candidate that watch never saw appeared since: two leftovers, each of which may still publish; fails_when=Update anyway on the refusal that names the candidate passes every leftover the check found, so the update starts past this window's own stopped chat, which no notification named; why_new=Cycle 0046 second ship, state-machine review P2SM1 (the SM2 fix had a test for a reservation named first only); seam=none (the real publisher stages the candidate); no_claim=which chat wrote the candidate
test('Update anyway on a refusal that named a candidate the stopped watch never saw, while this window’s own stopped chat is also in the way, is refused again naming this window’s chat, with no chat request', async () => {
  // Arrange: this window's VS Code watch stops before its chat staged anything; a candidate the watch never saw appears afterwards.
  const progress: CancellableProgress[] = []
  let isOverrideChosen = false
  const wiki = await openPublishedWikiWindow({
    cancellable: progress,
    chooseAction: (_message, actions) =>
      isOverrideChosen
        ? actions.find((action) => action === 'Update anyway')
        : undefined,
  })
  try {
    await wiki.clickUpdate()
    progress[0]!.cancel()
    await waitForStatus(wiki.status, hasEnded)
    await agentTakesAMoment()
    await wiki.prepare()
    const requestsBefore = wiki.chatRequests.length
    const refusalsBefore = wiki.offeredActions.length

    // Act: the learner presses Update and chooses Update anyway on the first refusal only.
    isOverrideChosen = true
    await wiki.clickUpdate()
    isOverrideChosen = false
    const deadline = Date.now() + 2_000
    while (
      wiki.offeredActions.length < refusalsBefore + 2 &&
      wiki.status().state !== 'running' &&
      Date.now() < deadline
    )
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))

    // Assert
    const refusals = wiki.offeredActions
      .slice(refusalsBefore)
      .map(({ message }) => message)
    assert.equal(refusals.length, 2)
    assert.match(
      refusals[0] ?? '',
      /An earlier chat or another editor window appears to be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written /,
    )
    assert.match(
      refusals[1] ?? '',
      /The VS Code chat this window asked at \d{1,2}:\d{2}[^;]* may still be updating this Wiki; Codebook stopped watching it at /,
    )
    assert.equal(wiki.chatRequests.length, requestsBefore)
    assert.equal(wiki.status().state, 'failed')
  } finally {
    await wiki.close()
  }
})

// Value: protects=the way on for a learner whose start is in the way of two leftovers at once, a candidate this window's stopped watch never saw and that watch's own chat, and who chooses Update anyway on each refusal; fails_when=a press of Update anyway passes only the leftovers of its own refusal and drops those an earlier press passed, so the two refusals take turns without end and the update never starts, or the start removes the candidate; why_new=Cycle 0047 row 9 (P3SM1: the mutant that keeps only the last refusal's leftovers passed every flow test); seam=none (the real publisher stages the candidate); no_claim=which chat wrote the candidate
test('Update anyway on each refusal, first for a candidate the stopped watch never saw and then for this window’s own stopped chat, starts the update after those two refusals with one new chat request and keeps the candidate', async () => {
  // Arrange: this window's VS Code watch stops before its chat staged anything; a candidate the watch never saw appears afterwards.
  const progress: CancellableProgress[] = []
  let isOverrideChosen = false
  let pressesOfUpdateAnyway = 0
  const wiki = await openPublishedWikiWindow({
    cancellable: progress,
    // The learner chooses Update anyway on each refusal; after five presses the test stops, so refusals that take turns come to an end.
    chooseAction: (_message, actions) => {
      if (
        !isOverrideChosen ||
        !actions.includes('Update anyway') ||
        pressesOfUpdateAnyway >= 5
      )
        return undefined
      pressesOfUpdateAnyway += 1
      return 'Update anyway'
    },
  })
  try {
    await wiki.clickUpdate()
    progress[0]!.cancel()
    await waitForStatus(wiki.status, hasEnded)
    await agentTakesAMoment()
    const candidate = await wiki.prepare()
    const requestsBefore = wiki.chatRequests.length
    const refusalsBefore = wiki.offeredActions.length

    // Act
    isOverrideChosen = true
    await wiki.clickUpdate()
    const started = await waitForStatus(
      wiki.status,
      (current) => current.state === 'running',
      3_000,
    )
    await agentTakesAMoment()

    // Assert
    const refusals = wiki.offeredActions
      .slice(refusalsBefore)
      .filter(({ actions }) => actions.includes('Update anyway'))
      .map(({ message }) => message)
    assert.equal(refusals.length, 2)
    assert.match(
      refusals[0] ?? '',
      new RegExp(
        `An earlier chat or another editor window appears to be updating this Wiki \\(candidate ${basename(candidate)}, written `,
      ),
    )
    assert.match(
      refusals[1] ?? '',
      /The VS Code chat this window asked at \d{1,2}:\d{2}[^;]* may still be updating this Wiki; Codebook stopped watching it at /,
    )
    assert.equal(started.state, 'running')
    assert.equal(wiki.chatRequests.length, requestsBefore + 1)
    assert.equal((await stat(candidate)).isDirectory(), true)
  } finally {
    await wiki.close()
  }
})

/** Waits until a window's stopped watch has turned its marker into the watch's reservation, which another window's start reads. */
async function waitForReservation(
  window: {
    markerChanges: Array<{ kind: string; answer?: boolean | 'threw' }>
  },
  limitMs = 6_000,
): Promise<void> {
  const deadline = Date.now() + limitMs
  while (
    !window.markerChanges.some(
      (change) => change.kind === 'reserve' && change.answer === true,
    ) &&
    Date.now() < deadline
  )
    await new Promise((resolveWait) => setTimeout(resolveWait, 20))
}

// Value: protects=the one agent per Wiki, and the way on, for a learner whose start is in the way of another window's stopped watch and of this window's own stopped chat together with the candidate that chat's watch saw; fails_when=a press of Update anyway drops what the press before it passed, so the refusal for the other window's chat and the one for this window's chat take turns without end, or the candidate and this window's chat are named in two refusals, so one chat needs Update anyway twice, or the start goes on past a leftover no refusal named; why_new=Cycle 0047 row 10 (P3SM2: the one refusal for a candidate the stopped watch saw (the second ship's P2SM2) had no test beside another window's reservation); seam=none (two windows of the real extension, the real publisher stages the candidate); no_claim=which chat wrote the candidate
test('Update anyway on each refusal of a start that another window’s stopped watch and this window’s own stopped chat with the candidate its watch saw are in the way of names the other window’s chat first and this window’s candidate second, then starts the update with one new chat request and keeps the candidate', async () => {
  // Arrange: this window's chat stages a candidate its watch sees, and the learner stops that watch; another window then passes both with Update anyway, starts, and its learner stops that watch too.
  const progress: CancellableProgress[] = []
  let isOverrideChosen = false
  let pressesOfUpdateAnyway = 0
  const wiki = await openPublishedWikiWindow({
    cancellable: progress,
    // The learner chooses Update anyway on each refusal; after five presses the test stops, so refusals that take turns come to an end.
    chooseAction: (_message, actions) => {
      if (
        !isOverrideChosen ||
        !actions.includes('Update anyway') ||
        pressesOfUpdateAnyway >= 5
      )
        return undefined
      pressesOfUpdateAnyway += 1
      return 'Update anyway'
    },
  })
  const otherProgress: CancellableProgress[] = []
  let otherPressesOfUpdateAnyway = 0
  const otherWindow = await openWikiUpdateWindow({
    projectRoot: wiki.projectRoot,
    cancellable: otherProgress,
    // The other window's learner chooses Update anyway on each of its refusals, at most five times.
    chooseAction: (_message, actions) => {
      if (!actions.includes('Update anyway') || otherPressesOfUpdateAnyway >= 5)
        return undefined
      otherPressesOfUpdateAnyway += 1
      return 'Update anyway'
    },
  })
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const candidate = await wiki.prepare()
    await waitForStatus(
      wiki.status,
      (current) => current.state === 'running' && current.candidateStaged,
    )
    progress[0]!.cancel()
    await waitForStatus(wiki.status, hasEnded)
    await waitForReservation(wiki)
    await otherWindow.clickUpdate()
    const otherRun = await waitForStatus(
      otherWindow.status,
      (current) => current.state === 'running',
    )
    otherProgress[0]?.cancel()
    await waitForStatus(otherWindow.status, hasEnded)
    await waitForReservation(otherWindow)
    const requestsBefore = wiki.chatRequests.length
    const refusalsBefore = wiki.offeredActions.length

    // Act
    isOverrideChosen = true
    await wiki.clickUpdate()
    const started = await waitForStatus(
      wiki.status,
      (current) => current.state === 'running',
      3_000,
    )
    await agentTakesAMoment()

    // Assert
    assert.equal(otherRun.state, 'running')
    const refusals = wiki.offeredActions
      .slice(refusalsBefore)
      .filter(({ actions }) => actions.includes('Update anyway'))
      .map(({ message }) => message)
    assert.equal(refusals.length, 2)
    assert.match(
      refusals[0] ?? '',
      /The VS Code chat another editor window asked at \d{1,2}:\d{2}[^;]* may still be updating this Wiki; that window stopped watching it at /,
    )
    assert.match(
      refusals[1] ?? '',
      new RegExp(
        `The VS Code chat this window asked at \\d{1,2}:\\d{2}[^;(]* may still be updating this Wiki \\(candidate ${basename(candidate)}, written `,
      ),
    )
    assert.equal(started.state, 'running')
    assert.equal(wiki.chatRequests.length, requestsBefore + 1)
    assert.equal((await stat(candidate)).isDirectory(), true)
  } finally {
    await otherWindow.close()
    await wiki.close()
  }
})

// Value: protects=the one agent per Wiki when Update anyway is pressed late on the refusal that named this window's stopped chat with the newest candidate its watch saw, after another candidate that watch saw was written again; fails_when=a refusal that names several leftovers is passed as soon as one of them was passed (every leftover unpassed is asked for, instead of any), so the late press starts a second chat beside the one that is still writing; why_new=Cycle 0047 row 11 (P3SM3: that mutant passed every flow test); seam=the learner's press of the notification's button, which the test makes after the candidate was written again; no_claim=which chat wrote the candidate again
test('Update anyway pressed late on the refusal that named this window’s stopped chat with the newest candidate its watch saw is refused again once an older candidate that watch saw was written again, names that candidate, and sends no chat request', async () => {
  // Arrange: this window's chat stages two candidates, its watch sees both, and the learner stops the watch; the next press is refused, and its Update anyway is pressed later.
  const progress: CancellableProgress[] = []
  let pressUpdateAnyway = (): void => {}
  const laterPress = new Promise<string>((resolvePress) => {
    pressUpdateAnyway = (): void => resolvePress('Update anyway')
  })
  let isOverrideChosen = false
  let offersOfUpdateAnyway = 0
  const wiki = await openPublishedWikiWindow({
    cancellable: progress,
    // Only the first refusal's button is pressed, when the test says; the refusal after it is left alone.
    chooseAction: (_message, actions) => {
      if (!isOverrideChosen || !actions.includes('Update anyway'))
        return undefined
      offersOfUpdateAnyway += 1
      return offersOfUpdateAnyway === 1 ? laterPress : undefined
    },
  })
  try {
    await wiki.clickUpdate()
    await agentTakesAMoment()
    const olderStage = await wiki.prepare()
    await agentTakesAMoment()
    const newerStage = await wiki.prepare()
    // The watch looks again once the second receipt is on disk; that look sees both candidates.
    const listingsWithBothStaged = wiki.looks.candidateListings
    await waitForStatus(
      wiki.status,
      () => wiki.looks.candidateListings > listingsWithBothStaged,
    )
    await agentTakesAMoment()
    progress[0]!.cancel()
    await waitForStatus(wiki.status, hasEnded)
    const refusalsBefore = wiki.offeredActions.length
    isOverrideChosen = true
    await wiki.clickUpdate()
    const requestsBefore = wiki.chatRequests.length
    // The chat, which the stopped watch did not stop, writes its older candidate again.
    await agentTakesAMoment()
    await wiki.writeCandidate(olderStage, { heading: 'Still working' })

    // Act
    pressUpdateAnyway()
    const deadline = Date.now() + 6_000
    while (
      wiki.offeredActions.length < refusalsBefore + 2 &&
      wiki.status().state !== 'running' &&
      Date.now() < deadline
    )
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))
    await agentTakesAMoment()

    // Assert
    const refusals = wiki.offeredActions
      .slice(refusalsBefore)
      .filter(({ actions }) => actions.includes('Update anyway'))
      .map(({ message }) => message)
    assert.equal(refusals.length, 2)
    assert.match(
      refusals[0] ?? '',
      new RegExp(
        `The VS Code chat this window asked at \\d{1,2}:\\d{2}[^;(]* may still be updating this Wiki \\(candidate ${basename(newerStage)}, written `,
      ),
    )
    assert.match(
      refusals[1] ?? '',
      new RegExp(
        `The VS Code chat this window asked at \\d{1,2}:\\d{2}[^;(]* may still be updating this Wiki \\(candidate ${basename(olderStage)}, written `,
      ),
    )
    assert.equal(wiki.chatRequests.length, requestsBefore)
    assert.equal(wiki.status().state, 'failed')
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
      /^The VS Code chat this window asked at \d{1,2}:\d{2}[^;(]* may still be updating this Wiki \(candidate wiki\.stage-[0-9a-f-]{36}, written /,
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
