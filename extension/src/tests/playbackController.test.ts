import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { test } from 'node:test'

import * as constants from '../constants'
import {
  PlaybackController,
  type PlaybackBundle,
  type PlaybackData,
  type PlaybackDependencies,
} from '../playbackController'
import type * as PlaybackSchemasModule from '../playbackSchemas'
import type {
  RecordingContext,
  RecordingFrame,
  RecordingIndex,
} from '../recordingSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { createConfiguredStudy } from './utils/createConfiguredStudy'
import { loadModule } from './utils/loadModule'
import { READER_RESULT_BOUND_MS } from './utils/readerResultBound'

/** Supplies deterministic recorded identities to control-concurrency tests, without live browser/debugger effects. @example const data = playbackFixture() */
function playbackFixture(): PlaybackData {
  const instanceId = randomUUID(),
    runId = randomUUID(),
    studyId = `${instanceId}_${runId}`,
    workspaceKey = sha256('workspace')
  const frames: RecordingFrame[] = [0, 50, 100, 200].map(
    (elapsedMs, index) => ({
      type: 'frame',
      sequence: index + 1,
      elapsedMs,
      hash: sha256(`frame-${elapsedMs}`),
      byteLength: 10,
      width: 1,
      height: 1,
      kind: 'stream',
    }),
  )
  const index: RecordingIndex = {
    header: {
      version: 1,
      workspaceKey,
      studyId,
      instanceId,
      runId,
      runtimeId: randomUUID(),
      profile: 'repository-browser',
      sourceBuild: {
        revision: 'test',
        dirty: false,
        sourceHash: sha256('source'),
      },
      createdAt: '2026-09-19T00:00:00.000Z',
      startedMs: 0,
      clock: 'runtime-receipt-ms',
      sampleIntervalMs: 50,
      owner: { pid: process.pid, hostname: 'test', sessionId: randomUUID() },
    },
    entries: [
      ...frames,
      { type: 'end', sequence: 5, elapsedMs: 250, status: 'complete' },
    ],
    status: 'finalized',
    endMs: 250,
    lastVerifiedMs: 250,
  }
  const context: RecordingContext = {
    version: 1,
    workspaceKey,
    studyId,
    historyRevision: 1,
    studyHash: sha256('study'),
    materialSignature: sha256('material'),
    phases: [],
    interpretationAvailability: [],
    study: {
      ...createConfiguredStudy(),
      workspaceKey,
      id: studyId,
      instanceId,
      runId,
      observations: [
        {
          ...createConfiguredStudy().observations[0]!,
          snapshotUri: `codebook://${instanceId}/runs/${runId}/snapshots/browser-session%3A1`,
          elapsedMs: 100,
          interpretations: [],
        },
      ],
    },
  }

  return { index, context, contextHash: sha256(JSON.stringify(context)) }
}

/** Creates observable file/renderer boundaries for playback tests; the shared controller remains the actual implementation. @example const player = playbackHarness() */
function playbackHarness(overrides: Partial<PlaybackDependencies> = {}) {
  const data = playbackFixture(),
    presented: number[] = [],
    saved: number[] = []
  let clock = 0,
    displayed: number | undefined
  const dependencies: PlaybackDependencies = {
    load: async () => data,
    frame: async (_study, hash) => Buffer.from(hash),
    present: async (bundle) => {
      presented.push(bundle.projection.positionMs)
      displayed = bundle.projection.positionMs
    },
    invalidate: () => {
      displayed = undefined
    },
    changed() {},
    save: async (bundle) => {
      saved.push(bundle.projection.positionMs)
    },
    now: () => clock,
    manualTicks: true,
    ...overrides,
  }
  const controller = new PlaybackController(dependencies),
    studyId = data.index.header.studyId
  return {
    data,
    controller,
    presented,
    saved,
    dependencies,
    studyId,
    clock(value: number): void {
      clock = value
    },
    displayed: () => displayed,
    open() {
      return controller.command({
        studyId,
        action: 'open',
        expectedRevision: controller.state().revision,
      })
    },
    seek(positionMs: number) {
      return controller.command({
        studyId,
        action: 'seek',
        positionMs,
        expectedRevision: controller.state().revision,
      })
    },
    play() {
      return controller.command({
        studyId,
        action: 'play',
        expectedRevision: controller.state().revision,
      })
    },
    pause() {
      return controller.command({
        studyId,
        action: 'pause',
        expectedRevision: controller.state().revision,
      })
    },
  }
}

test('opening recorded data is paused and seeking does not expose values before their observed time', async () => {
  // Arrange
  const player = playbackHarness()
  // Act
  player.open()
  await player.controller.settle()
  const start = player.controller.bundle()
  player.seek(100)
  await player.controller.settle()
  // Assert
  assert.equal(start?.projection.observation, undefined)
  assert.equal(player.controller.state().mode, 'paused')
  assert.equal(player.controller.state().presentedMs, 100)
  assert.equal(
    player.controller.bundle()?.projection.observation?.values[
      'value:nextTheme'
    ],
    'dark',
  )
  assert.deepEqual(player.saved, [0, 100])
  await player.controller.dispose()
})

// Value: protects=a driver that rounds a recorded stop's fractional elapsedMs down to whole milliseconds; fails_when=the seek lands 0.02 ms before the stop and presents "Not recorded at this moment" instead of the stop; why_new=seek tests used whole-millisecond stops only (Cycle 0044 row N-12, Cursor check: 122,822 for 122,822.02); seam=none
test('a seek to the whole millisecond just before a recorded stop presents that stop with its values', async () => {
  // Arrange: the stop was recorded at 100.02 ms, paused until 150 ms.
  const player = playbackHarness()
  const context = player.data.context!
  context.study.observations[0]!.elapsedMs = 100.02
  context.pausedIntervals = [
    {
      snapshotId: context.study.observations[0]!.id,
      startMs: 100.02,
      endMs: 150,
    },
  ]
  player.open()
  await player.controller.settle()
  // Act
  player.seek(100)
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().presentedMs, 100.02)
  assert.equal(
    player.controller.bundle()?.projection.observation?.values[
      'value:nextTheme'
    ],
    'dark',
  )
  await player.controller.dispose()
})

test('a seek one millisecond or more before a recorded stop stays where it was asked and shows no stop', async () => {
  // Arrange: the stop was recorded at 100.02 ms.
  const player = playbackHarness()
  player.data.context!.study.observations[0]!.elapsedMs = 100.02
  player.open()
  await player.controller.settle()
  // Act
  player.seek(99)
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().presentedMs, 99)
  assert.equal(player.controller.bundle()?.projection.observation, undefined)
  await player.controller.dispose()
})

test('opening a recording publishes its sealed history gaps without changing the saved playhead', async () => {
  // Arrange
  const player = playbackHarness()
  const context = player.data.context
  assert.ok(context)
  context.pausedIntervals = []
  // Act
  player.open()
  await player.controller.settle()
  // Assert
  assert.deepEqual(player.controller.state().historyTimeline, {
    status: 'mapped',
    gaps: [{ startMs: 0, endMs: 250 }],
    recordedPoints: [],
  })
  assert.equal(player.controller.state().presentedMs, 0)
  await player.controller.dispose()
})

test('a newer seek wins even when the earlier frame read ignores cancellation and finishes late', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let release: () => void = () => undefined,
    entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  player.dependencies.frame = async (_study, hash) => {
    if (hash === sha256('frame-100')) {
      entered()
      await waiting
    }
    return Buffer.from(hash)
  }
  // Act
  player.seek(100)
  await started
  player.seek(200)
  assert.equal(player.controller.state().requestedMs, 200)
  assert.equal(player.controller.state().presentedMs, 0)
  release()
  await player.controller.settle()
  // Assert
  assert.deepEqual(player.presented, [0, 200])
  assert.equal(player.controller.state().presentedMs, 200)
  assert.deepEqual(player.saved, [0, 200])
  await player.controller.dispose()
})

test('Pause during a pending frame read restores and persists the last confirmed position rather than the requested seek', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let release: () => void = () => undefined,
    entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  player.dependencies.frame = async (_study, hash) => {
    entered()
    await waiting
    return Buffer.from(hash)
  }
  // Act
  player.seek(100)
  await started
  player.pause()
  const paused = player.controller.state()
  release()
  await player.controller.settle()
  // Assert
  assert.equal(paused.mode, 'paused')
  assert.equal(paused.requestedMs, 0)
  assert.equal(paused.readiness, 'loading')
  assert.deepEqual(player.presented, [0, 0])
  assert.equal(player.controller.state().presentedMs, 0)
  assert.deepEqual(player.saved, [0, 0])
  await player.controller.dispose()
})

