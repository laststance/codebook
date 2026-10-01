import assert from 'node:assert/strict'
import { test } from 'node:test'

import { waitUntil } from '../runtimeSupport/utils/waitUntil'
import { NodeHistoryPlaybackController } from '../utils/nodeHistoryPlaybackController'

test('Node history playback seeks to verified events and presents every boundary in time order', async () => {
  // Arrange
  let now = 0
  const presented: number[] = [],
    events = [
      { sequence: 4, elapsedMs: 100 },
      { sequence: 7, elapsedMs: 1_000 },
      { sequence: 9, elapsedMs: 1_500 },
      { sequence: 12, elapsedMs: 3_000 },
    ]
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
    },
    changed() {},
    now: () => now,
    manualTicks: true,
  })
  controller.open(events, 4)

  // Act: seek between captured moments, then let the deterministic clock cross both remaining boundaries.
  await controller.seek(1_200)
  controller.play()
  now = 500
  await controller.tick()
  now = 2_500
  await controller.tick()

  // Assert
  assert.deepEqual(
    presented,
    [7, 9, 12],
    'time seek and playback present the exact verified sequence in order',
  )
  assert.equal(controller.state().sequence, 12)
  assert.equal(controller.state().positionMs, 3_000)
  assert.equal(
    controller.state().mode,
    'paused',
    'reaching the final test event pauses the reader',
  )
  assert.equal(controller.state().startMs, 100)
  assert.equal(controller.state().endMs, 3_000)
  controller.dispose()
})

// Value: protects=test output recorded right after a slow native stop keeps its recorded spacing during Play; fails_when=time spent waiting for Run and Debug counts as recorded time, so later events flash past back-to-back; why_new=existing timing tests present every event instantly; seam=none
test('Node history Play does not count a slow native stop presentation as recorded test time', async () => {
  // Arrange
  let now = 0
  const presented: number[] = [],
    events = [
      { sequence: 1, elapsedMs: 0 },
      { sequence: 2, elapsedMs: 100 },
      { sequence: 3, elapsedMs: 150 },
    ]
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
      // Native Run and Debug takes one second to load the recorded stop's values.
      if (sequence === 2) now += 1_000
    },
    changed() {},
    now: () => now,
    manualTicks: true,
  })
  controller.open(events, 1)
  controller.play()
  now = 100
  await controller.tick()

  // Act: shortly after the slow stop settles, less recorded time than the gap to the next output has passed.
  now += 20
  await controller.tick()
  const afterShortWait = [...presented]
  now += 30
  await controller.tick()

  // Assert
  assert.deepEqual(afterShortWait, [2])
  assert.deepEqual(presented, [2, 3])
  controller.dispose()
})

test('pausing Node history playback settles its current event without advancing to a later event', async () => {
  // Arrange
  let now = 0,
    settlePresentation!: () => void
  const presented: number[] = [],
    events = [
      { sequence: 1, elapsedMs: 0 },
      { sequence: 2, elapsedMs: 100 },
      { sequence: 3, elapsedMs: 200 },
    ]
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
      if (sequence === 2)
        await new Promise<void>((resolve) => {
          settlePresentation = resolve
        })
    },
    changed() {},
    now: () => now,
    manualTicks: true,
  })
  controller.open(events, 1)
  controller.play()

  // Act: pause while the next native presentation is still settling.
  now = 100
  const pendingTick = controller.tick()
  controller.pause()
  settlePresentation()
  await pendingTick

  // Assert
  assert.deepEqual(
    presented,
    [2],
    'pause lets the requested moment settle but suppresses all later moments',
  )
  assert.equal(controller.state().sequence, 2)
  assert.equal(controller.state().mode, 'paused')
  assert.equal(controller.state().loading, false)
  controller.dispose()
})

test('manual Node event selection stops playback and makes the selected event the next time anchor', async () => {
  // Arrange
  let now = 0
  const presented: number[] = [],
    events = [
      { sequence: 10, elapsedMs: 0 },
      { sequence: 11, elapsedMs: 100 },
      { sequence: 12, elapsedMs: 200 },
    ]
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
    },
    changed() {},
    now: () => now,
    manualTicks: true,
  })
  controller.open(events, 10)
  controller.play()

  // Act: learner selects a later event directly while automatic playback is active.
  controller.select(11)
  controller.play()
  now = 100
  await controller.tick()

  // Assert
  assert.deepEqual(
    presented,
    [12],
    'manual selection cancels earlier playback and advances from the selected sequence',
  )
  assert.equal(controller.state().sequence, 12)
  assert.equal(controller.state().mode, 'paused')
  controller.dispose()
})

