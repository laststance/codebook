import assert from 'node:assert/strict'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { WikiUpdateTimeoutError } from '../utils/wikiUpdateTimeoutError'

import {
  exists,
  openProjectWithoutWiki,
  publishGeneratedWiki,
} from './utils/openProjectWithoutWiki'
import type { CancellableProgress } from './utils/wikiUpdateWindow'

const GENERATE_COMMAND = 'codebook.generateDeepWiki'
const UPDATE_COMMAND = 'codebook.updateDeepWiki'
const CANCEL_COMMAND = 'codebook.cancelWikiRun'
const SHOW_OUTPUT_COMMAND = 'codebook.showWikiOutput'

/** Lets every promise reaction that is already queued run, so a step that settled late has had its turn. */
const flushQueuedReactions = (): Promise<void> =>
  new Promise((resolveFlush) => setImmediate(resolveFlush))

/** The window a test opened, as {@link openProjectWithoutWiki} returns it. */
type ProjectWindow = Awaited<ReturnType<typeof openProjectWithoutWiki>>

/** Replaces the learner's local time in a cancellation sentence, which differs by minute and locale. */
const withoutClockTime = (sentence: string): string =>
  sentence.replace(/at \d{1,2}:\d{2}(?:\s[AP]M)?/, 'at HH:MM')

/**
 * Waits until the window has written a taken-over reservation back, the observable end of a refused start that took one over.
 * Why: the run's own claim already changes the marker's window id before the write-back, so a wait on the marker's content reads a state that is not yet the end under load; the answer of the window's own `reserve` is.
 */
const waitForWriteBack = async (
  project: ProjectWindow,
  wanted = 1,
): Promise<void> => {
  await waitUntil(
    () =>
      project.markerChanges.filter(
        (change) => change.kind === 'reserve' && change.answer === true,
      ).length >= wanted,
    'the written-back reservation',
    6_000,
  )
}

/** Reads the window's own run marker as JSON, or `undefined` while none stands. */
const readMarker = async (
  markerPath: string,
): Promise<Record<string, unknown> | undefined> =>
  JSON.parse(await readFile(markerPath, 'utf8').catch(() => 'null')) ??
  undefined

/** Writes the reservation another VS Code window left when its generation stopped watching its chat. */
async function writeOtherWindowReservation(
  projectRoot: string,
  markerPath: string,
  watchEndedAtMs: number,
  runKind: 'generate' | 'update' = 'generate',
): Promise<void> {
  await mkdir(join(projectRoot, '.codebook'), { recursive: true })
  await writeFile(
    markerPath,
    JSON.stringify({
      pid: process.pid,
      windowId: 'the-other-window',
      host: 'vscode',
      startedAtMs: watchEndedAtMs - 60_000,
      watchEndedAtMs,
      // An update's marker never carried the field.
      ...(runKind === 'generate' ? { runKind } : {}),
    }),
  )
}

// Value: protects=Cycle 0056 task 2, a press that joins a start under way; fails_when=Update LLM Wiki pressed while a Generate's start checks run joins it in silence, names the wrong run kind or says it more than once; no_claim=the press that meets a running run (describeSecondWikiUpdateStart tests); seam=the start-block step held open
test('Update LLM Wiki pressed while a Generate’s start checks run says once that the press joins the generation', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  const startChecks = project.hold('start-block')
  const generating = project.runCommand(GENERATE_COMMAND)
  await startChecks.started

  // Act
  const joining = project.runCommand(UPDATE_COMMAND)
  await waitUntil(
    () => project.notices.length > 0,
    'the joined press’s notice',
    6_000,
  )
  startChecks.release()
  await generating
  await joining

  // Assert
  assert.deepEqual(project.notices, [
    'Codebook is already starting an LLM Wiki generation in this window; this press joins it.',
  ])
})

// Value: protects=Cycle 0056 task 2 the other way round; fails_when=Generate pressed while an Update's start checks run joins it in silence or calls the update a generation; no_claim=the refusal of a Generate on a folder that holds a Wiki (wikiGenerateFlow tests); seam=the freshness inspection held open
test('Generate LLM Wiki pressed while an Update’s start checks run says once that the press joins the update', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  const startChecks = project.hold('freshness-inspection')
  const updating = project.runCommand(UPDATE_COMMAND)
  await startChecks.started

  // Act
  const joining = project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.notices.length > 0,
    'the joined press’s notice',
    6_000,
  )
  startChecks.release()
  await updating
  await joining

  // Assert
  assert.deepEqual(project.notices, [
    'Codebook is already starting an LLM Wiki update in this window; this press joins it.',
  ])
})