test('Pause clears a decoded but unacknowledged future image and ignores its late paint completion', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let release: () => void = () => undefined,
    entered: () => void = () => undefined,
    visible: number | undefined = 0
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  player.dependencies.invalidate = (): void => {
    visible = undefined
  }
  player.dependencies.present = async (bundle): Promise<void> => {
    visible = bundle.projection.positionMs
    if (visible === 100) {
      entered()
      await waiting
    }
  }
  // Act
  player.seek(100)
  await started
  assert.equal(visible, 100)
  player.pause()
  assert.equal(visible, undefined)
  assert.equal(player.controller.state().presentedMs, 0)
  release()
  await player.controller.settle()
  // Assert
  assert.equal(visible, 0)
  assert.equal(player.controller.state().presentedMs, 0)
  assert.equal(player.controller.bundle()?.projection.observation, undefined)
  assert.deepEqual(player.saved, [0, 0])
  await player.controller.dispose()
})

test('same-study Open and repeated Play preserve the running clock while stale commands change nothing', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  player.play()
  const revision = player.controller.state().revision
  player.clock(50)
  player.controller.tick()
  await player.controller.settle()
  // Act
  player.open()
  player.play()
  player.clock(80)
  player.controller.tick()
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().revision, revision)
  assert.equal(player.controller.state().presentedMs, 80)
  assert.throws(
    () =>
      player.controller.command({
        studyId: player.studyId,
        action: 'pause',
        expectedRevision: 0,
      }),
    /Stale playback revision/,
  )
  assert.equal(player.controller.state().mode, 'playing')
  assert.deepEqual(player.saved, [0])
  await player.controller.dispose()
})

test('playback stops at an observation boundary and excludes the source-loading delay from the film clock', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  player.play()
  let release: () => void = () => undefined,
    entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  const present = player.dependencies.present
  player.dependencies.present = async (bundle, signal): Promise<void> => {
    if (bundle.projection.positionMs === 100) {
      entered()
      await waiting
    }
    await present(bundle, signal)
  }
  // Act
  player.clock(200)
  player.controller.tick()
  await started
  player.clock(500)
  release()
  await player.controller.settle()
  assert.equal(player.controller.state().presentedMs, 100)
  player.clock(550)
  player.controller.tick()
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().presentedMs, 150)
  assert.equal(
    player.controller.bundle()?.projection.observation?.id,
    'browser-session:1',
  )
  assert.equal(player.controller.state().mode, 'playing')
  await player.controller.dispose()
})

test('hiding a replay invalidates its pending frame and a later reveal remains paused at the previous confirmed position', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let release: () => void = () => undefined,
    entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  player.dependencies.frame = async (_study, hash) => {
    entered()
    await waiting
    return Buffer.from(hash)
  }
  // Act
  player.seek(100)
  await started
  player.controller.hide()
  release()
  await player.controller.settle()
  player.controller.reveal()
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().mode, 'paused')
  assert.equal(player.controller.state().presentedMs, 0)
  assert.deepEqual(player.presented, [0, 0])
  await player.controller.dispose()
})

test('the first seek after hiding Application reaches the requested moment when presentation reveals the pane', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  player.controller.hide()
  const present = player.dependencies.present
  let didReveal = false
  player.dependencies.present = async (bundle, signal): Promise<void> => {
    // A native hidden-to-visible notification occurs inside the requested presentation.
    if (!didReveal) {
      didReveal = true
      player.controller.reveal()
    }
    await present(bundle, signal)
  }
  try {
    // Act
    player.seek(100)
    await player.controller.settle()
    // Assert
    assert.equal(player.controller.state().presentedMs, 100)
    assert.equal(player.displayed(), 100)
    assert.equal(
      player.controller.bundle()?.projection.observation?.values[
        'value:nextTheme'
      ],
      'dark',
    )
    assert.equal(player.controller.state().readiness, 'ready')
    assert.deepEqual(player.presented, [0, 100])
    assert.deepEqual(player.saved, [0, 0, 100])
  } finally {
    await player.controller.dispose()
  }
})

test('revealing Application during a delayed seek retains the requested frame instead of restoring the previous moment', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let releaseFrame: () => void = () => undefined
  let notifyFrameStarted: () => void = () => undefined
  const frameWaiting = new Promise<void>((resolve) => {
    releaseFrame = resolve
  })
  const frameStarted = new Promise<void>((resolve) => {
    notifyFrameStarted = resolve
  })
  player.dependencies.frame = async (_studyId, hash) => {
    if (hash === sha256('frame-100')) {
      notifyFrameStarted()
      await frameWaiting
    }
    return Buffer.from(hash)
  }
  try {
    // Act
    player.seek(100)
    await frameStarted
    player.controller.reveal()
    releaseFrame()
    await player.controller.settle()
    // Assert
    assert.equal(player.controller.state().presentedMs, 100)
    assert.equal(player.displayed(), 100)
    assert.equal(
      player.controller.bundle()?.projection.observation?.values[
        'value:nextTheme'
      ],
      'dark',
    )
    assert.equal(player.controller.state().readiness, 'ready')
    assert.deepEqual(player.presented, [0, 100])
    assert.deepEqual(player.saved, [0, 100])
  } finally {
    releaseFrame()
    await player.controller.dispose()
  }
})

test('failed frame reads pause playback and clear misleading pixels without changing the confirmed source bundle', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  player.dependencies.frame = async () => {
    throw new Error('missing recorded frame')
  }
  // Act
  player.seek(100)
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().readiness, 'failed')
  assert.equal(player.controller.state().mode, 'paused')
  assert.equal(player.displayed(), undefined)
  assert.equal(player.controller.state().presentedMs, 0)
  assert.equal(player.controller.bundle()?.projection.observation, undefined)
  assert.match(player.controller.state().reason ?? '', /missing recorded frame/)
  await player.controller.dispose()
})

// Regression: 465 — native App visibility must not retire a failed recording load.
// Found by /qa on 2026-10-11.
// Report: https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/cycles/0046-carried-defects-of-cycle-0045.md
// Value: protects=failed-load diagnostics through App cover/return; fails_when=visibility changes failure to idle or retries without explicit Open; why_new=existing hide cases cover pending/ready frames only; seam=none
test('covering and returning to an unreadable recording keeps its failure until the learner explicitly reloads it', async () => {
  // Arrange
  let loadAttempts = 0
  const player = playbackHarness({
    load: async () => {
      loadAttempts++
      throw new Error('missing saved recording')
    },
  })
  try {
    player.open()
    await player.controller.settle()
    assert.equal(player.controller.state().readiness, 'failed')

    // Act
    player.controller.hide()
    const covered = player.controller.state()
    player.controller.reveal()
    await player.controller.settle()

    // Assert
    assert.equal(covered.readiness, 'failed')
    assert.equal(covered.reason, 'Error: missing saved recording')
    assert.equal(player.controller.state().readiness, 'failed')
    assert.equal(
      player.controller.state().reason,
      'Error: missing saved recording',
    )
    assert.equal(player.displayed(), undefined)
    assert.deepEqual(player.presented, [])
    assert.equal(loadAttempts, 1)

    // An explicit reload can recover after the stored recording becomes readable.
    player.dependencies.load = async () => {
      loadAttempts++
      return player.data
    }
    player.open()
    await player.controller.settle()
    assert.equal(player.controller.state().readiness, 'ready')
    assert.equal(player.controller.state().reason, undefined)
    assert.equal(player.controller.state().presentedMs, 0)
    assert.deepEqual(player.presented, [0])
    assert.equal(loadAttempts, 2)
  } finally {
    await player.controller.dispose()
  }
})