test('failed Node native presentation pauses playback and surfaces the rejected event to its caller', async () => {
  // Arrange
  let now = 0
  const failure = new Error('native debugger presentation failed')
  const controller = new NodeHistoryPlaybackController({
    present: async () => {
      throw failure
    },
    changed() {},
    now: () => now,
    manualTicks: true,
  })
  controller.open(
    [
      { sequence: 3, elapsedMs: 0 },
      { sequence: 4, elapsedMs: 10 },
      { sequence: 5, elapsedMs: 20 },
    ],
    3,
  )
  controller.play()

  // Act
  now = 10
  const attempt = controller.tick()

  // Assert
  await assert.rejects(attempt, failure)
  assert.equal(
    controller.state().sequence,
    3,
    'a rejected native update is never reported as selected',
  )
  assert.equal(
    controller.state().mode,
    'paused',
    'a failed native update stops autoplay without advancing the selected event',
  )
  controller.dispose()
})

test('Play follows every real-time journal boundary and pauses at the verified result', async () => {
  // Arrange
  const presented: number[] = []
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
    },
    changed() {},
  })
  controller.open(
    [
      { sequence: 31, elapsedMs: 0 },
      { sequence: 32, elapsedMs: 50 },
      { sequence: 33, elapsedMs: 100 },
    ],
    31,
  )

  // Act
  controller.play()
  await waitUntil(
    () =>
      controller.state().sequence === 33 &&
      controller.state().mode === 'paused',
    'real-time playback reaches its final verified event',
    1_000,
  )

  // Assert
  assert.deepEqual(
    presented,
    [32, 33],
    'each source/debugger boundary is presented in recorded order',
  )
  assert.equal(controller.state().positionMs, 100)
  controller.dispose()
})

test('Play that cannot present the next Node event tells the learner why it stopped', async () => {
  // Arrange
  const failure = new Error('Historical debugger closed by the learner')
  const failures: unknown[] = []
  const controller = new NodeHistoryPlaybackController({
    present: async () => {
      throw failure
    },
    changed() {},
    failed: (error) => {
      failures.push(error)
    },
  })
  controller.open(
    [
      { sequence: 41, elapsedMs: 0 },
      { sequence: 42, elapsedMs: 10 },
    ],
    41,
  )

  // Act
  controller.play()
  await waitUntil(
    () => failures.length === 1,
    'autoplay reports its failed native presentation',
    1_000,
  )

  // Assert
  assert.deepEqual(failures, [failure])
  assert.equal(controller.state().mode, 'paused')
  assert.equal(
    controller.state().sequence,
    41,
    'the failed event is never reported as selected',
  )
  controller.dispose()
})

test('selecting another Node event while Play is presenting a stop reports no playback failure', async () => {
  // Arrange: the played stop is still starting its native debugger when the learner selects another event.
  const failures: unknown[] = []
  let rejectPresentation!: (error: Error) => void
  const controller = new NodeHistoryPlaybackController({
    present: (sequence) =>
      sequence === 52
        ? new Promise<void>((_resolve, reject) => {
            rejectPresentation = reject
          })
        : Promise.resolve(),
    changed() {},
    failed: (error) => {
      failures.push(error)
    },
  })
  controller.open(
    [
      { sequence: 51, elapsedMs: 0 },
      { sequence: 52, elapsedMs: 10 },
      { sequence: 53, elapsedMs: 20 },
    ],
    51,
  )
  controller.play()
  await waitUntil(
    () => controller.state().loading,
    'Play starts presenting the next stop',
    1_000,
  )

  // Act: the learner's selection supersedes the played step, whose presentation then rejects.
  controller.select(53)
  rejectPresentation(
    new Error('Historical debugger presentation was superseded.'),
  )
  await waitUntil(
    () => !controller.state().loading,
    'the superseded presentation settles',
    1_000,
  )
  await new Promise((resolve) => setImmediate(resolve))

  // Assert
  assert.deepEqual(failures, [])
  assert.equal(controller.state().sequence, 53)
  controller.dispose()
})

test('Pause and seek become available after a played Node event finishes presenting', async () => {
  // Arrange
  let now = 0
  const published: Array<{
    sequence?: number
    loading: boolean
    mode: 'paused' | 'playing'
  }> = []
  let controller!: NodeHistoryPlaybackController
  // eslint-disable-next-line prefer-const -- the change callback reads the controller it is passed to.
  controller = new NodeHistoryPlaybackController({
    present: async () => {},
    changed: () => {
      const state = controller.state()
      published.push({
        sequence: state.sequence,
        loading: state.loading,
        mode: state.mode,
      })
    },
    now: () => now,
    manualTicks: true,
  })
  controller.open(
    [
      { sequence: 1, elapsedMs: 0 },
      { sequence: 2, elapsedMs: 100 },
      { sequence: 3, elapsedMs: 200 },
    ],
    1,
  )
  controller.play()

  // Act
  now = 100
  await controller.tick()

  // Assert: the last published state drives the reader's Pause and seek disabled flags.
  assert.deepEqual(published.at(-1), {
    sequence: 2,
    loading: false,
    mode: 'playing',
  })
  controller.dispose()
})