// Value: protects=Cycle 0056 task 4, Codebook: Show LLM Wiki Output; fails_when=the command does not bring Output › Codebook to the front; no_claim=what the channel holds (wikiRunRecord tests); seam=the stubbed output channel
test('Show LLM Wiki Output brings Output › Codebook to the front', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())
  const shownBefore = project.outputShownCount()

  // Act
  await project.runCommand(SHOW_OUTPUT_COMMAND)

  // Assert
  assert.deepEqual(
    { shownBefore, shownAfter: project.outputShownCount() },
    { shownBefore: 0, shownAfter: 1 },
  )
})

// Value: protects=Cycle 0056 task 4, Stop LLM Wiki Run in a window that runs and starts nothing; fails_when=the command stays silent, says a run is starting, or shows the old sentence that names generation or update; no_claim=the stop of a run (wikiGenerateFlow tests); seam=none
test('Stop LLM Wiki Run in a window with no run says that no run is going on', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki()
  context.after(() => project.close())

  // Act
  await project.runCommand(CANCEL_COMMAND)

  // Assert
  assert.deepEqual(project.notices, [
    'No LLM Wiki run is going on in this window.',
  ])
})

// Value: protects=Cycle 0056 task 5, the learner's Cancel of a Cursor generation; fails_when=Cancel does not abort the agent's signal (which ends its process group in the runner), the end is not told as cancelled, or the marker stays; no_claim=that the runner kills the process group (runCursorWikiUpdate tests); seam=a Cursor agent that ends when its signal aborts
test('Cancel in the notification of a Cursor generation aborts the agent, tells the cancellation, records it and removes the marker', async (context) => {
  // Arrange
  const cancellable: CancellableProgress[] = []
  let agentSignal: AbortSignal | undefined
  const project = await openProjectWithoutWiki({
    cursor: true,
    cancellable,
    cursorAgent: (_root, _prompt, signal) =>
      new Promise<string>((_resolveAgent, rejectAgent) => {
        agentSignal = signal
        signal?.addEventListener(
          'abort',
          () => rejectAgent(new Error('The Wiki generation was cancelled.')),
          { once: true },
        )
      }),
  })
  context.after(() => project.close())
  const generating = project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => cancellable.length > 0,
    'the progress notification',
    6_000,
  )
  const markerWhileRunning = await exists(project.markerPath)

  // Act
  cancellable[0]?.cancel()
  await generating
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      markerWhileRunning,
      agentWasAborted: agentSignal?.aborted,
      notices: project.notices.map((notice) =>
        notice.replace(/at \d{1,2}:\d{2}(?: [AP]M)?/, 'at HH:MM'),
      ),
      recordedEnds: project.outputLines.map(
        (line) => /end=(\S+)/.exec(line)?.[1],
      ),
    },
    {
      markerWhileRunning: true,
      agentWasAborted: true,
      notices: [
        'LLM Wiki generation cancelled at HH:MM. Cursor Agent was stopped; nothing was published.',
      ],
      recordedEnds: ['cancelled'],
    },
  )
})

// Value: protects=Cycle 0056 task 5, the 55 minute bound of a Cursor generation; fails_when=the agent is given another bound, or its bound error does not end the generation as timed out with the bound sentence and Generate LLM Wiki, or the marker stays; no_claim=that the runner times out after the bound (runCursorWikiUpdate tests); seam=a Cursor agent that spends the bound it is handed on a test clock and then throws the runner's timeout error
test('a Cursor generation whose agent reaches the 55 minute bound ends as timed out with the bound sentence and removes its marker', async (context) => {
  // Arrange: the test clock lets the agent spend its whole bound at once.
  const clock = { spentMs: 0 }
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorAgent: async (_root, _prompt, _signal, timeoutMs = 0) => {
      clock.spentMs += timeoutMs
      throw new WikiUpdateTimeoutError('The Wiki generation timed out.')
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      spentMs: clock.spentMs,
      errors: project.errors,
      offered: project.offeredActions.map(({ actions }) => actions),
      recordedEnds: project.outputLines.map(
        (line) => /end=(\S+)/.exec(line)?.[1],
      ),
    },
    {
      spentMs: 3_300_000,
      errors: [
        'Codebook stopped waiting for the LLM Wiki generation after 55 minutes. Cursor Agent was stopped; nothing was published.',
      ],
      offered: [['Generate LLM Wiki']],
      recordedEnds: ['timed-out'],
    },
  )
})