// Regression: 465 — returning to App must not replace a failed seek with its cached old moment.
// Found by /qa on 2026-10-11.
// Report: https://github.com/laststance/codebook/blob/docs-archive-2026-10-20/docs/cycles/0046-carried-defects-of-cycle-0045.md
// Value: protects=failed-seek diagnostics when an older bundle survives; fails_when=hide marks it ready or reveal repaints the cached bundle; why_new=the failed-frame case never changes App visibility; seam=none
test('covering and returning after a recorded frame fails keeps pixels cleared and its error until explicit reload', async () => {
  // Arrange
  const player = playbackHarness(),
    originalFrame = player.dependencies.frame
  try {
    player.open()
    await player.controller.settle()
    player.seek(100)
    await player.controller.settle()
    player.dependencies.frame = async () => {
      throw new Error('missing recorded frame')
    }
    player.seek(200)
    await player.controller.settle()
    assert.equal(player.controller.state().readiness, 'failed')

    // Act
    player.controller.hide()
    const covered = player.controller.state()
    player.controller.reveal()
    await player.controller.settle()

    // Assert
    assert.equal(covered.readiness, 'failed')
    assert.equal(covered.reason, 'Error: missing recorded frame')
    assert.equal(player.controller.state().readiness, 'failed')
    assert.equal(
      player.controller.state().reason,
      'Error: missing recorded frame',
    )
    assert.equal(player.displayed(), undefined)
    assert.equal(player.controller.state().presentedMs, 100)
    assert.deepEqual(player.presented, [0, 100])

    // Explicit reload restores the last confirmed moment without a runtime action.
    player.dependencies.frame = originalFrame
    player.open()
    await player.controller.settle()
    assert.equal(player.controller.state().readiness, 'ready')
    assert.equal(player.controller.state().reason, undefined)
    assert.equal(player.controller.state().presentedMs, 100)
    assert.equal(player.displayed(), 100)
    assert.deepEqual(player.presented, [0, 100, 100])
  } finally {
    await player.controller.dispose()
  }
})

test('end of recording pauses and saves its endpoint without autoplaying when the same study is reopened', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  player.seek(200)
  await player.controller.settle()
  player.play()
  // Act
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()
  player.open()
  player.play()
  // Assert
  assert.equal(player.controller.state().presentedMs, 250)
  assert.equal(player.controller.state().mode, 'paused')
  assert.deepEqual(player.saved, [0, 200, 250])
  await player.controller.dispose()
})

test('switching studies discards an older load without borrowing its source or remembered position', async () => {
  // Arrange
  const player = playbackHarness(),
    other = playbackFixture()
  let release: () => void = () => undefined,
    entered: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  player.dependencies.load = async (studyId) => {
    if (studyId === player.studyId) {
      entered()
      await waiting
      return player.data
    }
    return other
  }
  const observed: PlaybackBundle[] = []
  player.dependencies.present = async (bundle): Promise<void> => {
    observed.push(bundle)
  }
  // Act
  player.open()
  await started
  player.controller.command({
    studyId: other.index.header.studyId,
    action: 'open',
    expectedRevision: player.controller.state().revision,
  })
  release()
  await player.controller.settle()
  // Assert
  assert.equal(observed.length, 1)
  assert.equal(observed[0]?.studyId, other.index.header.studyId)
  assert.equal(player.controller.state().presentedMs, 0)
  assert.equal(player.controller.state().mode, 'paused')
  await player.controller.dispose()
})

test('seeking inside the same recorded frame restores the cleared image before reporting readiness', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  // Act: both positions use the first frame and no observation, but a seek cleared its visible renderer.
  player.seek(25)
  await player.controller.settle()
  // Assert
  assert.equal(player.controller.state().readiness, 'ready')
  assert.equal(player.displayed(), 25)
  assert.equal(player.controller.state().cleared, false)
  assert.deepEqual(player.presented, [0, 25])
  await player.controller.dispose()
})

for (const interrupt of ['pause', 'hide'] as const)
  test(`an initial recording load interrupted by ${interrupt} can be explicitly reopened without application execution`, async () => {
    // Arrange
    const player = playbackHarness()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    player.dependencies.load = async () => {
      await held
      return player.data
    }
    // Act
    player.open()
    if (interrupt === 'pause') player.pause()
    else player.controller.hide()
    release()
    await player.controller.settle()
    assert.equal(player.controller.state().presentedMs, undefined)
    assert.deepEqual(player.saved, [])
    if (interrupt === 'pause') player.open()
    else player.controller.reveal()
    await player.controller.settle()
    // Assert
    assert.equal(player.controller.state().readiness, 'ready')
    assert.equal(player.controller.state().mode, 'paused')
    assert.equal(player.displayed(), 0)
    assert.equal(player.controller.state().cleared, false)
    player.controller.command({
      studyId: player.data.index.header.studyId,
      action: 'play',
      expectedRevision: player.controller.state().revision,
    })
    assert.equal(player.controller.state().mode, 'playing')
    await player.controller.dispose()
  })

// Value: protects=presentation changes and evidence navigation while a replay frame never presents; fails_when=a bounded settle keeps waiting past its bound; why_new=Cycle 0032 B1 settle contract; seam=none
test('a bounded settle gives up after its bound while the replay frame never presents, without cancelling the frame', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let release: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  player.dependencies.present = async (bundle): Promise<void> => {
    await waiting
    player.presented.push(bundle.projection.positionMs)
  }
  player.seek(100)

  // Act
  const outcome = await player.controller
    .settle(new AbortController().signal, 50)
    .then(
      () => 'settled',
      (error: unknown) => String(error),
    )
  release()
  await player.controller.settle()

  // Assert
  assert.equal(outcome, 'Error: Timed out waiting for the replay frame')
  assert.equal(player.controller.state().presentedMs, 100)
  await player.controller.dispose()
})

// Value: protects=focus-loss and navigation cancellation while a replay frame never presents; fails_when=a settle ignores its caller's signal; why_new=Cycle 0032 B1 settle contract; seam=none
test('a settle with a signal ends as soon as its caller aborts', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let release: () => void = () => undefined
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  player.dependencies.present = async (): Promise<void> => {
    await waiting
  }
  player.seek(100)
  const caller = new AbortController()
  const settling = player.controller.settle(caller.signal, 60_000).then(
    () => 'settled',
    (error: unknown) => String(error),
  )

  // Act
  caller.abort()
  const outcome = await settling

  // Assert
  assert.equal(outcome, 'Error: Cancelled the replay frame')
  release()
  await player.controller.dispose()
})

// Value: protects=presentation changes while a preference save waits behind the storage lock; fails_when=a bounded settle waits for saves again; why_new=Cycle 0033 B2 (the bounded settle tests never hold a save); seam=none
test('a bounded settle does not wait for a preference save that is still held by storage', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  let releaseSave: () => void = () => undefined
  const storageHeld = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  player.dependencies.save = async (bundle): Promise<void> => {
    await storageHeld
    player.saved.push(bundle.projection.positionMs)
  }
  player.seek(100)

  // Act
  const outcome = await player.controller
    .settle(new AbortController().signal, 50)
    .then(
      () => 'settled',
      (error: unknown) => String(error),
    )

  // Assert
  assert.equal(outcome, 'settled')
  assert.equal(player.controller.state().presentedMs, 100)
  releaseSave()
  await player.controller.saved()
  assert.deepEqual(player.saved.at(-1), 100)
  await player.controller.dispose()
})

// Value: protects=recovering a recording whose frame was retired by a presentation timeout; fails_when=opening the same recording returns early while its confirmed moment is unpainted; why_new=Cycle 0033 O1 (Codex outside voice); seam=none
test('opening the same recording after its frame was hidden paints the confirmed moment again', async () => {
  // Arrange
  const player = playbackHarness()
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  player.controller.hide()
  const paintsBefore = player.presented.length

  // Act
  player.open()
  await player.controller.settle()

  // Assert
  assert.equal(player.displayed(), 100)
  assert.equal(player.presented.length, paintsBefore + 1)
  assert.equal(player.controller.state().readiness, 'ready')
  await player.controller.dispose()
})

// Value: protects=later seeks when an earlier frame read never answers and ignores its abort; fails_when=pump awaits a dependency read without leaving on the request's abort; why_new=Cycle 0033 O2 (Codex outside voice); seam=none
test(
  'a newer seek presents while an earlier frame read never answers',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const player = playbackHarness()
    player.open()
    await player.controller.settle()
    const answeredFrame = player.dependencies.frame
    player.dependencies.frame = async (studyId, hash, signal) =>
      hash === sha256('frame-100')
        ? new Promise<Buffer>(() => {})
        : answeredFrame(studyId, hash, signal)
    player.seek(100)

    // Act
    player.seek(200)
    const outcome = await player.controller
      .settle(new AbortController().signal, 1_000)
      .then(
        () => 'settled',
        (error: unknown) => String(error),
      )

    // Assert
    assert.equal(outcome, 'settled')
    assert.equal(player.controller.state().presentedMs, 200)
    assert.equal(player.displayed(), 200)
    await player.controller.dispose()
  },
)

