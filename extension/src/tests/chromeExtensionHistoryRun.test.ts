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
  capturedStop,
  EXTENSION_WORKSPACE_KEY,
  extensionHistoryHeader,
  pngOf,
} from './utils/chromeExtensionHistoryFixture'
import {
  createRunHarness,
  type HarnessBehaviour,
} from './utils/chromeExtensionRunHarness'
import { openServerRepository } from './utils/nodeServerHistoryFixture'

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

/** Opens a declared, captured pause the way the debugger does and returns its continue arguments. */
function openCapturedPause(
  harness: ReturnType<typeof createRunHarness>,
  stopIndex: number,
  context: 'page' | 'service-worker',
) {
  harness.pauses.open({
    sessionId: `session-${context}`,
    threadId: 1,
    context,
    reason: 'breakpoint',
    kind: 'declared',
    stopIndex,
    status: 'captured',
    captured: capturedStop({ stopIndex, context }),
    pausedAtMs: 0,
  })
  const pause = harness.run.view().pauses.at(-1)
  assert.ok(pause?.continueArguments)
  return pause.continueArguments
}

/** Drives a run through a page stop, a service-worker stop and the last click to its end; returns what the live run showed. */
async function driveRun(harness: ReturnType<typeof createRunHarness>) {
  await harness.run.prepare()
  await harness.run.click()
  await harness.run.continue(openCapturedPause(harness, 1, 'page'))
  await harness.run.continue(openCapturedPause(harness, 2, 'service-worker'))
  // Both declared stops were reached.
  harness.debuggerState.notReached = []
  await harness.run.click()
  await waitUntil(
    () => ['completed', 'failed'].includes(harness.run.view().phase),
    'the run to end',
  )
  const view = harness.run.view()
  await harness.run.stop()
  return {
    phase: view.phase,
    result: view.result,
    captures: view.captures.length,
    changed: view.observed?.changed,
  }
}

// protects=a live run with a recording history journals each declared stop as it pauses, captures and continues, and the observed result, hands the Application view the frame observer, and the history seals complete; fails_when=a pause, capture, continue or result is not told to the history, or the viewport gets no observer; no_claim=a real Chrome, debugger or viewport (all fakes)
test('a run records a page stop, a service-worker stop and the result into a complete history', async (context) => {
  // Arrange
  const { repository, kept, beginHistory } = await recordingOver(context)
  const harness = createRunHarness({ beginHistory })

  // Act
  const live = await driveRun(harness)
  const observer = harness.viewportObserver.current
  assert.ok(observer)
  observer.frame({
    data: pngOf(720, 640, 'popup').toString('base64'),
    elapsedMs: observer.elapsedMs(),
    kind: 'stream',
  })
  assert.ok(kept.recorder)
  await kept.recorder.seal({ observed: harness.run.view().observed }, 5_000)
  const history = await repository.extensionHistories.read(
    kept.recorder.writer.header.studyId,
  )

  // Assert
  assert.deepEqual(live, {
    phase: 'completed',
    result: 'complete',
    captures: 2,
    changed: false,
  })
  assert.equal(history.status, 'complete')
  assert.deepEqual(
    history.entries
      .filter((entry) => entry.type !== 'frame')
      .map((entry) => entry.type),
    [
      'pause-open',
      'capture',
      'pause-close',
      'pause-open',
      'capture',
      'pause-close',
      'result',
    ],
  )
  const opens = history.entries.filter((entry) => entry.type === 'pause-open')
  assert.deepEqual(
    opens.map((entry) => [
      entry.pauseId.startsWith('run-1:'),
      entry.context,
      entry.stopIndex,
    ]),
    [
      [true, 'page', 1],
      [true, 'service-worker', 2],
    ],
  )
  assert.equal(history.header.extension.version, '1.0.0')
  assert.equal(history.header.chrome.version, 'Google Chrome 156.0.8078.74')
})

// protects=recording never changes what the live run does or shows: against a writer that never finishes an append, the run's phase, result, captures and observation equal those of the same run with no history; fails_when=a stalled history changes any of them or holds a click, continue or stop; no_claim=timing on a real disk
test('a run records through a writer that never finishes and shows exactly what the unrecorded run shows', async () => {
  // Arrange
  class StalledWriter extends ChromeExtensionHistoryWriter {
    protected override append(): Promise<void> {
      return new Promise<void>(() => undefined)
    }
  }
  const directory = await mkdtemp(
    join(tmpdir(), 'codebook-extension-run-stalled-'),
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

  // Act
  const unrecorded = await driveRun(createRunHarness())
  const recorded = await driveRun(
    createRunHarness({ beginHistory: stalledHistory }),
  )

  // Assert
  assert.deepEqual(recorded, unrecorded)
})

// protects=a history that cannot start (it refuses, or it throws) leaves the run going unrecorded with the same end; fails_when=the run fails, waits or changes its result; no_claim=the wording of the cause (the service test reads it)
test('a run whose history refuses to start or throws goes on unrecorded', async () => {
  // Arrange
  const refusing = createRunHarness({ beginHistory: async () => undefined })
  const throwing = createRunHarness({
    beginHistory: async () => {
      throw new Error('storage exploded')
    },
  })

  // Act
  const refused = await driveRun(refusing)
  const thrown = await driveRun(throwing)

  // Assert
  assert.deepEqual(refused, thrown)
  assert.equal(refused.phase, 'completed')
})

// protects=a test browser that dies while a stop is paused seals the history partial naming the surface end, with the open pause closed as surface-lost and everything recorded replayable; fails_when=the seal is complete, the surface end is not named or the pause stays open; no_claim=the real CDP socket close
test('a browser lost at a paused stop seals the history partial naming the surface end', async (context) => {
  // Arrange
  const { repository, kept, beginHistory } = await recordingOver(context)
  const harness = createRunHarness({ beginHistory })
  await harness.run.prepare()
  await harness.run.click()
  openCapturedPause(harness, 1, 'page')

  // Act
  harness.loseBrowser()
  await waitUntil(
    () => harness.run.view().phase === 'failed',
    'the run to fail',
  )
  await harness.run.stop()
  assert.ok(kept.recorder)
  await kept.recorder.seal(
    { failureCode: harness.run.view().runFailure?.code },
    5_000,
  )
  const history = await repository.extensionHistories.read(
    kept.recorder.writer.header.studyId,
  )

  // Assert
  assert.equal(history.status, 'partial')
  assert.ok(
    history.seal?.reasons.some(
      (reason) => reason.code === 'EXTENSION_HISTORY_SURFACE_ENDED',
    ),
  )
  const close = history.entries.find((entry) => entry.type === 'pause-close')
  assert.equal(close?.type === 'pause-close' && close.reason, 'surface-lost')
  assert.equal(
    history.entries.filter((entry) => entry.type === 'capture').length,
    1,
  )
})