// Value: protects=Cycle 0056 task 11, a start that is refused after its claim while the system refuses the marker's removal once; fails_when=the first failed removal is the last, so the marker stands until its bound and blocks every window; no_claim=the retry's timing in production (the constant is shortened here); seam=a removal that throws EBUSY once and a retry delay of 20 ms
test('a start refused after its claim removes its marker on the retry when the first removal fails', async (context) => {
  // Arrange: a learner's own skill is in the way, and the first removal of the marker throws EBUSY.
  const project = await openProjectWithoutWiki({
    cursor: true,
    markerReleaseFailures: 1,
    constants: { WIKI_UPDATE_MARKER_CHANGE_RETRY_DELAY_MS: 20 },
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.markerChanges.at(1)?.answer !== undefined,
    'the retry’s answer',
    3_000,
  )

  // Assert
  assert.deepEqual(
    {
      changes: project.markerChanges.map((change) => [
        change.kind,
        change.answer,
      ]),
      markerLeft: await exists(project.markerPath),
    },
    {
      changes: [
        ['release', 'threw'],
        ['release', true],
      ],
      markerLeft: false,
    },
  )
})

// Value: protects=Cycle 0056 task 12 for a generation, the reservation of another window's stopped watch that Generate anyway took over, and its run kind (pass 1 SM6); fails_when=a Cursor skill conflict removes the marker, so the reservation's protection is gone while that chat may still publish, or the written-back generation loses its generate kind and so its 55 minute bound; no_claim=the bound the written-back reservation keeps (readLiveWikiUpdateMarker tests); seam=a reservation written by hand and the skill steps stubbed
test('a skill conflict after Generate anyway writes the taken-over reservation back with its watch end', async (context) => {
  // Arrange: another window's generation stopped watching a moment ago; the learner presses Generate anyway.
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitUntil(
    () => project.errors.length > 1,
    'the skill conflict’s notice',
    6_000,
  )
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      conflictTold: project.errors[1],
      reservationEndsAt: marker?.watchEndedAtMs,
      reservationRunKind: marker?.runKind,
    },
    {
      conflictTold:
        'Codebook did not start the LLM Wiki generation: A Cursor skill named codebook that Codebook does not own is in the way.',
      reservationEndsAt: watchEndedAtMs,
      reservationRunKind: 'generate',
    },
  )
})

// Value: protects=Cycle 0056 M1, the protection of a reservation written back after a refused start; fails_when=the second press of Generate anyway releases the written-back reservation because this window no longer knows it, so the chat that may still publish loses its marker; no_claim=the first write-back (test above); seam=a reservation written by hand and the skill steps stubbed
test('a second Generate anyway that meets the skill conflict again keeps the written-back reservation with its original end', async (context) => {
  // Arrange: another window's generation stopped watching a moment ago; the skill is in the way both times.
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )
  await project.runCommand(GENERATE_COMMAND)
  await waitForWriteBack(project)

  // Act: the press meets the conflict again and its command rejects with it.
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.errors.length > 2,
    'the second skill conflict’s notice',
    6_000,
  )
  await flushQueuedReactions()
  await waitUntil(
    () => project.markerChanges.filter((change) => change.answer).length >= 2,
    'the second write-back',
    6_000,
  )

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      reservationEndsAt: marker?.watchEndedAtMs,
      changes: project.markerChanges.map((change) => change.kind),
    },
    { reservationEndsAt: watchEndedAtMs, changes: ['reserve', 'reserve'] },
  )
})

// Value: protects=Cycle 0056 M1, the bound of a written-back reservation; fails_when=a reservation written back after a refused start is never removed at its bound, so it blocks every other window until the marker's own expiry; no_claim=the bound of a reservation the run left itself (marker bookkeeping tests); seam=the watch bound shortened to 600 ms and a reservation that ended 400 ms ago
test('a reservation written back after a skill conflict is removed at its watch bound', async (context) => {
  // Arrange: the other window's watch ended 400 ms ago and this window's bound is 600 ms.
  const watchEndedAtMs = Date.now() - 400
  const project = await openProjectWithoutWiki({
    cursor: true,
    constants: { WIKI_UPDATE_WATCH_TIMEOUT_MS: 600 },
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
    'update',
  )

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitForWriteBack(project)
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the removal at the bound',
    6_000,
  )

  // Assert
  assert.equal(await exists(project.markerPath), false)
})