// Value: protects=opening another recording while an earlier recording's load never answers and ignores its abort; fails_when=pump awaits the recording load without leaving on the request's abort; why_new=Cycle 0033 O2 guards three dependency waits and only the frame read had a test; seam=none
test(
  'another recording opens while an earlier recording load never answers',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const player = playbackHarness(),
      other = playbackFixture()
    let entered: () => void = () => undefined
    const stalledLoadStarted = new Promise<void>((resolve) => {
      entered = resolve
    })
    player.dependencies.load = async (studyId) => {
      if (studyId !== player.studyId) return other
      entered()
      return new Promise<PlaybackData>(() => {})
    }
    player.open()
    await stalledLoadStarted

    // Act
    player.controller.command({
      studyId: other.index.header.studyId,
      action: 'open',
      expectedRevision: player.controller.state().revision,
    })
    const outcome = await player.controller
      .settle(new AbortController().signal, 1_000)
      .then(
        () => 'settled',
        (error: unknown) => String(error),
      )

    // Assert
    assert.equal(outcome, 'settled')
    assert.equal(player.controller.state().readiness, 'ready')
    assert.equal(player.controller.state().presentedMs, 0)
    assert.equal(
      player.controller.bundle()?.studyId,
      other.index.header.studyId,
    )
    await player.controller.dispose()
  },
)

// Value: protects=later seeks when an earlier frame's paint never answers and ignores its abort; fails_when=pump awaits the presentation without leaving on the request's abort; why_new=Cycle 0033 O2 guards three dependency waits, and the reader close test still passes with the close bound alone; seam=none
test(
  'a newer seek presents while an earlier frame paint never answers',
  { timeout: 10_000 },
  async () => {
    // Arrange
    const player = playbackHarness()
    player.open()
    await player.controller.settle()
    const answeredPaint = player.dependencies.present
    let entered: () => void = () => undefined
    const stalledPaintStarted = new Promise<void>((resolve) => {
      entered = resolve
    })
    player.dependencies.present = async (bundle, signal): Promise<void> => {
      if (bundle.projection.positionMs !== 100)
        return answeredPaint(bundle, signal)
      entered()
      return new Promise<void>(() => {})
    }
    player.seek(100)
    await stalledPaintStarted

    // Act
    player.seek(200)
    const outcome = await player.controller
      .settle(new AbortController().signal, 1_000)
      .then(
        () => 'settled',
        (error: unknown) => String(error),
      )

    // Assert
    assert.equal(outcome, 'settled')
    assert.equal(player.controller.state().readiness, 'ready')
    assert.equal(player.controller.state().presentedMs, 200)
    assert.equal(player.displayed(), 200)
    await player.controller.dispose()
  },
)

// Value: protects=an explicit reopen recovering a recording whose committed moment can no longer be shown as it is; fails_when=a same-study open at ready returns state although the reader closed or the historical debugger ended; why_new=Cycle 0034 O4/O5 (the same-study branch never reloaded); seam=none
test('opening the same recording again reloads it when its committed moment can no longer be shown as it is', async () => {
  // Arrange
  let presentable = true,
    loads = 0
  const player = playbackHarness({ presentable: () => presentable })
  const loadRecording = player.dependencies.load
  player.dependencies.load = async (studyId, signal) => {
    loads++
    // The workspace restores the position its last save stored.
    return {
      ...(await loadRecording(studyId, signal)),
      preferredPositionMs: player.saved.at(-1),
    }
  }
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  player.open()
  await player.controller.settle()
  const loadsWhilePresentable = loads,
    paintsWhilePresentable = player.presented.length

  // Act
  presentable = false
  player.open()
  await player.controller.settle()

  // Assert
  assert.equal(loadsWhilePresentable, 1)
  assert.equal(loads, 2)
  assert.equal(player.presented.length, paintsWhilePresentable + 1)
  assert.equal(player.displayed(), 100)
  assert.equal(player.controller.state().readiness, 'ready')
  await player.controller.dispose()
})

// Value: protects=a cold recording load from being restarted by a repeated open; fails_when=the reload for a moment that cannot be shown also applies while the first load is still running; why_new=Cycle 0034 O4 (plan review P3); seam=none
test('opening the same recording again while its first load is still running does not restart that load', async () => {
  // Arrange
  let loads = 0,
    releaseLoad = (): void => {}
  const player = playbackHarness({ presentable: () => false })
  const loadRecording = player.dependencies.load
  const loadHeld = new Promise<void>((resolve) => {
    releaseLoad = resolve
  })
  player.dependencies.load = async (studyId, signal) => {
    loads++
    await loadHeld
    return loadRecording(studyId, signal)
  }
  player.open()

  // Act
  const repeated = player.open()
  releaseLoad()
  await player.controller.settle()

  // Assert
  assert.equal(repeated.readiness, 'loading')
  assert.equal(loads, 1)
  assert.equal(player.controller.state().readiness, 'ready')
  await player.controller.dispose()
})

// Value: protects=the moment the learner confirmed last across a reload of the same recording; fails_when=the reload presents the position storage still holds because the confirmed moment's save has not landed, and then saves that older position last; why_new=Cycle 0035 H2 (every reload test let its saves land before reopening); seam=none
test('a recording reloaded while its position save is still held by storage presents the moment the learner confirmed last', async () => {
  // Arrange: storage holds 100 ms; the save of the confirmed 200 ms waits behind the storage lock.
  let presentable = true,
    releaseSave: () => void = () => undefined
  const player = playbackHarness({ presentable: () => presentable })
  const loadRecording = player.dependencies.load
  player.dependencies.load = async (studyId, signal) => ({
    ...(await loadRecording(studyId, signal)),
    // The workspace restores whatever position storage holds when the load reads it.
    preferredPositionMs: player.saved.at(-1),
  })
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  const storageHeld = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  player.dependencies.save = async (bundle): Promise<void> => {
    await storageHeld
    player.saved.push(bundle.projection.positionMs)
  }
  player.seek(200)
  // Bounded: an unbounded settle also waits for the held save, which lands only after releaseSave().
  await player.controller.settle(new AbortController().signal, 1_000)

  // Act: the historical session ended, so opening the same recording reloads it.
  presentable = false
  player.open()
  await player.controller.settle(new AbortController().signal, 1_000)
  const presentedWhileSaveHeld = player.controller.state().presentedMs
  releaseSave()
  await player.controller.saved()

  // Assert
  assert.equal(presentedWhileSaveHeld, 200)
  assert.equal(player.displayed(), 200)
  assert.equal(player.saved.at(-1), 200)
  await player.controller.dispose()
})

// Value: protects=each recording's confirmed moment when the learner visits another recording before the first one's save lands; fails_when=position memory keeps only the last recording, so A reopens at its older stored 100 ms and saves it last; why_new=Cycle 0035 R05 (Codex adversarial P2); seam=none
test('recording A reopened after visiting recording B while A position save is held presents and saves the moment confirmed in A', async () => {
  // Arrange: A's storage holds 100 ms; the save of A's confirmed 200 ms waits behind the storage lock.
  const player = playbackHarness(),
    recordingB = playbackFixture(),
    recordingBId = recordingB.index.header.studyId
  let releaseSave: () => void = () => undefined
  const storedPositionMsByStudy = new Map<string, number>()
  player.dependencies.load = async (studyId) => ({
    ...(studyId === recordingBId ? recordingB : player.data),
    // The workspace restores whatever position storage holds when the load reads it.
    preferredPositionMs: storedPositionMsByStudy.get(studyId),
  })
  player.dependencies.save = async (bundle): Promise<void> => {
    storedPositionMsByStudy.set(bundle.studyId, bundle.projection.positionMs)
    player.saved.push(bundle.projection.positionMs)
  }
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  await player.controller.saved()
  const storageHeld = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  player.dependencies.save = async (bundle): Promise<void> => {
    if (bundle.studyId === player.studyId) await storageHeld
    storedPositionMsByStudy.set(bundle.studyId, bundle.projection.positionMs)
    player.saved.push(bundle.projection.positionMs)
  }
  player.seek(200)
  // Bounded: an unbounded settle also waits for the held save, which lands only after releaseSave().
  await player.controller.settle(new AbortController().signal, 1_000)
  player.controller.command({
    studyId: recordingBId,
    action: 'open',
    expectedRevision: player.controller.state().revision,
  })
  await player.controller.settle(new AbortController().signal, 1_000)

  // Act
  player.open()
  await player.controller.settle(new AbortController().signal, 1_000)
  const presentedWhileSaveHeld = player.controller.state().presentedMs
  releaseSave()
  await player.controller.saved()

  // Assert
  assert.equal(presentedWhileSaveHeld, 200)
  assert.equal(storedPositionMsByStudy.get(player.studyId), 200)
  await player.controller.dispose()
})

