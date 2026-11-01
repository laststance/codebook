import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { ChromeExtensionHistoryRecorder } from '../chromeExtensionHistoryRecorder'
import { parseExtensionHistoryHeader } from '../chromeExtensionHistorySchemas'
import { ChromeExtensionHistoryWriter } from '../chromeExtensionHistoryWriter'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { startChromeExtensionHistory } from '../utils/startChromeExtensionHistory'

import {
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'
import {
  createRunHarness,
  manualClock,
  type HarnessBehaviour,
} from './utils/chromeExtensionRunHarness'
import { openServerRepository } from './utils/nodeServerHistoryFixture'

const PAUSED_FRAME = pngOf(720, 640, 'paused').toString('base64')

/** A `beginHistory` that starts a real history on a real repository and keeps the recorder. */
async function recordingOver(
  context: Parameters<typeof openServerRepository>[0],
) {
  const { repository } = await openServerRepository(context)
  const kept: { recorder?: ChromeExtensionHistoryRecorder } = {}
  const beginHistory: HarnessBehaviour['beginHistory'] = async (identity) => {
    const begun = await startChromeExtensionHistory({
      repository,
      workspace: tmpdir(),
      instanceId: '11111111-1111-4111-8111-111111111111',
      runId: '22222222-2222-4222-8222-222222222222',
      createdAtMs: Date.UTC(2026, 10, 1),
      identity,
      describeCause: String,
    })
    if ('recorder' in begun) kept.recorder = begun.recorder
    return 'recorder' in begun ? begun.recorder : undefined
  }
  return { repository, kept, beginHistory }
}

/** The pinned pause frames a sealed history holds, by the pause they name. */
async function pinsOf(
  repository: Awaited<ReturnType<typeof recordingOver>>['repository'],
  recorder: ChromeExtensionHistoryRecorder,
) {
  const history = await repository.extensionHistories.read(
    recorder.writer.header.studyId,
  )
  return {
    history,
    pins: history.entries.flatMap((entry) =>
      entry.type === 'frame' && entry.kind === 'pin' ? [entry.pauseId] : [],
    ),
  }
}

// protects=E-B: the screenshot the live run pins at a declared pause reaches the history as that pause's pin frame; fails_when=the run keeps the screenshot to its view only, or the pin names another pause; no_claim=a real Chrome screenshot (a fake answers)
test('a run hands the pinned pause screenshot to its history as the pin of that pause', async (context) => {
  // Arrange
  const { repository, kept, beginHistory } = await recordingOver(context)
  const harness = createRunHarness({
    beginHistory,
    surfaceAnswers: {
      'Page.captureScreenshot': () => ({ data: PAUSED_FRAME }),
    },
  })
  await harness.run.prepare()

  // Act
  harness.openDeclaredPause(1, 'page')
  await waitUntil(
    () => harness.viewportCalls.some(([name]) => name === 'pinPause'),
    'the paused frame to be pinned',
  )
  await harness.run.stop()
  assert.ok(kept.recorder)
  await kept.recorder.seal({}, 5_000)
  const { pins } = await pinsOf(repository, kept.recorder)

  // Assert
  assert.deepEqual(pins, ['run-1:1:page:1'])
})

// protects=E-B: a stop while the pause screenshot never answers settles at once and the history seals without naming a missing pin, because the live run never captured one; the recorder never waits for the screenshot; fails_when=the stop or the seal waits for the screenshot, or the unpinned pause is named missing; no_claim=the 10 s production stop bound (not reached)
test('a stop while the pause screenshot never answers settles and the history names no missing pinned frame', async (context) => {
  // Arrange
  const { repository, kept, beginHistory } = await recordingOver(context)
  const harness = createRunHarness({
    beginHistory,
    surfaceAnswers: {
      'Page.captureScreenshot': () => new Promise<never>(() => undefined),
    },
  })
  await harness.run.prepare()
  harness.openDeclaredPause(1, 'page')
  await waitUntil(
    () => harness.surface.methods().includes('Page.captureScreenshot'),
    'the pause frame capture was sent',
  )

  // Act
  await harness.run.stop()
  assert.ok(kept.recorder)
  await kept.recorder.seal({}, 5_000)
  const { history, pins } = await pinsOf(repository, kept.recorder)

  // Assert
  assert.deepEqual(pins, [])
  assert.deepEqual(
    history.seal?.reasons
      .filter((reason) => reason.code.endsWith('PINNED_FRAME_MISSING'))
      .map((reason) => reason.params),
    [],
  )
})

// protects=E-B: a screenshot answered after its pause was continued is not recorded as that pause's pin (it would show a later moment); fails_when=the late screenshot becomes the pin; no_claim=the live view (the lifecycle test covers it)
test('a pause screenshot answered after its continue is not recorded as the pin', async (context) => {
  // Arrange
  const { repository, kept, beginHistory } = await recordingOver(context)
  let answer: (value: Record<string, unknown>) => void = () => undefined
  const harness = createRunHarness({
    beginHistory,
    surfaceAnswers: {
      'Page.captureScreenshot': () =>
        new Promise<Record<string, unknown>>((resolve) => {
          answer = resolve
        }),
    },
  })
  await harness.run.prepare()
  const pause = harness.openDeclaredPause(1, 'service-worker')
  await waitUntil(
    () => harness.surface.methods().includes('Page.captureScreenshot'),
    'the pause frame capture was sent',
  )

  // Act
  harness.pauses.close(pause.sessionId, pause.threadId)
  answer({ data: PAUSED_FRAME })
  // gstack-timing-ok: a negative check; a slow runner can only miss a wrong pin, never fail a correct run
  await new Promise((resolve) => setTimeout(resolve, 20))
  await harness.run.stop()
  assert.ok(kept.recorder)
  await kept.recorder.seal({}, 5_000)
  const { pins } = await pinsOf(repository, kept.recorder)

  // Assert
  assert.deepEqual(pins, [])
})

// protects=AC 7d / E-J: with recording on and a writer that never finishes, the run's click and stop add no wait: the same calls in the same order, the same timers armed with the same delays, and no timer fired by hand; fails_when=recording makes the click or stop await the history, arm another timer or change a call; no_claim=a real disk's speed (the writer never answers)
test('a run with a stalled recording clicks and stops with the same calls and timers as an unrecorded run', async () => {
  // Arrange
  class StalledWriter extends ChromeExtensionHistoryWriter {
    protected override append(): Promise<void> {
      return new Promise<void>(() => undefined)
    }
  }
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-extension-run-timing-'),
  )
  const header = parseExtensionHistoryHeader({
    ...extensionHistoryHeader(EXTENSION_WORKSPACE_KEY),
    formatVersion: 1,
  })
  const stalledHistory: HarnessBehaviour['beginHistory'] = async () => {
    const begun = await ChromeExtensionHistoryRecorder.begin({
      start: async () =>
        new StalledWriter(directory, header, () => undefined, String),
      describeCause: String,
      summarize: async () => undefined,
    })
    return 'recorder' in begun ? begun.recorder : undefined
  }

  /** Drives one run with manual timers and reports what it called and armed. */
  const drive = async (beginHistory: HarnessBehaviour['beginHistory']) => {
    const timers = manualClock()
    const harness = createRunHarness({
      clock: timers.clock,
      surfaceAnswers: {
        'Page.captureScreenshot': () => ({ data: PAUSED_FRAME }),
      },
      ...(beginHistory ? { beginHistory } : {}),
    })
    const delays: number[][] = []
    await harness.run.prepare()
    delays.push(timers.pendingDelays())
    await harness.run.click()
    const pause = harness.openDeclaredPause(1, 'page')
    // A resized frame at a high rate, as the screencast delivers them.
    for (let index = 0; index < 40; index += 1)
      harness.viewportObserver.current?.frame({
        data: pngOf(300 + index, 200, 'burst').toString('base64'),
        elapsedMs: 60 * (index + 1),
        kind: 'stream',
      })
    harness.pauses.close(pause.sessionId, pause.threadId)
    await harness.run.click()
    delays.push(timers.pendingDelays())
    await harness.run.stop()
    delays.push(timers.pendingDelays())
    return { log: harness.log, delays }
  }

  // Act
  const unrecorded = await drive(undefined)
  const recorded = await drive(stalledHistory)

  // Assert
  assert.deepEqual(recorded.log, unrecorded.log)
  assert.deepEqual(recorded.delays, unrecorded.delays)
})