// Value: protects=Cycle 0056 CR1, the kind of a taken-over reservation; fails_when=an update's reservation taken over by Generate anyway is written back as a generation's (a runKind of generate and so the generation's longer bound), or an update's reservation gets a runKind field its format never had; no_claim=a generation's reservation written back (test above); seam=an update's reservation written by hand and the skill steps stubbed
test('an update’s reservation taken over by Generate anyway is written back as an update’s, without a run kind', async (context) => {
  // Arrange
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
    'update',
  )

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      reservationEndsAt: marker?.watchEndedAtMs,
      hasRunKind: 'runKind' in (marker ?? {}),
    },
    { reservationEndsAt: watchEndedAtMs, hasRunKind: false },
  )
})

// Value: protects=Cycle 0056 L1, the reservation a claim takes over; fails_when=the written-back end is the one read before the claim although another window replaced the reservation meanwhile; no_claim=a marker nobody replaced (tests above); seam=the claim held before it begins while the other window writes a later reservation
test('a reservation another window writes between the start’s look and its claim is the one written back after a skill conflict', async (context) => {
  // Arrange: the first reservation ended long ago; a later one replaces it while the start waits to claim.
  const firstEndedAtMs = Date.now() - 4_000
  const laterEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    firstEndedAtMs,
  )
  const claimStart = project.hold('claim-start')

  // Act
  const pressing = project.runCommand(GENERATE_COMMAND)
  await claimStart.started
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    laterEndedAtMs,
  )
  claimStart.release()
  await pressing
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.equal(marker?.watchEndedAtMs, laterEndedAtMs)
})

// Value: protects=Cycle 0056 task 12 for an update, the same reservation taken over by Update anyway; fails_when=the refused update removes the marker instead of writing the reservation back; no_claim=a reservation of this window's own stopped watch (the marker bookkeeping tests); seam=a reservation written by hand and the skill steps stubbed
test('a skill conflict after Update anyway writes the taken-over reservation back with its watch end', async (context) => {
  // Arrange: a Wiki stands, and another window's generation stopped watching a moment ago.
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Update anyway') ? 'Update anyway' : undefined,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill was changed.')
      },
      deploy: async () => {
        throw new Error(
          'A Cursor skill named codebook that Codebook does not own is in the way.',
        )
      },
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  // The Wiki was published before the watch ended, so that chat is still waited for.
  const publishedAt = new Date(watchEndedAtMs - 10_000)
  await utimes(
    join(project.outputDirectory, 'codebook-wiki.json'),
    publishedAt,
    publishedAt,
  )
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )

  // Act
  await project.runUpdateCommand()
  await waitUntil(
    () => project.errors.length > 1,
    'the skill conflict’s notice',
    6_000,
  )
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      conflictTold: project.errors.at(-1),
      reservationEndsAt: marker?.watchEndedAtMs,
    },
    {
      conflictTold:
        'Codebook could not start the Wiki update: A Cursor skill named codebook that Codebook does not own is in the way.',
      reservationEndsAt: watchEndedAtMs,
    },
  )
})

// Value: protects=Cycle 0056 task 13, Stop LLM Wiki Run during the Cursor skill step of a generation; fails_when=Stop only says the run is starting while the step goes on with the marker claimed, or the start ends without the stop sentence, or an agent starts; no_claim=the skill file a step wrote before the stop (it stays, and the managed skill is then current); seam=a verify step that never settles
test('Stop LLM Wiki Run during a generation’s Cursor skill step ends the start with the stop sentence, releases the marker and starts no agent', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())
  const generating = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('verify'),
    'the skill step',
    6_000,
  )
  const markerWhileReadying = await exists(project.markerPath)

  // Act
  await project.runCommand(CANCEL_COMMAND)
  await generating
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      markerWhileReadying,
      errors: project.errors.map(withoutClockTime),
      notices: project.notices,
      agentRuns,
    },
    {
      markerWhileReadying: true,
      errors: [
        'Codebook did not start the LLM Wiki generation: The LLM Wiki generation was cancelled at HH:MM while Codebook readied the Cursor skill; no agent was started.',
      ],
      notices: [],
      agentRuns: 0,
    },
  )
})