// Value: protects=the learner's confirmed moment when its position save fails; fails_when=a reload falls back to the older stored position, or the failed save is no longer reported; why_new=Cycle 0035 H2 keeps the confirmed position in memory and must keep it after a storage failure; seam=none
test('a recording reloaded after its position save failed still presents the moment the learner confirmed last and reports the failed save', async () => {
  // Arrange: storage holds 100 ms and rejects every later save.
  let presentable = true
  const player = playbackHarness({ presentable: () => presentable })
  const loadRecording = player.dependencies.load
  player.dependencies.load = async (studyId, signal) => ({
    ...(await loadRecording(studyId, signal)),
    preferredPositionMs: player.saved.at(-1),
  })
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  player.dependencies.save = async (): Promise<void> => {
    throw new Error('disk full')
  }
  player.seek(200)
  await player.controller.settle()

  // Act
  presentable = false
  player.open()
  await player.controller.settle()

  // Assert
  const state = player.controller.state()
  assert.equal(state.presentedMs, 200)
  assert.equal(state.readiness, 'ready')
  assert.equal(state.reason, 'Playback position not saved: Error: disk full')
  assert.equal(player.saved.at(-1), 100)
  await player.controller.dispose()
})

// Value: protects=a reopened recording never presenting outside its verified range; fails_when=the remembered position bypasses the range clamp that the stored preference goes through; why_new=Cycle 0035 R2 (the remembered position is a new source of the opening position); seam=none
test('a recording that became shorter than the last confirmed moment reopens at its verified end', async () => {
  // Arrange: the learner confirmed 200 ms, then the recording is repaired to a verified range that ends at 150 ms.
  const player = playbackHarness()
  const loadRecording = player.dependencies.load
  player.open()
  await player.controller.settle()
  player.seek(200)
  await player.controller.settle()
  player.dependencies.load = async (studyId, signal) => {
    const recording = await loadRecording(studyId, signal)
    return {
      ...recording,
      index: { ...recording.index, endMs: 150, lastVerifiedMs: 150 },
      preferredPositionMs: player.saved.at(-1),
    }
  }
  player.controller.leave()

  // Act
  player.open()
  await player.controller.settle()

  // Assert
  const state = player.controller.state()
  assert.equal(state.presentedMs, 150)
  assert.equal(state.range?.endMs, 150)
  assert.equal(state.readiness, 'ready')
  await player.controller.dispose()
})

// Value: protects=another recording opening at its own stored position after the learner confirmed a moment in a different recording; fails_when=the remembered position is used without matching its study, so the other recording opens at the first recording's moment; why_new=Cycle 0035 H2 remembers the confirmed position, and the existing study switch abandons the first load before any moment is confirmed; seam=none
test('another recording opened after the learner confirmed a moment in the first one opens at its own stored position', async () => {
  // Arrange: the learner confirmed 200 ms in the first recording; storage holds 50 ms for the other recording.
  const player = playbackHarness(),
    other = playbackFixture()
  player.dependencies.load = async (studyId) =>
    studyId === player.studyId
      ? player.data
      : { ...other, preferredPositionMs: 50 }
  player.open()
  await player.controller.settle()
  player.seek(200)
  await player.controller.settle()
  const confirmedInFirst = player.controller.state().presentedMs

  // Act
  player.controller.command({
    studyId: other.index.header.studyId,
    action: 'open',
    expectedRevision: player.controller.state().revision,
  })
  await player.controller.settle()

  // Assert
  const state = player.controller.state()
  assert.equal(confirmedInFirst, 200)
  assert.equal(player.controller.bundle()?.studyId, other.index.header.studyId)
  assert.equal(state.readiness, 'ready')
  assert.equal(state.presentedMs, 50)
  assert.equal(player.displayed(), 50)
  await player.controller.dispose()
})

test('a seek or play sent before the load has delivered the recording is told the recording is not ready, although the reader is not marked open yet', async () => {
  // Arrange: the reader is marked open only after the load, which storage is still holding.
  let releaseLoad = (): void => {},
    readerOpen = false
  const player = playbackHarness({ readerOpen: () => readerOpen })
  const loadRecording = player.dependencies.load
  const loadHeld = new Promise<void>((resolve) => {
    releaseLoad = resolve
  })
  player.dependencies.load = async (studyId, signal) => {
    await loadHeld
    return loadRecording(studyId, signal)
  }
  player.open()

  // Act / Assert
  assert.throws(() => player.seek(100), {
    message:
      'Recording is not ready; read playback state before another control.',
  })
  assert.throws(() => player.play(), {
    message:
      'Recording is not ready; read playback state before another control.',
  })
  readerOpen = true
  releaseLoad()
  await player.controller.settle()
  assert.equal(player.controller.state().readiness, 'ready')
  assert.equal(player.controller.state().presentedMs, 0)
  await player.controller.dispose()
})

test('a seek or play on a loaded recording whose reader closed is told the reader is closed', async () => {
  // Arrange
  let readerOpen = true
  const player = playbackHarness({ readerOpen: () => readerOpen })
  player.open()
  await player.controller.settle()
  readerOpen = false

  // Act / Assert
  assert.throws(() => player.seek(100), {
    message:
      'The replay reader is closed; open the recording before another control.',
  })
  assert.throws(() => player.play(), {
    message:
      'The replay reader is closed; open the recording before another control.',
  })
  assert.equal(player.controller.state().presentedMs, 0)
  await player.controller.dispose()
})

// Value: protects=an agent learning that only open recovers a reader that closed during its first load; fails_when=the cancelled first load is still answered "Recording is not ready", so the agent polls a load that will never arrive; why_new=Cycle 0036 C03b; seam=none
test('a seek or play after the reader closed during its first load is told the reader is closed', async () => {
  // Arrange: the reader closes while storage still holds the first load, which hides the playback.
  let releaseLoad = (): void => {}
  const readerOpen = false
  const player = playbackHarness({ readerOpen: () => readerOpen })
  const loadRecording = player.dependencies.load
  const loadHeld = new Promise<void>((resolve) => {
    releaseLoad = resolve
  })
  player.dependencies.load = async (studyId, signal) => {
    await loadHeld
    return loadRecording(studyId, signal)
  }
  player.open()
  player.controller.hide()

  // Act / Assert
  assert.throws(() => player.seek(100), {
    message:
      'The replay reader is closed; open the recording before another control.',
  })
  assert.throws(() => player.play(), {
    message:
      'The replay reader is closed; open the recording before another control.',
  })
  releaseLoad()
  await player.controller.settle()
  assert.equal(player.controller.state().readiness, 'idle')
  await player.controller.dispose()
})

test('once the recording has arrived and before its first frame is presented, a play is asked to wait and a seek is accepted', async () => {
  // Arrange: the load delivered the recording, and its first frame is still being painted.
  let releaseFirstFrame = (): void => {},
    firstFrameStarted = (): void => {}
  const firstFrameHeld = new Promise<void>((resolve) => {
      releaseFirstFrame = resolve
    }),
    started = new Promise<void>((resolve) => {
      firstFrameStarted = resolve
    })
  const player = playbackHarness({ readerOpen: () => true })
  player.dependencies.present = async (bundle): Promise<void> => {
    if (bundle.projection.positionMs === 0) {
      firstFrameStarted()
      await firstFrameHeld
    }
    player.presented.push(bundle.projection.positionMs)
  }
  player.open()
  await started

  // Act
  assert.throws(() => player.play(), {
    message: 'Wait for matching presentation before playing.',
  })
  const sought = player.seek(100)
  releaseFirstFrame()
  await player.controller.settle()

  // Assert
  assert.equal(sought.requestedMs, 100)
  assert.equal(player.controller.state().readiness, 'ready')
  assert.equal(player.controller.state().presentedMs, 100)
  await player.controller.dispose()
})