test('a Node history seek outside the recorded time range is refused and keeps the selected event', async () => {
  // Arrange
  const presented: number[] = []
  const controller = new NodeHistoryPlaybackController({
    present: async (sequence) => {
      presented.push(sequence)
    },
    changed() {},
    now: () => 0,
    manualTicks: true,
  })
  controller.open(
    [
      { sequence: 4, elapsedMs: 100 },
      { sequence: 7, elapsedMs: 1_000 },
    ],
    7,
  )

  // Act
  const beforeStart = controller.seek(50)
  const afterEnd = controller.seek(1_001)

  // Assert
  await assert.rejects(beforeStart, /outside the verified Node history range/)
  await assert.rejects(afterEnd, /outside the verified Node history range/)
  assert.deepEqual(presented, [])
  assert.equal(controller.state().sequence, 7)
  assert.equal(controller.state().positionMs, 1_000)
  controller.dispose()
})

// Value: protects=the Node reader's loading state after a browser recording takes the shared debugger; fails_when=an abandoned presentation that settles later never publishes that loading ended; why_new=Cycle 0033 M1 (c); seam=none
test('abandoning a Node stop that is still loading publishes the pause, and its late settlement publishes that loading ended', async () => {
  // Arrange
  let finishPresentation = (): void => {}
  const presentationGate = new Promise<void>((resolve) => {
    finishPresentation = resolve
  })
  const published: Array<{ mode: string; loading: boolean }> = []
  const controller: NodeHistoryPlaybackController =
    new NodeHistoryPlaybackController({
      present: async () => presentationGate,
      changed() {
        const { mode, loading } = controller.state()
        published.push({ mode, loading })
      },
      manualTicks: true,
    })
  controller.open(
    [
      { sequence: 1, elapsedMs: 0 },
      { sequence: 2, elapsedMs: 100 },
    ],
    1,
  )
  const seeking = controller.seek(100)
  await waitUntil(
    () => controller.state().loading,
    'pending Node stop presentation',
    1_000,
    new AbortController().signal,
  )
  published.length = 0

  // Act
  controller.abandon()
  const afterAbandon = [...published]
  finishPresentation()
  await seeking

  // Assert
  assert.deepEqual(afterAbandon, [{ mode: 'paused', loading: true }])
  assert.deepEqual(published.at(-1), { mode: 'paused', loading: false })
  assert.equal(controller.state().sequence, 1)
  controller.dispose()
})

// Value: protects=a learner's seek while a played Node stop is failing still lands on the sought event; fails_when=the seek waits on the failing step and rejects with that step's error; why_new=Cycle 0034 R2; seam=none
test('a Node history seek made while a played stop is failing presents its own event', async () => {
  // Arrange: Play is presenting stop 62, whose native presentation is about to fail.
  let now = 0
  const presented: number[] = []
  let failPlayedStop = (_error: Error): void => {}
  const controller = new NodeHistoryPlaybackController({
    present: (sequence) => {
      presented.push(sequence)
      return sequence === 62
        ? new Promise<void>((_resolve, reject) => {
            failPlayedStop = reject
          })
        : Promise.resolve()
    },
    changed() {},
    now: () => now,
    manualTicks: true,
  })
  controller.open(
    [
      { sequence: 61, elapsedMs: 0 },
      { sequence: 62, elapsedMs: 100 },
      { sequence: 63, elapsedMs: 200 },
    ],
    61,
  )
  controller.play()
  now = 100
  const playedStep = controller.tick().then(
    () => 'presented',
    (error: unknown) => String(error),
  )
  await waitUntil(
    () => controller.state().loading,
    'played Node stop presentation',
    1_000,
    new AbortController().signal,
  )

  // Act: the learner seeks to the last event, then the played stop fails.
  const seeking = controller.seek(200).then(
    () => 'sought',
    (error: unknown) => String(error),
  )
  failPlayedStop(new Error('Historical debugger closed by the learner'))

  // Assert
  assert.equal(await seeking, 'sought')
  assert.equal(
    await playedStep,
    'Error: Historical debugger closed by the learner',
  )
  assert.deepEqual(presented, [62, 63])
  assert.equal(controller.state().sequence, 63)
  assert.equal(controller.state().mode, 'paused')
  controller.dispose()
})