// Value: protects=Cycle 0056 task 13 for an update; fails_when=Stop during the skill step of an update names a generation, leaves the marker or starts the agent; no_claim=the generation's wording (test above); seam=a verify step that never settles
test('Stop LLM Wiki Run during an update’s Cursor skill step ends the start with the stop sentence for an update and releases the marker', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Done.'
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  const updating = project.runUpdateCommand().catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('verify'),
    'the skill step',
    6_000,
  )

  // Act
  await project.runCommand(CANCEL_COMMAND)
  await updating
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    { errors: project.errors.map(withoutClockTime), agentRuns },
    {
      errors: [
        'Codebook could not start the Wiki update: The LLM Wiki update was cancelled at HH:MM while Codebook readied the Cursor skill; no agent was started.',
      ],
      agentRuns: 0,
    },
  )
})

// Value: protects=Cycle 0056 task 13, the bound of the Cursor skill step; fails_when=a skill step that never settles holds the marker and the start for ever, or the sentence names no bound and no next step; no_claim=the production bound of 30 seconds (the constant test and the sentence unit test); seam=a verify step that never settles and a bound shortened to one second
test('a generation whose Cursor skill step passes its bound ends the start with the bound sentence, releases the marker and starts no agent', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    constants: { WIKI_SKILL_STEP_TIMEOUT_MS: 1_000 },
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    { errors: project.errors, agentRuns },
    {
      errors: [
        'Codebook did not start the LLM Wiki generation: Codebook stopped readying the Cursor skill after 1 second; no agent was started. Press Generate LLM Wiki again, or run Codebook: Set Up AI Chat.',
      ],
      agentRuns: 0,
    },
  )
})

// Value: protects=Cycle 0056 task 13, a deploy that settles after the stop; fails_when=its late result starts the agent, shows a second notice or leaves the marker; no_claim=the skill file the deploy wrote (it stays); seam=a deploy the test settles after the stop
test('a Cursor skill deploy that settles after Stop LLM Wiki Run starts no agent and tells nothing more', async (context) => {
  // Arrange
  let agentRuns = 0
  let settleDeploy = (): void => {}
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill is missing.')
      },
      deploy: () =>
        new Promise<void>((resolveDeploy) => {
          settleDeploy = resolveDeploy
        }),
    },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())
  const generating = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('deploy'),
    'the deploy step',
    6_000,
  )
  await project.runCommand(CANCEL_COMMAND)
  await generating

  // Act
  settleDeploy()
  await flushQueuedReactions()

  // Assert
  assert.deepEqual(
    {
      skillCalls: project.skillCalls,
      errors: project.errors.length,
      agentRuns,
      markerLeft: await exists(project.markerPath),
    },
    {
      skillCalls: ['verify', 'deploy'],
      errors: 1,
      agentRuns: 0,
      markerLeft: false,
    },
  )
})

// Value: protects=Cycle 0056 task 13, a verify that fails after the stop; fails_when=the late failure goes on to deploy a skill the learner stopped waiting for; no_claim=a deploy that was already under way (test above); seam=a verify the test fails after the stop
test('a Cursor skill verify that fails after Stop LLM Wiki Run does not go on to deploy', async (context) => {
  // Arrange
  let failVerify = (): void => {}
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: () =>
        new Promise<never>((_resolveVerify, rejectVerify) => {
          failVerify = (): void =>
            rejectVerify(new Error('The managed Cursor skill is missing.'))
        }),
    },
  })
  context.after(() => project.close())
  const generating = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('verify'),
    'the skill step',
    6_000,
  )
  await project.runCommand(CANCEL_COMMAND)
  await generating

  // Act
  failVerify()
  await flushQueuedReactions()

  // Assert
  assert.deepEqual(project.skillCalls, ['verify'])
})