// Value: protects=the recorded application image and the Run and Debug session staying on screen while Play passes the time an explanation was saved; fails_when=an explanation that becomes available for the stop on screen retires the displayed moment, so the image blanks and Run and Debug is emptied until the same stop is presented again; why_new=Cycle 0045 NF-13 (Cursor: the image blanked for about 0.6 s at 99.90 s of a Play); seam=none
test('Play keeps the recorded image and the recorded session on screen when an explanation becomes available while the same stop stays selected', async () => {
  // Arrange: the stop committed at 100 ms stays selected to the end of the recording, and its explanation was saved at 150 ms.
  let invalidations = 0
  let clearedWhilePresentingExplanation: boolean | undefined
  const player = playbackHarness({
    invalidate: () => {
      invalidations++
    },
    // Every publication while the explanation's time is requested reads the controller's state as the workspace does; one cleared reading is kept.
    changed: () => {
      if (player.controller.state().requestedMs === 150)
        clearedWhilePresentingExplanation =
          Boolean(clearedWhilePresentingExplanation) ||
          player.controller.state().cleared
    },
  })
  const explanationId = '44444444-4444-4444-8444-444444444444'
  player.data.context!.study.observations[0]!.interpretations = [
    {
      id: explanationId,
      text: 'The form state is still pending at this stop.',
      createdAt: '2026-09-19T00:00:03.000Z',
      facts: [],
    },
  ]
  player.data.context!.interpretationAvailability = [
    { id: explanationId, snapshotId: 'browser-session:1', elapsedMs: 150 },
  ]
  player.open()
  await player.controller.settle()
  player.seek(120)
  await player.controller.settle()
  const explanationsBeforePlay = player.controller
    .bundle()
    ?.projection.observation?.interpretations.map(
      (interpretation) => interpretation.id,
    )
  const invalidationsBeforePlay = invalidations

  // Act: Play reaches the time the explanation was saved.
  player.play()
  player.clock(30)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.deepEqual(explanationsBeforePlay, [])
  assert.equal(player.controller.state().presentedMs, 150)
  assert.deepEqual(
    player.controller
      .bundle()
      ?.projection.observation?.interpretations.map(
        (interpretation) => interpretation.id,
      ),
    ['44444444-4444-4444-8444-444444444444'],
  )
  assert.equal(clearedWhilePresentingExplanation, false)
  assert.equal(invalidations - invalidationsBeforePlay, 0)
  assert.equal(player.controller.state().cleared, false)
  assert.equal(player.controller.state().mode, 'playing')
  await player.controller.dispose()
})

// Value: protects=the recorded image and Run and Debug staying as they are while Play passes the time an explanation of the stop on screen was saved; fails_when=a change of the explanations shown makes the controller present the same frame and stop again, which re-sends the image to the Application pane and presents the stop to the historical debugger once more; why_new=Cycle 0045 FXU (native check F18 of NF-13); seam=none
test('Play across the time an explanation becomes available for the stop on screen presents no second moment and publishes the explanation', async () => {
  // Arrange: the stop committed at 100 ms has no recorded debugger state, so it stays selected to the end of the recording; its explanation was saved at 150 ms.
  const presentedPositions: number[] = []
  let invalidations = 0,
    publicationsOfTheExplainedMoment = 0
  const player = playbackHarness({
    present: async (bundle) => {
      presentedPositions.push(bundle.projection.positionMs)
    },
    invalidate: () => {
      invalidations++
    },
    // Counts only the publications that hand the Study pane the moment of 150 ms with its explanation, as the workspace reads it from the presented bundle.
    changed: () => {
      const presented = player.controller.bundle()?.projection
      if (
        presented?.positionMs === 150 &&
        presented.observation?.interpretations.some(
          (interpretation) => interpretation.id === explanationId,
        )
      )
        publicationsOfTheExplainedMoment++
    },
  })
  const explanationId = '55555555-5555-4555-8555-555555555555'
  player.data.context!.study.observations[0]!.interpretations = [
    {
      id: explanationId,
      text: 'The theme is read before the click applies it.',
      createdAt: '2026-09-19T00:00:03.000Z',
      facts: [],
    },
  ]
  player.data.context!.interpretationAvailability = [
    { id: explanationId, snapshotId: 'browser-session:1', elapsedMs: 150 },
  ]
  player.open()
  await player.controller.settle()
  player.seek(120)
  await player.controller.settle()
  const explanationsBeforePlay = player.controller
    .bundle()
    ?.projection.observation?.interpretations.map(
      (interpretation) => interpretation.id,
    )
  const invalidationsBeforePlay = invalidations
  player.play()

  // Act: Play reaches the time the explanation was saved.
  player.clock(30)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.deepEqual(explanationsBeforePlay, [])
  assert.equal(player.controller.state().presentedMs, 150)
  assert.deepEqual(
    player.controller
      .bundle()
      ?.projection.observation?.interpretations.map(
        (interpretation) => interpretation.id,
      ),
    ['55555555-5555-4555-8555-555555555555'],
  )
  assert.deepEqual(presentedPositions, [0, 120])
  assert.equal(invalidations - invalidationsBeforePlay, 0)
  assert.equal(publicationsOfTheExplainedMoment, 1)
  assert.equal(player.controller.state().mode, 'playing')
  await player.controller.dispose()
})

// Value: protects=Play still painting each new recorded image of the stop on screen; fails_when=the presentation key loses the frame hash, so the Application pane keeps the previous image while the playhead moves on; why_new=Cycle 0045 FXU narrowed the presentation key; seam=none
test('Play across a new recorded frame of the stop on screen presents that frame', async () => {
  // Arrange: the stop committed at 100 ms stays selected; the next recorded frame arrives at 200 ms.
  const presentedPositions: number[] = []
  const player = playbackHarness({
    present: async (bundle) => {
      presentedPositions.push(bundle.projection.positionMs)
    },
  })
  player.open()
  await player.controller.settle()
  player.seek(120)
  await player.controller.settle()
  player.play()

  // Act: Play moves 100 ms on, past the frame of 200 ms.
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().presentedMs, 220)
  assert.equal(player.controller.state().frame?.hash, sha256('frame-200'))
  assert.deepEqual(presentedPositions, [0, 120, 220])
  await player.controller.dispose()
})

// Value: protects=Play retiring the moment before a recorded stop and presenting the stop when it reaches it; fails_when=the controller treats the stop as the same moment, so the Application pane and Run and Debug keep the moment before it, or keeps the previous image while the stop's new frame loads; why_new=Cycle 0045 FXU narrowed the presentation key and keeps the image only where a stop's pause ends; seam=none
test('Play that reaches a recorded stop retires the moment before it, clears its image and presents the stop', async () => {
  // Arrange: the playhead stands at 50 ms, before the stop committed at 100 ms with a frame of its own.
  const presentedPositions: number[] = []
  const invalidationsKeepingPixels: Array<boolean | undefined> = []
  const player = playbackHarness({
    present: async (bundle) => {
      presentedPositions.push(bundle.projection.positionMs)
    },
    invalidate: (keepPixels) => {
      invalidationsKeepingPixels.push(keepPixels)
    },
  })
  player.open()
  await player.controller.settle()
  player.seek(50)
  await player.controller.settle()
  player.play()
  const invalidationsAtPlay = invalidationsKeepingPixels.length

  // Act: Play moves 100 ms on and stops at the stop's time.
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().presentedMs, 100)
  assert.equal(player.controller.state().observationId, 'browser-session:1')
  assert.deepEqual(presentedPositions, [0, 50, 100])
  assert.deepEqual(invalidationsKeepingPixels.slice(invalidationsAtPlay), [
    false,
  ])
  await player.controller.dispose()
})

// Value: protects=a stop entered on the frame already on screen still showing its loading state until its values are presented; fails_when=the kept image extends from a pause end to a stop entry; why_new=Cycle 0045 NF-13c keeps the image only where a stop's pause ends; seam=none
test('Play that reaches a recorded stop on the frame already on screen still clears the image until the stop is presented', async () => {
  // Arrange: the stop was committed at 70 ms, while the frame of 50 ms was still the latest; the playhead stands at 60 ms.
  const invalidationsKeepingPixels: Array<boolean | undefined> = []
  const player = playbackHarness({
    invalidate: (keepPixels) => {
      invalidationsKeepingPixels.push(keepPixels)
    },
  })
  player.data.context!.study.observations[0]!.elapsedMs = 70
  player.open()
  await player.controller.settle()
  player.seek(60)
  await player.controller.settle()
  player.play()
  const invalidationsAtPlay = invalidationsKeepingPixels.length

  // Act: Play moves 100 ms on and stops at the stop's time.
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().presentedMs, 70)
  assert.equal(player.controller.state().observationId, 'browser-session:1')
  assert.equal(player.controller.state().frame?.hash, sha256('frame-50'))
  assert.deepEqual(invalidationsKeepingPixels.slice(invalidationsAtPlay), [
    false,
  ])
  await player.controller.dispose()
})

