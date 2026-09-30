import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import {
  PlaybackController,
  type PlaybackBundle,
  type PlaybackData,
  type PlaybackDependencies,
} from '../playbackController'
import type {
  RecordingContext,
  RecordingFrame,
  RecordingIndex,
} from '../recordingSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { createConfiguredStudy } from './utils/createConfiguredStudy'

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