// Value: protects=Cycle 0056 L3, one deploy of the managed Cursor skill at a time; fails_when=a press after Stop starts another verify and deploy while the stopped step's deploy still writes the skill; no_claim=the stopped step's own end (tests above); seam=a deploy the test settles
test('a Generate pressed after Stop waits for the stopped deploy to settle, so two deploys never run at once', async (context) => {
  // Arrange
  let runningDeploys = 0
  let mostRunningDeploys = 0
  const settleDeploys: Array<() => void> = []
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill is missing.')
      },
      deploy: () =>
        new Promise<void>((resolveDeploy) => {
          runningDeploys += 1
          mostRunningDeploys = Math.max(mostRunningDeploys, runningDeploys)
          settleDeploys.push(() => {
            runningDeploys -= 1
            resolveDeploy()
          })
        }),
    },
    cursorAgent: async () => 'Published.',
  })
  context.after(() => project.close())
  const firstPress = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('deploy'),
    'the first deploy',
    6_000,
  )
  await project.runCommand(CANCEL_COMMAND)
  await firstPress

  // Act: the second press starts while the first deploy has not settled.
  const secondPress = project
    .runCommand(GENERATE_COMMAND)
    .catch(() => undefined)
  await flushQueuedReactions()
  await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  const callsWhileFirstSettles = [...project.skillCalls]
  settleDeploys[0]?.()
  await waitUntil(() => settleDeploys.length === 2, 'the second deploy', 6_000)
  await project.runCommand(CANCEL_COMMAND)
  await secondPress
  settleDeploys[1]?.()

  // Assert
  assert.deepEqual(
    { callsWhileFirstSettles, mostRunningDeploys },
    { callsWhileFirstSettles: ['verify', 'deploy'], mostRunningDeploys: 1 },
  )
})

/** Stubs of the managed Cursor skill whose verify and deploy both refuse, as a skill of the learner's own in the way does. */
const SKILL_IN_THE_WAY = {
  verify: async (): Promise<void> => {
    throw new Error('The managed Cursor skill was changed.')
  },
  deploy: async (): Promise<void> => {
    throw new Error(
      'A Cursor skill named codebook that Codebook does not own is in the way.',
    )
  },
}

// Value: protects=Cycle 0056 pass 1 RT1, the owner of a taken-over reservation that is written back; fails_when=a VS Code window's reservation taken over by a Cursor start is written back as the Cursor start's own (host cursor, this window), so the VS Code watch bound no longer applies to it and it can block every window as long as the Cursor process lives; no_claim=the bound's removal (test below); seam=a reservation written by hand and the skill steps stubbed
test('a VS Code reservation taken over by a Cursor start and written back after a skill conflict stays that VS Code window’s', async (context) => {
  // Arrange
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
    cursorSkill: SKILL_IN_THE_WAY,
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )

  // Act
  await project.runCommand(GENERATE_COMMAND)
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      host: marker?.host,
      windowId: marker?.windowId,
      pid: marker?.pid,
      startedAtMs: marker?.startedAtMs,
      watchEndedAtMs: marker?.watchEndedAtMs,
    },
    {
      host: 'vscode',
      windowId: 'the-other-window',
      pid: process.pid,
      startedAtMs: watchEndedAtMs - 60_000,
      watchEndedAtMs,
    },
  )
})

// Value: protects=Cycle 0056 pass 1 SM1 and T2, the closing window's write-back of an update's taken-over reservation; fails_when=a window that begins to close during an Update anyway's claim removes the other window's reservation instead of writing it back, or writes it back as its own; no_claim=the skill step's stop at the close (test below); seam=the claim held open while the window closes
test('Update anyway over another window’s reservation, with this window closing during the claim, writes the reservation back as it was', async (context) => {
  // Arrange
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Update anyway') ? 'Update anyway' : undefined,
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  const publishedAt = new Date(watchEndedAtMs - 10_000)
  await utimes(
    join(project.outputDirectory, 'codebook-wiki.json'),
    publishedAt,
    publishedAt,
  )
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )
  const claimAnswer = project.hold('claim-answer')
  const updating = project.runUpdateCommand().catch(() => undefined)
  await claimAnswer.started

  // Act: the window closes while the claim has answered and the start has not read the answer.
  await project.closeWindow()
  claimAnswer.release()
  await updating
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      host: marker?.host,
      windowId: marker?.windowId,
      watchEndedAtMs: marker?.watchEndedAtMs,
      hasRunKind: 'runKind' in (marker ?? {}),
    },
    {
      host: 'vscode',
      windowId: 'the-other-window',
      watchEndedAtMs,
      hasRunKind: true,
    },
  )
})