// Value: protects=the recorded image staying on screen when a stop's recorded pause ends on the same frame, while the stop's values retire; fails_when=the pause end clears the Application pane to its loading state (native check F18: 17 to 35 dark frames at 153.24, 168.80 and 183.56 s), or keeps the stop and its debugger snapshot after the recording says the application continued; why_new=Cycle 0045 NF-13c; seam=none
test('Play that reaches the end of a stop’s recorded pause on the same frame keeps the image, retires the stop’s values and presents the moment without a stop', async () => {
  // Arrange: the stop committed at 100 ms carries recorded debugger state and its pause ended at 150 ms, before the next frame (200 ms).
  const presentedPositions: number[] = []
  const presentedSnapshots: boolean[] = []
  const invalidationsKeepingPixels: Array<boolean | undefined> = []
  const player = playbackHarness({
    present: async (bundle) => {
      presentedPositions.push(bundle.projection.positionMs)
      presentedSnapshots.push(Boolean(bundle.projection.debugger))
    },
    invalidate: (keepPixels) => {
      invalidationsKeepingPixels.push(keepPixels)
    },
  })
  const context = player.data.context!
  const stop = context.study.observations[0]!
  stop.debugger = {
    version: 1,
    frames: [
      {
        name: 'applyTheme',
        line: 1,
        column: 1,
        source: {
          name: 'theme.ts',
          text: stop.source.text,
          hash: stop.source.hash,
          line: 1,
        },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'nextTheme', value: 'dark', children: [] }],
    limitations: [],
  }
  context.pausedIntervals = [{ snapshotId: stop.id, startMs: 100, endMs: 150 }]
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  player.play()
  const invalidationsAtPlay = invalidationsKeepingPixels.length

  // Act: Play moves 100 ms on and stops at the end of the pause.
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().presentedMs, 150)
  assert.equal(player.controller.state().observationId, undefined)
  assert.equal(player.controller.state().frame?.hash, sha256('frame-100'))
  assert.deepEqual(presentedPositions, [0, 100, 150])
  assert.deepEqual(presentedSnapshots, [false, true, false])
  assert.deepEqual(invalidationsKeepingPixels.slice(invalidationsAtPlay), [
    true,
  ])
  await player.controller.dispose()
})

// Value: protects=the recorded image staying on screen when a stop's recorded pause ends and the application has already sent a newer frame, until that frame paints; fails_when=the pause end clears the Application pane because the next moment's frame hash differs (native check F18 on candidate 20: 0.6 s dark at 153.19 and 183.46 s, where the next frame arrived 49 and 14 ms after the pause ended); why_new=Cycle 0045 NF-13d; seam=none
test('Play that reaches the end of a stop’s recorded pause on a newer frame keeps the image until that frame is presented', async () => {
  // Arrange: the stop committed at 100 ms carries recorded debugger state and its pause ended at 200 ms, when the next frame arrived.
  const presentedPositions: number[] = []
  const invalidationsKeepingPixels: Array<boolean | undefined> = []
  const player = playbackHarness({
    present: async (bundle) => {
      presentedPositions.push(bundle.projection.positionMs)
    },
    invalidate: (keepPixels) => {
      invalidationsKeepingPixels.push(keepPixels)
    },
  })
  const context = player.data.context!
  const stop = context.study.observations[0]!
  stop.debugger = {
    version: 1,
    frames: [
      {
        name: 'applyTheme',
        line: 1,
        column: 1,
        source: {
          name: 'theme.ts',
          text: stop.source.text,
          hash: stop.source.hash,
          line: 1,
        },
        scopes: [{ name: 'Local', variables: [0] }],
      },
    ],
    variables: [{ name: 'nextTheme', value: 'dark', children: [] }],
    limitations: [],
  }
  context.pausedIntervals = [{ snapshotId: stop.id, startMs: 100, endMs: 200 }]
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  player.play()
  const invalidationsAtPlay = invalidationsKeepingPixels.length

  // Act: Play moves 100 ms on and stops at the end of the pause.
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().presentedMs, 200)
  assert.equal(player.controller.state().observationId, undefined)
  assert.equal(player.controller.state().frame?.hash, sha256('frame-200'))
  assert.deepEqual(presentedPositions, [0, 100, 200])
  assert.deepEqual(invalidationsKeepingPixels.slice(invalidationsAtPlay), [
    true,
  ])
  await player.controller.dispose()
})

// Value: protects=the recorded image staying on screen when the learner pauses Play between two frames; fails_when=Pause clears the Application pane although no newer frame is in flight, so it blinks dark while the same moment is restored (native check F18 on candidate 20: 3 dark frames at each Pause); why_new=Cycle 0045 NF-13d; seam=none
test('Pause between two Play steps keeps the image on screen while the paused moment is restored', async () => {
  // Arrange: Play has presented the frame of 100 ms at 120 ms and nothing is in flight.
  const presentedPositions: number[] = []
  const invalidationsKeepingPixels: Array<boolean | undefined> = []
  const player = playbackHarness({
    present: async (bundle) => {
      presentedPositions.push(bundle.projection.positionMs)
    },
    invalidate: (keepPixels) => {
      invalidationsKeepingPixels.push(keepPixels)
    },
  })
  player.open()
  await player.controller.settle()
  player.seek(100)
  await player.controller.settle()
  player.play()
  player.clock(20)
  player.controller.tick()
  await player.controller.settle()
  const invalidationsBeforePause = invalidationsKeepingPixels.length

  // Act
  player.pause()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().mode, 'paused')
  assert.equal(player.controller.state().presentedMs, 120)
  assert.deepEqual(presentedPositions, [0, 100, 120])
  assert.deepEqual(invalidationsKeepingPixels.slice(invalidationsBeforePause), [
    true,
    true,
  ])
  await player.controller.dispose()
})

// Value: protects=a frame that was sent but not confirmed never staying on screen after Pause; fails_when=Pause keeps the pixels while a newer frame is still being presented, so the pane may show that frame although the paused moment is the earlier one; why_new=Cycle 0045 NF-13d keeps the pixels at Pause only with no frame in flight; seam=the fake presentation of the newer frame is held
test('Pause while Play is still presenting a newer frame clears the image until the paused moment is restored', async () => {
  // Arrange: Play stands at 120 ms on the frame of 100 ms; the frame of 200 ms is being presented and not yet confirmed.
  const invalidationsKeepingPixels: Array<boolean | undefined> = []
  let releaseNewerFrame: () => void = () => undefined,
    enteredNewerFrame: () => void = () => undefined
  const newerFrameHeld = new Promise<void>((resolve) => {
      releaseNewerFrame = resolve
    }),
    newerFrameEntered = new Promise<void>((resolve) => {
      enteredNewerFrame = resolve
    })
  const player = playbackHarness({
    present: async (bundle) => {
      if (bundle.projection.positionMs === 220) {
        enteredNewerFrame()
        await newerFrameHeld
      }
    },
    invalidate: (keepPixels) => {
      invalidationsKeepingPixels.push(keepPixels)
    },
  })
  player.open()
  await player.controller.settle()
  player.seek(120)
  await player.controller.settle()
  player.play()
  player.clock(100)
  player.controller.tick()
  await newerFrameEntered
  const invalidationsBeforePause = invalidationsKeepingPixels.length

  // Act
  player.pause()
  releaseNewerFrame()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().mode, 'paused')
  assert.equal(player.controller.state().presentedMs, 120)
  assert.deepEqual(invalidationsKeepingPixels.slice(invalidationsBeforePause), [
    false,
    false,
  ])
  await player.controller.dispose()
})

