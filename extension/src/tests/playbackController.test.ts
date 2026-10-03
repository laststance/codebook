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