// Value: protects=Cycle 0056 pass 1 SM2 and T2, the closing window's write-back of a generation's taken-over reservation; fails_when=a window that begins to close during a Generate anyway's claim removes the other window's reservation, or writes it back without its generation kind; no_claim=the skill step's stop at the close (test below); seam=the claim held open while the window closes
test('Generate anyway over another window’s reservation, with this window closing during the claim, writes the reservation back as it was', async (context) => {
  // Arrange
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Generate anyway') ? 'Generate anyway' : undefined,
  })
  context.after(() => project.close())
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )
  const claimAnswer = project.hold('claim-answer')
  const generating = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await claimAnswer.started

  // Act
  await project.closeWindow()
  claimAnswer.release()
  await generating
  await waitForWriteBack(project)

  // Assert
  const marker = await readMarker(project.markerPath)
  assert.deepEqual(
    {
      host: marker?.host,
      windowId: marker?.windowId,
      watchEndedAtMs: marker?.watchEndedAtMs,
      runKind: marker?.runKind,
    },
    {
      host: 'vscode',
      windowId: 'the-other-window',
      watchEndedAtMs,
      runKind: 'generate',
    },
  )
})

// Value: protects=Cycle 0056 pass 1 RT2, a window that closes during the Cursor skill step; fails_when=the closing window leaves the start's claimed marker in place until its bound although no run exists, so every other window is refused for up to 55 minutes; no_claim=the reservation's later removal at the bound (test above); seam=a verify step that never settles
test('a window that closes during a generation’s Cursor skill step ends the step, removes the marker and starts no agent', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())
  const generating = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('verify'),
    'the skill step',
    6_000,
  )
  const markerWhileReadying = await exists(project.markerPath)

  // Act: the marker is read the moment the window's shutdown is done, not when the step's bound would have ended it.
  await project.closeWindow()
  const markerLeft = await exists(project.markerPath)
  await generating

  // Assert
  assert.deepEqual(
    {
      markerWhileReadying,
      markerLeft,
      agentRuns,
    },
    { markerWhileReadying: true, markerLeft: false, agentRuns: 0 },
  )
})

// Value: protects=Cycle 0056 pass 1 RT2 for an update that took a reservation over; fails_when=a window that closes during the skill step of an Update anyway leaves the start's marker claimed, or the cleanup of the refused start runs after the reservations were dropped and registers one nobody removes; no_claim=the generation's wording (test above); seam=a verify step that never settles
test('a window that closes during an update’s Cursor skill step after Update anyway leaves no marker of this start', async (context) => {
  // Arrange
  let agentRuns = 0
  const watchEndedAtMs = Date.now() - 1_000
  const project = await openProjectWithoutWiki({
    cursor: true,
    chooseAction: (_message, actions) =>
      actions.includes('Update anyway') ? 'Update anyway' : undefined,
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Done.'
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)
  const publishedAt = new Date(watchEndedAtMs - 10_000)
  await utimes(
    join(project.outputDirectory, 'codebook-wiki.json'),
    publishedAt,
    publishedAt,
  )
  await writeOtherWindowReservation(
    project.projectRoot,
    project.markerPath,
    watchEndedAtMs,
  )
  const updating = project.runUpdateCommand().catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('verify'),
    'the skill step',
    6_000,
  )

  // Act: the marker is read the moment the window's shutdown is done, not when the step's bound would have ended it.
  await project.closeWindow()
  const markerLeft = await exists(project.markerPath)
  await updating

  // Assert
  assert.deepEqual(
    { markerLeft, agentRuns },
    { markerLeft: false, agentRuns: 0 },
  )
})

// Value: protects=Cycle 0056 pass 1 SM3, the bound of the Cursor skill step in an update; fails_when=an update whose skill step passes its bound holds the marker for ever, names a generation or no bound, or starts the agent; no_claim=the generation's bound (test above); seam=a verify step that never settles and a bound shortened to one second
test('an update whose Cursor skill step passes its bound ends the start with the bound sentence for an update, releases the marker and starts no agent', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    constants: { WIKI_SKILL_STEP_TIMEOUT_MS: 1_000 },
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Done.'
    },
  })
  context.after(() => project.close())
  await publishGeneratedWiki(project.outputDirectory, project.projectRoot)

  // Act
  await project.runUpdateCommand().catch(() => undefined)
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    { errors: project.errors, agentRuns },
    {
      errors: [
        'Codebook could not start the Wiki update: Codebook stopped readying the Cursor skill after 1 second; no agent was started. Press Update LLM Wiki again, or run Codebook: Set Up AI Chat.',
      ],
      agentRuns: 0,
    },
  )
})