// Value: protects=Play painting a new reason when one recorded gap follows another; fails_when=the presentation key loses the missing-history reason, so the Application pane keeps the first gap's sentence; why_new=Cycle 0045 FXU narrowed the presentation key; seam=none
test('Play from one recorded gap into another presents the second gap’s reason', async () => {
  // Arrange: the recording lost its frames at 120 ms for one reason and at 180 ms for another.
  const presentedMissing: Array<string | undefined> = []
  const player = playbackHarness({
    present: async (bundle) => {
      presentedMissing.push(bundle.projection.missing)
    },
  })
  const entries = player.data.index.entries
  entries.splice(
    3,
    0,
    {
      type: 'gap',
      sequence: 4,
      elapsedMs: 120,
      reason: 'The renderer stopped sending frames.',
    },
    {
      type: 'gap',
      sequence: 5,
      elapsedMs: 180,
      reason: 'The capture lost its connection.',
    },
  )
  player.open()
  await player.controller.settle()
  player.seek(130)
  await player.controller.settle()
  player.play()

  // Act: Play moves 60 ms on, into the second gap.
  player.clock(60)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.equal(player.controller.state().presentedMs, 190)
  assert.deepEqual(presentedMissing, [
    undefined,
    'The renderer stopped sending frames.',
    'The capture lost its connection.',
  ])
  await player.controller.dispose()
})

// Value: protects=an agent reading in the seek description the snap distance the seek really applies; fails_when=the description states the distance as a literal beside PLAYBACK_SEEK_STOP_SNAP_MS, so a changed constant leaves the published sentence wrong; why_new=Cycle 0045 SM-5; seam=the schema module is loaded with a constants module whose snap distance is 5 ms
test('the seek description names the snap distance the seek applies', async () => {
  // Arrange
  const schemas = await loadModule<typeof PlaybackSchemasModule>(
    resolve(__dirname, '../playbackSchemas.js'),
    { './constants': { ...constants, PLAYBACK_SEEK_STOP_SNAP_MS: 5 } },
  )

  // Act
  const description = schemas.playbackToolSchema.shape.positionMs.description

  // Assert
  assert.equal(
    description,
    'Required only for seek; use a position within the returned recording range. A position less than 5 ms before a recorded stop presents that stop. Omit for open, play and pause.',
  )
})

// Value: protects=a seek keeping the shown pixels while the next frame's bytes are read, and handing that frame to the pane in the same step that retires the old moment; fails_when=the seek retires the moment (and blanks the pane) before the frame resolves, which showed dark frames for 0.5 to 1.2 s at a stop's entry (F3, D29); why_new=Cycle 0050 F3 (observed in Cycle 0044 on Linux); why_changed=F381, the held-leave snapshot was taken after one microtask turn, so a leave issued a few turns later but before the frame read was missed (a mutation that leaves with the next frame six turns early passed the old snapshot) and now the snapshot is taken once the held read has started; seam=a gated frame read
test('a seek retires the shown moment only after the next frame is read and hands that frame to the leave', async () => {
  // Arrange
  let releaseRead = (): void => {}
  const readHeld = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let holdNextRead = false
  let markReadStarted = (): void => {}
  const readStarted = new Promise<void>((resolve) => {
    markReadStarted = resolve
  })
  const leaves: Array<{ keepPixels?: boolean; next?: number }> = []
  const player = playbackHarness({
    frame: async (_study, hash) => {
      if (holdNextRead) {
        markReadStarted()
        await readHeld
      }
      return Buffer.from(hash)
    },
    invalidate: (keepPixels, next) => {
      leaves.push({ keepPixels, next: next?.positionMs })
    },
  })
  player.open()
  await player.controller.settle()
  const leavesBeforeSeek = leaves.length
  holdNextRead = true

  // Act
  player.seek(120)
  // F381: the frame read has started, so a leave issued before it would already be in the list.
  await readStarted
  const leavesWhileHeld = leaves.slice(leavesBeforeSeek)
  releaseRead()
  await player.controller.settle()

  // Assert
  assert.deepEqual(leavesWhileHeld, [])
  assert.deepEqual(leaves.slice(leavesBeforeSeek), [
    { keepPixels: false, next: 120 },
  ])
  assert.equal(player.controller.state().presentedMs, 120)
  await player.controller.dispose()
})

// Value: protects=the bound of a frame read: a read that outlasts it blanks the pane (the page is hidden) instead of leaving the old moment's pixels for ever; fails_when=the controller waits for the frame without a bound; why_new=Cycle 0050 F3 (D29: the page is hidden only when no frame exists or the read passes its bound); seam=a gated frame read and frameReadBoundMs
test('a seek whose frame read passes its bound blanks the pane without a frame, and the frame still presents when it arrives', async () => {
  // Arrange
  let releaseRead = (): void => {}
  const readHeld = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let holdNextRead = false
  const leaves: Array<{ next?: number }> = []
  const player = playbackHarness({
    frameReadBoundMs: 1,
    frame: async (_study, hash) => {
      if (holdNextRead) await readHeld
      return Buffer.from(hash)
    },
    invalidate: (_keepPixels, next) => {
      leaves.push({ next: next?.positionMs })
    },
  })
  player.open()
  await player.controller.settle()
  const leavesBeforeSeek = leaves.length
  holdNextRead = true

  // Act
  player.seek(120)
  await waitUntil(
    () => leaves.length > leavesBeforeSeek,
    'the pane blanks at the bound',
    READER_RESULT_BOUND_MS,
  )
  const leavesAtBound = leaves.slice(leavesBeforeSeek)
  releaseRead()
  await player.controller.settle()

  // Assert
  assert.deepEqual(leavesAtBound, [{ next: undefined }])
  assert.equal(leaves.length, leavesBeforeSeek + 1)
  assert.equal(player.controller.state().presentedMs, 120)
  await player.controller.dispose()
})

// Value: protects=the bound of a frame read over a burst of superseding seeks (a drag of the time slider): the shown pixels and native state leave once the bound has passed since the first of them; fails_when=every superseded read re-arms the full bound, so the earlier moment's pixels stay on screen for as long as the drag lasts (F377); why_new=Cycle 0050 F377, the single-seek bound case never supersedes a read; seam=a gated frame read, frameReadBoundMs and the injected clock
test('a burst of superseding seeks still blanks the pane once the bound has passed since the first of them', async () => {
  // Arrange
  let releaseRead = (): void => {}
  const readHeld = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  let holdNextRead = false
  let readsStarted = 0
  const leaves: Array<{ next?: number }> = []
  const player = playbackHarness({
    frameReadBoundMs: 60_000,
    frame: async (_study, hash) => {
      if (holdNextRead) {
        readsStarted++
        await readHeld
      }
      return Buffer.from(hash)
    },
    invalidate: (_keepPixels, next) => {
      leaves.push({ next: next?.positionMs })
    },
  })
  player.open()
  await player.controller.settle()
  const leavesBeforeSeeks = leaves.length
  holdNextRead = true

  // Act: the first seek's read is held; the bound passes on the clock; a second seek supersedes it.
  player.seek(100)
  await waitUntil(
    () => readsStarted === 1,
    'the first read starts',
    READER_RESULT_BOUND_MS,
  )
  player.clock(60_000)
  player.seek(200)
  await waitUntil(
    () => readsStarted === 2,
    'the second read starts',
    READER_RESULT_BOUND_MS,
  )
  await waitUntil(
    () => leaves.length > leavesBeforeSeeks,
    'the pane blanks although the second seek superseded the first read',
    2_000,
  )
  const leavesWhileHeld = leaves.slice(leavesBeforeSeeks)
  releaseRead()
  await player.controller.settle()

  // Assert
  assert.deepEqual(leavesWhileHeld, [{ next: undefined }])
  assert.equal(player.controller.state().presentedMs, 200)
  await player.controller.dispose()
})

// Value: protects=a stop's entry during Play handing the stop's frame to the pane at the leave, so the pane never shows a blank page while the stop's source and values are presented; fails_when=the stop's entry retires the image without the next frame (the dark frames of F3 at a stop's entry); why_new=Cycle 0050 F3; seam=none
test('Play that reaches a recorded stop hands the stop’s frame to the leave', async () => {
  // Arrange
  const leaves: Array<{ keepPixels?: boolean; next?: number }> = []
  const player = playbackHarness({
    invalidate: (keepPixels, next) => {
      leaves.push({ keepPixels, next: next?.positionMs })
    },
  })
  player.open()
  await player.controller.settle()
  player.seek(50)
  await player.controller.settle()
  player.play()
  const leavesAtPlay = leaves.length

  // Act
  player.clock(100)
  player.controller.tick()
  await player.controller.settle()

  // Assert
  assert.deepEqual(leaves.slice(leavesAtPlay), [
    { keepPixels: false, next: 100 },
  ])
  await player.controller.dispose()
})