// Value: protects=Cycle 0056 pass 1 SM4, the bound while the skill's deploy hangs; fails_when=a deploy that never settles holds the start and its marker past the bound, or the bound sentence is not told; no_claim=a verify that hangs (test above); seam=a verify that reports a missing skill, a deploy that never settles and a bound shortened to one second
test('a generation whose Cursor skill deploy never settles ends at the bound with the bound sentence, releases the marker and starts no agent', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    constants: { WIKI_SKILL_STEP_TIMEOUT_MS: 1_000 },
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill is missing.')
      },
      deploy: () => new Promise<void>(() => {}),
    },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    { errors: project.errors, skillCalls: project.skillCalls, agentRuns },
    {
      errors: [
        'Codebook did not start the LLM Wiki generation: Codebook stopped readying the Cursor skill after 1 second; no agent was started. Press Generate LLM Wiki again, or run Codebook: Set Up AI Chat.',
      ],
      skillCalls: ['verify', 'deploy'],
      agentRuns: 0,
    },
  )
})

// Value: protects=Cycle 0056 pass 1 SM5, a press while an earlier stopped verify still hangs; fails_when=the second step does not wait for the hung verify (a second verify starts) or its own Stop does not end it with the stop sentence and a removed marker; no_claim=an earlier deploy (L3 test); seam=a verify that never settles
test('a Generate pressed while a stopped step’s verify still hangs waits for it and ends with its own Stop', async (context) => {
  // Arrange
  const project = await openProjectWithoutWiki({
    cursor: true,
    cursorSkill: { verify: () => new Promise<never>(() => {}) },
  })
  context.after(() => project.close())
  const firstPress = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('verify'),
    'the first verify',
    6_000,
  )
  await project.runCommand(CANCEL_COMMAND)
  await firstPress
  const secondPress = project
    .runCommand(GENERATE_COMMAND)
    .catch(() => undefined)
  await waitUntil(
    async () => await exists(project.markerPath),
    'the second start’s claim',
    6_000,
  )

  // Act: a Stop before the second step began only says the run is starting, so it is pressed until the step ends.
  await waitUntil(
    async () => {
      await project.runCommand(CANCEL_COMMAND)
      return project.errors.length >= 2
    },
    'the second step’s stop sentence',
    6_000,
  )
  await secondPress
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      skillCalls: project.skillCalls,
      errors: project.errors.map(withoutClockTime),
    },
    {
      skillCalls: ['verify'],
      errors: [
        'Codebook did not start the LLM Wiki generation: The LLM Wiki generation was cancelled at HH:MM while Codebook readied the Cursor skill; no agent was started.',
        'Codebook did not start the LLM Wiki generation: The LLM Wiki generation was cancelled at HH:MM while Codebook readied the Cursor skill; no agent was started.',
      ],
    },
  )
})

// Value: protects=Cycle 0056 pass 1 T1, the bound firing while an earlier stopped deploy still hangs; fails_when=the second start waits for the hung deploy past its own bound, or leaves its marker, or starts an agent; no_claim=a Stop of the second step (test above); seam=a deploy that never settles and a bound shortened to one second
test('a Generate pressed after a stopped step whose deploy still hangs ends at its own bound with the bound sentence and releases the marker', async (context) => {
  // Arrange
  let agentRuns = 0
  const project = await openProjectWithoutWiki({
    cursor: true,
    constants: { WIKI_SKILL_STEP_TIMEOUT_MS: 1_000 },
    cursorSkill: {
      verify: async () => {
        throw new Error('The managed Cursor skill is missing.')
      },
      deploy: () => new Promise<void>(() => {}),
    },
    cursorAgent: async () => {
      agentRuns += 1
      return 'Published.'
    },
  })
  context.after(() => project.close())
  const firstPress = project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    () => project.skillCalls.includes('deploy'),
    'the first deploy',
    6_000,
  )
  await project.runCommand(CANCEL_COMMAND)
  await firstPress

  // Act
  await project.runCommand(GENERATE_COMMAND).catch(() => undefined)
  await waitUntil(
    async () => !(await exists(project.markerPath)),
    'the marker’s removal',
    6_000,
  )

  // Assert
  assert.deepEqual(
    {
      skillCalls: project.skillCalls,
      lastError: project.errors.at(-1),
      agentRuns,
    },
    {
      skillCalls: ['verify', 'deploy'],
      lastError:
        'Codebook did not start the LLM Wiki generation: Codebook stopped readying the Cursor skill after 1 second; no agent was started. Press Generate LLM Wiki again, or run Codebook: Set Up AI Chat.',
      agentRuns: 0,
    },
  )
})
