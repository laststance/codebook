import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { on } from 'node:events'
import { watch, writeFileSync } from 'node:fs'
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  controlTrial,
  reportTrials,
  swapoutChange,
  watchTrial,
} from '../utils/nativeTrialJournal.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'codebook-native-trial-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function sample(at, state = 'running', reachable = true, swapouts = 12) {
  return {
    at: new Date(at).toISOString(),
    host: {
      memoryPressure: 'normal',
      usedSwapMb: 12000,
      workloads: { build: 1 },
      pageSize: 16384,
      swapouts,
    },
    guest: {
      state,
      reachable,
      memoryPressure: reachable ? 'normal' : 'unknown',
      pageSize: reachable ? 16384 : null,
      swapouts: reachable ? 0 : null,
    },
  }
}

const options = {
  id: 'c151-session',
  cycle: 151,
  profile: 'build-overlap',
  duration: 4,
  interval: 1,
}

function clocked(clock, get, after = () => {}) {
  return {
    now: () => clock.at,
    sample: async () => get(clock.at),
    sleep: async (ms) => {
      clock.at += ms
      return after()
    },
  }
}

test('a running VM followed by a confirmed stop leaves host samples, signed paging changes and the overlapping workload', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const clock = { at: start }
  const readings = [
    sample(start),
    sample(start + 1000, 'unknown', null, 14),
    sample(start + 2000, 'stopped', null, 3),
  ]
  // Act
  const result = await watchTrial(
    root,
    options,
    clocked(clock, () => readings.shift()),
  )
  const { trials, groups } = await reportTrials(root)
  const last = JSON.parse(
    await readFile(join(root, options.id, 'sample-slot-2.json'), 'utf8'),
  )
  // Assert
  assert.equal(result.outcome, 'unexpected-stop')
  assert.equal(trials[0].samples, 3)
  assert.equal(last.host.swapouts, 3)
  assert.deepEqual(trials[0].pagingIntervals.host.at(-1), {
    since: new Date(start + 1000).toISOString(),
    seconds: 1,
    pages: -11,
    pagesPerSecond: -11,
    counterDecreased: true,
  })
  assert.equal(trials[0].peakHostSwapoutPagesPerSecond, 2)
  assert.deepEqual(trials[0].peakProcesses, { build: 1 })
  assert.equal(groups[0].counts['unexpected-stop'], 1)
  assert.deepEqual(groups[0].ids, [options.id])
})

test('planned stop evidence precedes the stopped sample and remains stable across repeated finish and watch', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const clock = { at: start }
  // Act
  const result = await watchTrial(
    root,
    options,
    clocked(
      clock,
      (at) => (at === start ? sample(at) : sample(at, 'stopped', null)),
      () =>
        controlTrial(
          root,
          options.id,
          'plan-stop',
          undefined,
          async () => sample(start),
          () => start,
        ),
    ),
  )
  // Assert
  assert.equal(result.outcome, 'planned-stop')
  assert.deepEqual(
    await controlTrial(root, options.id, 'finish', 'unknown', () =>
      assert.fail(),
    ),
    result,
  )
  assert.deepEqual(
    await watchTrial(root, options, { sample: () => assert.fail() }),
    result,
  )
})

test('an already stopped guest times out and a running guest with lost transport is recorded as disconnected', async (t) => {
  // Arrange
  const root = await fixture(t)
  const clock = { at: Date.parse('2020-01-01T00:00:00Z') }
  // Act
  const ended = await watchTrial(
    root,
    options,
    clocked(clock, (at) => sample(at, 'stopped', null)),
  )
  const other = { ...options, id: 'transport', profile: 'vm-only' }
  const disconnected = await watchTrial(
    root,
    other,
    clocked(
      clock,
      (at) => sample(at, 'running', false),
      () =>
        controlTrial(
          root,
          other.id,
          'finish',
          'disconnected',
          async () => sample(clock.at, 'running', false),
          () => clock.at,
        ),
    ),
  )
  // Assert
  assert.equal(ended.outcome, 'observer-timeout')
  assert.equal(disconnected.outcome, 'disconnected')
})

test('only a fresh running and reachable guest can confirm the operator’s healthy completion', async (t) => {
  // Arrange
  const root = await fixture(t)
  const clock = { at: Date.parse('2020-01-01T00:00:00Z') }
  let attempts = 0
  // Act
  const ended = await watchTrial(
    root,
    options,
    clocked(
      clock,
      (at) => sample(at),
      async () => {
        if (attempts++ === 0) {
          await assert.rejects(
            controlTrial(
              root,
              options.id,
              'finish',
              'healthy',
              async () => sample(clock.at, 'unknown', null),
              () => clock.at,
            ),
            /running and reachable/,
          )
          assert.equal(
            (await reportTrials(root)).trials[0].outcome,
            'incomplete',
          )
        } else
          await controlTrial(
            root,
            options.id,
            'finish',
            'healthy',
            async () => sample(clock.at),
            () => clock.at,
          )
      },
    ),
  )
  // Assert
  assert.equal(ended.outcome, 'healthy')
  assert.equal((await reportTrials(root)).groups[0].counts.healthy, 1)
})

test('observer interruption preserves samples and resuming the same trial cannot reset its deadline or change its profile', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const clock = { at: start }
  const interrupted = clocked(
    clock,
    (at) => sample(at),
    () => {
      throw new Error('simulated observer loss')
    },
  )
  // Act
  await assert.rejects(
    watchTrial(root, options, interrupted),
    /simulated observer loss/,
  )
  await assert.rejects(
    watchTrial(root, { ...options, profile: 'different' }, interrupted),
    /another profile/,
  )
  clock.at = start + 5000
  const result = await watchTrial(
    root,
    options,
    clocked(clock, () => assert.fail()),
  )
  // Assert
  assert.equal(result.outcome, 'observer-timeout')
  assert.equal((await reportTrials(root)).trials[0].samples, 1)
})

test('concurrent observers share durable samples and the report counts repeated successes and stops under the same conditions', async (t) => {
  // Arrange
  const root = await fixture(t)
  const run = async (id, state) => {
    const cfg = { ...options, id }
    const start = Date.parse('2020-01-01T00:00:00Z')
    const single = () => {
      const c = { at: start }
      return watchTrial(
        root,
        cfg,
        clocked(
          c,
          (at) =>
            at === start ? sample(at) : sample(at, state, state === 'running'),
          async () => {
            if (state === 'running')
              await controlTrial(
                root,
                id,
                'finish',
                'healthy',
                async () => sample(c.at),
                () => c.at,
              )
          },
        ),
      )
    }
    return Promise.all([single(), single()])
  }
  // Act
  await run('first', 'stopped')
  await run('second', 'stopped')
  await run('third', 'running')
  const { groups, trials } = await reportTrials(root)
  // Assert
  assert.equal(trials.find((t) => t.id === 'first').samples, 2)
  assert.equal(groups[0].total, 3)
  assert.equal(groups[0].counts.healthy, 1)
  assert.equal(groups[0].counts['unexpected-stop'], 2)
  assert.deepEqual(groups[0].ids, ['first', 'second', 'third'])
})

test('unknown counters or zero elapsed time leave the rate unknown', () => {
  // Arrange
  const first = sample(Date.now())
  const next = sample(Date.parse(first.at) + 2000)
  next.host.swapouts = null
  // Act and Assert
  assert.equal(swapoutChange(first, first, 'host'), null)
  assert.equal(swapoutChange(first, next, 'host'), null)
  assert.equal(swapoutChange(null, first, 'host'), null)
})

test('reports separate 16 GiB, 32 GiB and previously unmeasured trials even with the same declared workload', async (t) => {
  // Arrange
  const root = await fixture(t)
  for (const [id, memoryBytes] of [
    ['guest16', 16 * 2 ** 30],
    ['guest32', 32 * 2 ** 30],
    ['legacy', undefined],
  ]) {
    const start = Date.now()
    const clock = { at: start }
    const get = (at) => {
      const row = sample(at, at === start ? 'running' : 'stopped', at === start)
      if (memoryBytes !== undefined) {
        row.host.rssMiBByKind = { build: at === start ? 47.25 : 61.75 }
        row.guest.memoryBytes = at === start ? memoryBytes : null
        row.guest.usedSwapMb = at === start ? 128.5 : null
      }
      return row
    }
    await watchTrial(root, { ...options, id }, clocked(clock, get))
  }
  // Act
  const { groups, trials } = await reportTrials(root)
  // Assert
  assert.deepEqual(
    groups.map((g) => [g.guestMemoryBytes, g.total, g.ids]),
    [
      [17179869184, 1, ['guest16']],
      [34359738368, 1, ['guest32']],
      [null, 1, ['legacy']],
    ],
  )
  assert.equal(trials[0].guestMemorySamples, 1)
  assert.equal(trials[0].guestSwapSamples, 1)
  assert.equal(trials[0].minGuestUsedSwapMb, 128.5)
  assert.equal(trials[0].maxGuestUsedSwapMb, 128.5)
  assert.deepEqual(trials[0].peakHostRssMiBByKind, { build: 61.75 })
  assert.equal(trials[0].hostRssSamples, 2)
  assert.deepEqual(trials[2].observedGuestMemoryBytes, [])
  assert.equal(trials[2].minGuestUsedSwapMb, null)
  assert.equal(trials[2].peakHostRssMiBByKind, null)
})

for (const command of ['watch', 'finish']) {
  test(`a restarted ${command} preserves the earliest durable stop even after the deadline`, async (t) => {
    // Arrange
    const root = await fixture(t)
    const start = Date.now() - 60000
    const clock = { at: start }
    const seams = clocked(clock, (at) =>
      sample(at, at === start ? 'running' : 'stopped', at === start),
    )
    // The sample publication succeeded, then the observer exited before writing end.json.
    await assert.rejects(
      watchTrial(root, options, {
        ...seams,
        note: (row) => {
          if (row.guest === 'stopped') throw new Error('observer exited')
        },
      }),
      /observer exited/,
    )
    const dir = join(root, options.id)
    await writeFile(
      join(dir, 'sample-slot-2.json'),
      JSON.stringify(sample(start + 2000)),
    )
    await writeFile(
      join(dir, 'plan-stop.json'),
      JSON.stringify({ at: new Date(start + 3000).toISOString() }),
    )
    clock.at = Date.now()

    // Act
    const result =
      command === 'watch'
        ? await watchTrial(
            root,
            options,
            clocked(clock, () => assert.fail('new probe')),
          )
        : await controlTrial(root, options.id, 'finish', 'healthy', () =>
            assert.fail('new probe'),
          )

    // Assert
    assert.equal(result.outcome, 'unexpected-stop')
    assert.equal(result.sampleAt, new Date(start + 1000).toISOString())
    assert.equal((await reportTrials(root)).trials[0].samples, 2)
  })
}

test('a stop plan created inside the inventory query leaves stop order unknown', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now() - 60000
  const clock = { at: start }
  const seams = clocked(
    clock,
    (at) => {
      const row = sample(at, at === start ? 'running' : 'stopped', at === start)
      if (at !== start) {
        row.guest.stateObservedFrom = new Date(start + 1000).toISOString()
        row.guest.stateObservedTo = new Date(start + 1400).toISOString()
        row.at = new Date(start + 1500).toISOString()
      }
      return row
    },
    () =>
      assert.rejects(
        controlTrial(
          root,
          options.id,
          'plan-stop',
          undefined,
          async () => sample(start + 1200, 'unknown', null),
          () => start + 1200,
        ),
        /do not stop/i,
      ),
  )

  // Act
  const result = await watchTrial(root, options, seams)

  // Assert
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.sampleAt, new Date(start + 1500).toISOString())
})

test('a stopped guest whose inventory query finishes beyond the deadline cannot establish a timely stop', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const clock = { at: start }

  // Act
  const result = await watchTrial(
    root,
    options,
    clocked(clock, (at) => {
      if (at === start) return sample(at)
      const row = sample(start + 5500, 'stopped', null)
      row.guest.stateObservedFrom = new Date(start + 1000).toISOString()
      row.guest.stateObservedTo = new Date(start + 5000).toISOString()
      clock.at = start + 5500
      return row
    }),
  )

  // Assert
  assert.equal(result.outcome, 'observer-timeout')
})

test('a reset-only counter retains its signed difference and has no peak paging rate', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const clock = { at: start }
  await watchTrial(
    root,
    options,
    clocked(clock, (at) =>
      at === start
        ? sample(at, 'running', true, 10)
        : sample(at, 'stopped', null, 2),
    ),
  )

  // Act
  const { trials } = await reportTrials(root)
  const row = JSON.parse(
    await readFile(join(root, options.id, 'sample-slot-1.json'), 'utf8'),
  )

  // Assert
  assert.equal(row.host.swapouts, 2)
  assert.equal(trials[0].pagingIntervals.host[0].pages, -8)
  assert.equal(trials[0].hostCounterDecreases, 1)
  assert.equal(trials[0].peakHostSwapoutPagesPerSecond, null)
})

test('trials observing separate builds and suites have a different denominator from simultaneous workloads', async (t) => {
  // Arrange
  const root = await fixture(t)
  for (const [id, actual] of [
    ['serial', [{ build: 1 }, { suite: 1 }]],
    [
      'overlap',
      [
        { build: 1, suite: 1 },
        { build: 1, suite: 1 },
      ],
    ],
  ]) {
    const start = Date.now()
    const clock = { at: start }
    await watchTrial(
      root,
      { ...options, id },
      clocked(clock, (at) => {
        const row = sample(
          at,
          at === start ? 'running' : 'stopped',
          at === start,
        )
        row.host.workloads = actual.shift()
        return row
      }),
    )
  }

  // Act
  const { groups } = await reportTrials(root)

  // Assert
  assert.deepEqual(
    groups.map((g) => [g.ids, g.observedCombinations]),
    [
      [['overlap'], ['build+suite']],
      [['serial'], ['build', 'suite']],
    ],
  )
})

test(
  'report reads long journal histories under a constrained open-file limit',
  { skip: process.platform === 'win32' },
  async (t) => {
    // Arrange
    const root = await fixture(t)
    const dir = join(root, options.id)
    const start = Date.now()
    await mkdir(dir)
    await writeFile(
      join(dir, 'trial.json'),
      JSON.stringify({
        ...options,
        started: new Date(start).toISOString(),
        deadline: new Date(start + 4000).toISOString(),
      }),
    )
    const first = join(dir, 'sample-slot-0.json')
    await writeFile(first, JSON.stringify(sample(start)))
    // Shared immutable fixture bytes exercise 160 distinct file opens with minimal storage.
    for (let i = 1; i < 160; i++)
      await link(first, join(dir, `sample-slot-${i}.json`))
    const script = fileURLToPath(
      new URL('../native-trial.mjs', import.meta.url),
    )

    // Act
    const { stdout } = await promisify(execFile)('/bin/sh', [
      '-c',
      'ulimit -n 48 && exec "$@"',
      'test',
      process.execPath,
      script,
      'report',
      '--root',
      root,
      '--json',
    ])

    // Assert
    assert.equal(JSON.parse(stdout).trials[0].samples, 160)
  },
)

test('two observers retain the later stop in a shared polling slot without double-counting workload samples', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const firstStarted = Promise.withResolvers(),
    secondStarted = Promise.withResolvers()
  const runningSaved = Promise.withResolvers(),
    secondEnded = Promise.withResolvers()
  const first = watchTrial(root, options, {
    now: () => start,
    sample: async () => {
      firstStarted.resolve()
      await secondStarted.promise
      return sample(start)
    },
    note: () => runningSaved.resolve(),
    sleep: () => secondEnded.promise,
  })
  await firstStarted.promise

  // Act
  const clock = { at: start }
  const second = await watchTrial(root, options, {
    ...clocked(clock, async () => {
      secondStarted.resolve()
      await runningSaved.promise
      return sample(start + 100, 'stopped', null)
    }),
    sleep: async () => {
      clock.at = start + 5000
    },
  })
  secondEnded.resolve()
  const initial = await first
  const { trials } = await reportTrials(root)

  // Assert
  assert.equal(second.outcome, 'unexpected-stop')
  assert.deepEqual(initial, second)
  assert.equal(trials[0].samples, 1)
})

test('a rejected concurrent finish resets the paging baseline for the following measured watch interval', async (t) => {
  // Arrange
  const root = await fixture(t),
    start = Date.now(),
    clock = { at: start }
  const cfg = { ...options, interval: 2 }
  const next = clocked(
    clock,
    (at) =>
      at === start
        ? sample(at, 'running', true, 100)
        : sample(at, 'stopped', null, 110),
    async () => {
      await assert.rejects(
        controlTrial(
          root,
          options.id,
          'finish',
          'healthy',
          async () => sample(start + 1000, 'running', false, 5),
          () => start + 1000,
        ),
        /running and reachable/,
      )
    },
  )

  // Act
  await watchTrial(root, cfg, next)
  const { trials } = await reportTrials(root)

  // Assert
  assert.equal(trials[0].hostCounterDecreases, 1)
  assert.equal(trials[0].peakHostSwapoutPagesPerSecond, 105)
})

test('an intent filed after the last running observation cannot classify an already-stopped guest as a planned stop', async (t) => {
  // Arrange
  const root = await fixture(t),
    start = Date.now(),
    clock = { at: start }
  const seams = clocked(
    clock,
    (at) => (at === start ? sample(at) : sample(at, 'stopped', null)),
    () =>
      assert.rejects(
        controlTrial(
          root,
          options.id,
          'plan-stop',
          undefined,
          async () => sample(start + 300, 'stopped', null),
          () => start + 200,
        ),
        /do not stop/i,
      ),
  )

  // Act
  const ended = await watchTrial(root, options, seams)

  // Assert
  assert.equal(ended.outcome, 'unknown')
})

async function waitForClosing(dir) {
  // Subscribe before checking the directory so the finisher's link cannot be missed.
  const watcher = watch(dir)
  const changes = on(watcher, 'change', { signal: AbortSignal.timeout(5000) })
  try {
    while (!(await readdir(dir)).includes('closing.json')) await changes.next()
  } finally {
    await changes.return()
    watcher.close()
  }
}

test('timeout waits for an inventory-confirmed stop observed on time while other measurements are still completing', async (t) => {
  // Arrange
  const root = await fixture(t),
    start = Date.now(),
    clock = { at: start }
  const inFlight = Promise.withResolvers(),
    release = Promise.withResolvers()
  const watch = watchTrial(
    root,
    options,
    clocked(clock, async (at) => {
      if (at === start) return sample(start)
      inFlight.resolve()
      await release.promise
      const stopped = sample(start + 5000, 'stopped', null)
      stopped.guest.stateObservedFrom = new Date(start + 1500).toISOString()
      stopped.guest.stateObservedTo = new Date(start + 2500).toISOString()
      return stopped
    }),
  )
  await inFlight.promise

  // Act
  const finish = controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('expired probe'),
    () => start + 4500,
  )
  try {
    await waitForClosing(join(root, options.id))
  } finally {
    release.resolve()
  }
  const [watchEnd, finishEnd] = await Promise.all([watch, finish])

  // Assert
  assert.equal(finishEnd.outcome, 'unexpected-stop')
  assert.deepEqual(watchEnd, finishEnd)
})

test('counter rates use the metric clock for each side and require compatible known page units', () => {
  // Arrange
  const start = Date.now(),
    first = sample(start, 'running', true, 10),
    last = sample(start + 3000, 'running', true, 22)
  first.host.swapoutsObservedAt = new Date(start).toISOString()
  last.host.swapoutsObservedAt = new Date(start + 1000).toISOString()
  first.guest.swapoutsObservedAt = null

  // Act and Assert
  assert.equal(swapoutChange(first, last, 'host').pagesPerSecond, 12)
  assert.equal(swapoutChange(first, last, 'guest'), null)
  last.host.pageSize = 4096
  assert.equal(swapoutChange(first, last, 'host'), null)
})

test('an expired unfinished observation leaves a bounded unknown outcome that a repeated finish can read', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now() - 60000
  const cfg = { ...options, id: 'lost-probe' }
  const dir = join(root, cfg.id)
  await mkdir(dir)
  await writeFile(
    join(dir, 'trial.json'),
    JSON.stringify({
      ...cfg,
      started: new Date(start).toISOString(),
      deadline: new Date(start + 4000).toISOString(),
    }),
  )
  await writeFile(
    join(dir, 'pending-cccccccc-dddd-aaaa-bbbb-eeeeeeeeeeee.json'),
    JSON.stringify({ expiresAt: start + 30000 }),
  )

  // Act
  const result = await controlTrial(root, cfg.id, 'finish', 'unknown', () =>
    assert.fail('expired probe'),
  )
  const retry = await watchTrial(root, cfg, {
    sample: () => assert.fail('closed trial'),
  })

  // Assert
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.reason, 'incomplete-observation')
  assert.deepEqual(retry, result)
})

async function startedTrial(t) {
  const root = await fixture(t),
    dir = join(root, options.id)
  const start = Date.parse('2026-11-27T03:00:00.000Z')
  const at = (seconds) => new Date(start + seconds * 1000).toISOString()
  await mkdir(dir)
  const put = (name, data) => writeFile(join(dir, name), JSON.stringify(data))
  await put('trial.json', { ...options, started: at(0), deadline: at(10) })
  return { root, dir, put, at, start }
}

test('a scheduled running reading without a witness to the published stop plan leaves the stop order unknown', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  await put('plan-stop.json', { at: at(1) })
  await put('sample-slot-2.json', sample(start + 2000))
  await put('sample-slot-4.json', sample(start + 4000, 'stopped', null))

  // Act
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('fresh probe'),
    () => start + 5000,
  )

  // Assert
  assert.equal(end.outcome, 'unknown')
})

test('planning a stop after closing starts tells the operator that no stop observation can be recorded', async (t) => {
  // Arrange
  const { root, dir, put, at, start } = await startedTrial(t)
  await put('closing.json', { outcome: 'unknown', at: at(2), sampleAt: null })
  // Act and Assert
  await assert.rejects(
    controlTrial(
      root,
      options.id,
      'plan-stop',
      undefined,
      () => assert.fail('closed probe'),
      () => start + 3000,
    ),
    /do not stop/i,
  )
  assert.equal((await readdir(dir)).includes('plan-stop.json'), false)
})

test('a failed directory sync after publishing a reservation leaves no stale observer and permits healthy retry', async (t) => {
  // Arrange
  const { root, dir, start } = await startedTrial(t)
  const directory = await open(dir, 'r')
  const handle = Object.getPrototypeOf(directory),
    original = handle.sync
  const identity = await directory.stat()
  await directory.close()
  let failed = false
  t.mock.method(handle, 'sync', async function () {
    const current = await this.stat()
    if (
      current.ino === identity.ino &&
      current.dev === identity.dev &&
      (await readdir(dir)).some((name) => name.startsWith('pending-')) &&
      !failed
    ) {
      failed = true
      throw Object.assign(new Error('failed reservation directory sync'), {
        code: 'EIO',
      })
    }
    return original.call(this)
  })

  // Act
  await assert.rejects(
    controlTrial(
      root,
      options.id,
      'finish',
      'healthy',
      () => assert.fail('unreserved probe'),
      () => start + 1000,
    ),
    /failed reservation directory sync/,
  )

  // Assert
  assert.equal(failed, true)
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.startsWith('pending-')),
    [],
  )
  const retry = await controlTrial(
    root,
    options.id,
    'finish',
    'healthy',
    async () => sample(start + 2000),
    () => start + 2000,
  )
  assert.equal(retry.outcome, 'healthy')
})

test('a late row reports only states, workloads, memory and page counters observed before the confirmed stop', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  const initial = sample(start, 'running', true, 10)
  initial.host.workloads = {}
  initial.guest.swapouts = 10
  const delayed = sample(start + 8000, 'running', true, 16)
  Object.assign(delayed.guest, {
    stateObservedFrom: at(1),
    stateObservedTo: at(1.2),
    measurementsObservedAt: at(7),
    memoryBytes: 32 * 2 ** 30,
    memoryPressure: 'critical',
    swapoutsObservedAt: at(7),
    swapouts: 1000,
  })
  Object.assign(delayed.host, {
    workloadsObservedAt: at(2),
    workloads: { tsc: 1 },
    rssMiBByKind: { tsc: 202 },
    memoryPressure: 'warning',
    usedSwapMb: 123,
    swapoutsObservedAt: at(3),
  })
  const stopped = sample(start + 6000, 'stopped', null, 1000)
  Object.assign(stopped.guest, {
    stateObservedFrom: at(3.9),
    stateObservedTo: at(4),
    measurementsObservedAt: null,
  })
  Object.assign(stopped.host, {
    workloadsObservedAt: at(5),
    workloads: { suite: 3 },
    memoryPressure: 'critical',
    usedSwapMb: 99999,
    swapoutsObservedAt: at(5),
  })
  await put('sample-slot-0.json', initial)
  await put('sample-slot-1.json', delayed)
  await put('sample-slot-3.json', stopped)

  // Act
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('durable stop'),
    () => start + 9000,
  )
  const {
    trials: [trial],
  } = await reportTrials(root)

  // Assert
  assert.equal(end.outcome, 'unexpected-stop')
  assert.deepEqual(trial.observedCombinations, ['none', 'tsc'])
  assert.deepEqual(trial.peakHostRssMiBByKind, { tsc: 202 })
  assert.deepEqual(trial.pressures, ['normal', 'warning'])
  assert.equal(trial.minUsedSwapMb, 123)
  assert.equal(trial.maxUsedSwapMb, 12000)
  assert.equal(trial.guestMemorySamples, 0)
  assert.deepEqual(trial.guestPressures, ['normal'])
  assert.equal(trial.peakHostSwapoutPagesPerSecond, 2)
  assert.deepEqual(trial.pagingIntervals.guest, [])
  assert.equal(trial.stopEvidence.running.to, at(1.2))
  assert.equal(trial.stopEvidence.stopped.to, at(4))
})

test('a single probe that confirms running then stopped leaves both provider readings in the report', async (t) => {
  // Arrange
  const root = await fixture(t),
    start = Date.now(),
    clock = { at: start }
  const at = (ms) => new Date(start + ms).toISOString()
  const row = sample(start + 300, 'stopped', null)
  Object.assign(row.guest, {
    initialRunningObservation: {
      stateObservedFrom: at(0),
      stateObservedTo: at(50),
    },
    stateObservedFrom: at(200),
    stateObservedTo: at(250),
  })

  // Act
  const end = await watchTrial(root, options, {
    ...clocked(clock, () => row),
    sleep: () => assert.fail('confirmed transition should finish immediately'),
  })
  const {
    trials: [trial],
  } = await reportTrials(root)

  // Assert
  assert.equal(end.outcome, 'unexpected-stop')
  assert.deepEqual(trial.stopEvidence, {
    running: { from: at(0), to: at(50) },
    stopped: { from: at(200), to: at(250) },
  })
})

test('a missing workload reading in a confirmed trial sample separates its denominator from fully observed builds', async (t) => {
  // Arrange
  const { root, dir, at, start } = await startedTrial(t)
  const declaration = JSON.parse(
    await readFile(join(dir, 'trial.json'), 'utf8'),
  )
  for (const id of ['complete-build', 'partial-build']) {
    const folder = join(root, id)
    await mkdir(folder)
    await writeFile(
      join(folder, 'trial.json'),
      JSON.stringify({ ...declaration, id }),
    )
    const first = sample(start + 1000),
      second = sample(start + 2000)
    first.host.workloadsObservedAt = at(1)
    second.host.workloadsObservedAt = at(2)
    if (id === 'partial-build') {
      second.host.workloads = null
      second.host.workloadsObservedAt = null
    }
    const afterEnd = sample(start + 7000)
    afterEnd.host.workloads = null
    afterEnd.host.workloadsObservedAt = null
    for (const [i, row] of [first, second, afterEnd].entries())
      await writeFile(
        join(folder, `sample-slot-${i}.json`),
        JSON.stringify(row),
      )
    await writeFile(
      join(folder, 'end.json'),
      JSON.stringify({ at: at(5), outcome: 'healthy' }),
    )
  }

  // Act
  const { groups, trials } = await reportTrials(root)

  // Assert
  assert.deepEqual(
    groups
      .filter((g) => g.counts.healthy)
      .map((g) => [g.observedCombinations, g.total, g.ids]),
    [
      [['build'], 1, ['complete-build']],
      [['build', 'unknown'], 1, ['partial-build']],
    ],
  )
  assert.equal(trials.find((trial) => trial.id === 'partial-build').samples, 2)
})

test('finish and watch retry the directory sync before accepting a terminal record left by failed publication', async (t) => {
  // Arrange
  const { root, dir, start } = await startedTrial(t)
  const directory = await open(dir, 'r'),
    handle = Object.getPrototypeOf(directory),
    original = handle.sync
  const identity = await directory.stat()
  await directory.close()
  let allowedSyncs = 0,
    attempts = 0
  t.mock.method(handle, 'sync', async function () {
    const current = await this.stat()
    if (
      current.dev === identity.dev &&
      current.ino === identity.ino &&
      (await readdir(dir)).includes('end.json')
    ) {
      attempts++
      if (allowedSyncs-- <= 0)
        throw Object.assign(new Error('terminal directory sync failed'), {
          code: 'EIO',
        })
      await original.call(this)
      return
    }
    return original.call(this)
  })
  const now = () => start + 1000
  const finish = () =>
    controlTrial(
      root,
      options.id,
      'finish',
      'healthy',
      async () => sample(now()),
      now,
    )
  const watch = () =>
    watchTrial(root, options, {
      sample: () => assert.fail('terminal trial cannot start a probe'),
      now,
    })

  // Act and Assert
  await assert.rejects(finish(), /terminal directory sync failed/)
  const terminal = await readFile(join(dir, 'end.json'), 'utf8')
  await assert.rejects(finish(), /terminal directory sync failed/)
  // Watch syncs trial.json on startup. Only its second directory sync should fail.
  allowedSyncs = 1
  attempts = 0
  await assert.rejects(watch(), /terminal directory sync failed/)
  assert.equal(attempts, 2)
  await assert.rejects(reportTrials(root), /terminal directory sync failed/)
  allowedSyncs = Infinity
  assert.deepEqual(await finish(), JSON.parse(terminal))
  assert.deepEqual(await watch(), JSON.parse(terminal))
  assert.equal((await reportTrials(root)).trials[0].outcome, 'healthy')
  assert.equal(await readFile(join(dir, 'end.json'), 'utf8'), terminal)
})

test('a stop plan keeps an overtime inventory reading but never reports it as a timely running witness', async (t) => {
  // Arrange
  const { root, dir, at, start } = await startedTrial(t)
  let clock = start + 9000
  const late = sample(start + 12000)
  late.guest.stateObservedFrom = at(9)
  late.guest.stateObservedTo = at(11)

  // Act
  const plan = controlTrial(
    root,
    options.id,
    'plan-stop',
    undefined,
    async () => {
      clock = start + 12000
      return late
    },
    () => clock,
  )

  // Assert
  await assert.rejects(plan, /do not stop/i)
  const observation = (await readdir(dir)).find((name) =>
    name.startsWith('observation-'),
  )
  assert.ok(observation)
  const row = JSON.parse(await readFile(join(dir, observation), 'utf8'))
  assert.equal(row.guest.stateObservedTo, at(11))
  const ended = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('expired probe'),
    () => clock,
  )
  assert.equal(ended.outcome, 'observer-timeout')
})

test('a stop plan refuses when the recorder closes while its running probe is still in flight', async (t) => {
  // Arrange
  const { root, dir, put, at, start } = await startedTrial(t)

  // Act and Assert
  await assert.rejects(
    controlTrial(
      root,
      options.id,
      'plan-stop',
      undefined,
      async () => {
        await put('closing.json', {
          outcome: 'unknown',
          at: at(2),
          sampleAt: null,
        })
        return sample(start + 2000)
      },
      () => start + 1000,
    ),
    /do not stop/i,
  )
  assert.ok(
    (await readdir(dir)).some((name) => name.startsWith('observation-')),
  )
})

test('a recorder resuming an expired probe retains its raw measurement without changing the closed CLI report', async (t) => {
  // Arrange
  const { root, dir, start } = await startedTrial(t)
  let wall = start
  t.mock.method(Date, 'now', () => wall)
  const captured = Promise.withResolvers(),
    resume = Promise.withResolvers()
  let watchAt = start + 1000
  const watch = watchTrial(root, options, {
    now: () => watchAt,
    sample: async () => {
      const row = sample(start + 1000)
      captured.resolve()
      await resume.promise
      return row
    },
    sleep: async () => {
      watchAt = start + 11000
    },
  })
  const script = fileURLToPath(new URL('../native-trial.mjs', import.meta.url))
  const report = async () =>
    (
      await promisify(execFile)(process.execPath, [
        script,
        'report',
        '--root',
        root,
        '--json',
      ])
    ).stdout
  await captured.promise
  wall += 31_000

  // Act
  let before
  try {
    const end = await controlTrial(
      root,
      options.id,
      'finish',
      'unknown',
      () => assert.fail('past deadline'),
      () => start + 11000,
    )
    assert.equal(end.reason, 'incomplete-observation')
    before = await report()
  } finally {
    resume.resolve()
    await watch
  }

  // Assert
  assert.equal(JSON.parse(before).trials[0].samples, 0)
  assert.ok((await readdir(dir)).includes('sample-slot-1.json'))
  assert.equal(await report(), before)
})

test('a refused stop plan during closing cannot authorize a subsequent confirmed stop', async (t) => {
  // Arrange
  const { root, dir, start } = await startedTrial(t)
  const sampling = Promise.withResolvers(),
    release = Promise.withResolvers()
  const watching = Promise.withResolvers(),
    stopped = Promise.withResolvers()
  let watchAt = start
  const watch = watchTrial(root, options, {
    now: () => watchAt,
    sample: async () => {
      watching.resolve()
      await stopped.promise
      return sample(start + 4000, 'stopped', null)
    },
    sleep: async () => {
      watchAt = start + 11000
    },
  })
  await watching.promise
  const plan = controlTrial(
    root,
    options.id,
    'plan-stop',
    undefined,
    async () => {
      sampling.resolve()
      await release.promise
      return sample(start + 2000)
    },
    () => start + 1000,
  )
  await sampling.promise

  // Act
  const finish = controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('past deadline'),
    () => start + 11000,
  )
  try {
    await waitForClosing(dir)
    release.resolve()
    await assert.rejects(plan, /do not stop/i)
  } finally {
    release.resolve()
    stopped.resolve()
  }
  const [end, repeated] = await Promise.all([finish, watch])

  // Assert
  assert.equal(end.outcome, 'unexpected-stop')
  assert.deepEqual(repeated, end)
  const files = await readdir(dir)
  const refusal = files.find((name) => name.startsWith('refused-observation-'))
  assert.ok(refusal)
  const decision = JSON.parse(await readFile(join(dir, refusal), 'utf8'))
  assert.equal(decision.status, 'rejected')
  assert.ok(files.includes(decision.witness))
  const report = await reportTrials(root)
  assert.equal(report.groups[0].counts['planned-stop'], 0)
  assert.equal(
    report.trials[0].stopEvidence.running.to,
    new Date(start + 2000).toISOString(),
  )
})

test('a stop observed while a grant is being published cannot use the earlier decision timestamp as approval', async (t) => {
  // Arrange: the planner has persisted its running witness and decided at two seconds, but its grant is still private.
  const { root, put, at, start } = await startedTrial(t)
  await put('plan-stop.json', { at: at(1), requiresAuthorization: true })
  await put('observation-abcd.json', {
    ...sample(start + 1500),
    additionalObservation: true,
    afterPlanAt: at(1),
  })

  // Act: the provider has already returned stopped when the competing planner publishes its grant.
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    async () => {
      const stopped = sample(start + 3000, 'stopped', null)
      await put('plan-stop-authorization.json', {
        status: 'accepted',
        witness: 'observation-abcd.json',
        acceptedAt: at(2),
      })
      return stopped
    },
    () => start + 3000,
  )

  // Assert
  assert.equal(end.outcome, 'unknown')
  assert.equal(end.stopEvidence.stopped.to, at(3))
})

test('a faster approved stop probe cannot resolve an overlapping stop observed without the grant', async (t) => {
  // Arrange: both reads saw a stop after the running witness. The grantless read can have observed it first.
  const { root, put, at, start } = await startedTrial(t)
  await put('plan-stop.json', { at: at(1), requiresAuthorization: true })
  await put('observation-abcd.json', {
    ...sample(start + 1500),
    additionalObservation: true,
    afterPlanAt: at(1),
  })
  await put('plan-stop-authorization.json', {
    status: 'accepted',
    witness: 'observation-abcd.json',
    acceptedAt: at(2.5),
  })
  for (const [slot, from, to, stopPlanWitness] of [
    [2, 2, 5, null],
    [3, 3, 4, 'observation-abcd.json'],
  ]) {
    const row = sample(start + to * 1000, 'stopped', null)
    row.guest.stateObservedFrom = at(from)
    row.guest.stateObservedTo = at(to)
    await put(`sample-slot-${slot}.json`, { ...row, stopPlanWitness })
  }

  // Act
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('stop already recorded'),
    () => start + 6000,
  )

  // Assert
  assert.equal(end.outcome, 'unknown')
  assert.equal(end.stopEvidence.stopped.to, at(4))
})

for (const [name, grantlessWindow, expired, outcome] of [
  [
    'a stop query straddles the only running observation',
    [1, 5],
    false,
    'unknown',
  ],
  ['a stop query straddles the trial deadline', [1, 11], false, 'unknown'],
  [
    'the stop query has no usable observation time',
    [null, null],
    false,
    'unknown',
  ],
  ['an admitted probe expired without a result', null, true, 'unknown'],
  [
    'the only earlier stop finished before any running observation',
    [0, 1],
    false,
    'planned-stop',
  ],
]) {
  test(`the CLI preserves the confirmed stop window when ${name}`, async (t) => {
    // Arrange: a running witness at two seconds, a grant, then a confirmed stop from three to four.
    const { root, put, at, start } = await startedTrial(t)
    await put('plan-stop.json', { at: at(1.5), requiresAuthorization: true })
    await put('observation-abcd.json', {
      ...sample(start + 2100),
      additionalObservation: true,
      afterPlanAt: at(1.5),
      guest: {
        ...sample(start).guest,
        stateObservedFrom: at(2),
        stateObservedTo: at(2.1),
      },
    })
    await put('plan-stop-authorization.json', {
      status: 'accepted',
      witness: 'observation-abcd.json',
      acceptedAt: at(2.2),
    })
    const approved = sample(start + 4000, 'stopped', null)
    approved.guest.stateObservedFrom = at(3)
    approved.guest.stateObservedTo = at(4)
    await put('sample-slot-3.json', {
      ...approved,
      stopPlanWitness: 'observation-abcd.json',
    })
    if (grantlessWindow) {
      const [from, to] = grantlessWindow
      const older = sample(start + 5000, 'stopped', null)
      older.guest.stateObservedFrom = from === null ? null : at(from)
      older.guest.stateObservedTo = to === null ? null : at(to)
      await put('sample-slot-2.json', { ...older, stopPlanWitness: null })
    }
    if (expired) await put('pending-abcd.json', { expiresAt: 0 })
    const script = fileURLToPath(
      new URL('../native-trial.mjs', import.meta.url),
    )
    const cli = async (...args) =>
      JSON.parse(
        (
          await promisify(execFile)(process.execPath, [
            script,
            ...args,
            '--root',
            root,
          ])
        ).stdout,
      )

    // Act: all commands read or close the same durable observations without probing the VM.
    const end = await cli('finish', '--id', options.id, '--outcome', 'unknown')
    const replay = await cli(
      'watch',
      '--id',
      options.id,
      '--profile',
      options.profile,
      '--cycle',
      '151',
      '--duration',
      '4',
      '--interval',
      '1',
    )
    const report = await cli('report', '--json')

    // Assert
    assert.equal(end.outcome, outcome)
    assert.deepEqual(end.stopEvidence.stopped, { from: at(3), to: at(4) })
    assert.deepEqual(replay, end)
    assert.equal(report.trials[0].outcome, outcome)
    assert.deepEqual(report.trials[0].stopEvidence, end.stopEvidence)
    if (expired) assert.equal(end.reason, 'incomplete-observation')
  })
}

test('a missing or unreadable deadline refuses monitoring and finishing before taking a sample', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  for (const deadline of [undefined, 'invalid', null]) {
    await put('trial.json', { ...options, started: at(0), deadline })
    const sample = () => assert.fail('the trial admitted a probe')
    const expected = /invalid deadline.*trial\.json/i

    // Act and Assert
    await assert.rejects(
      watchTrial(root, options, { now: () => start, sample }),
      expected,
    )
    await assert.rejects(
      controlTrial(root, options.id, 'finish', 'unknown', sample, () => start),
      expected,
    )
    await assert.rejects(reportTrials(root), expected)
  }
})

test('a scheduled stop closes immediately when an independent planner supplied the only running observation', async (t) => {
  // Arrange
  const root = await fixture(t)
  const start = Date.now()
  const clock = { at: start }
  let sleeps = 0

  // Act
  const end = await watchTrial(
    root,
    options,
    clocked(
      clock,
      (time) =>
        time === start
          ? sample(time, 'unknown', null)
          : sample(time, 'stopped', null),
      async () => {
        assert.equal(
          ++sleeps,
          1,
          'the confirmed stop needs no next polling interval',
        )
        await controlTrial(
          root,
          options.id,
          'plan-stop',
          undefined,
          async () => sample(start + 500),
          () => start + 500,
        )
      },
    ),
  )

  // Assert
  assert.equal(end.outcome, 'planned-stop')
  assert.equal(end.sampleAt, new Date(start + 1000).toISOString())
})

for (const outcome of ['incomplete', 'unknown']) {
  test(`a trial reported as ${outcome} excludes work and paging after its declared deadline`, async (t) => {
    // Arrange
    const { root, put, start } = await startedTrial(t)
    const atDeadline = sample(start + 10000, 'running', true, 22)
    const overtime = sample(start + 10500, 'running', true, 99)
    overtime.host.workloads = { suite: 9 }
    overtime.host.usedSwapMb = 45000
    overtime.guest.memoryBytes = 32 * 1024 ** 3
    await put('sample-slot-0.json', sample(start + 8000))
    await put('sample-slot-1.json', atDeadline)
    await put('sample-slot-2.json', overtime)
    if (outcome === 'unknown') {
      // A lost probe makes the late finish record unknown instead of observer-timeout.
      await put('pending-abcd.json', { expiresAt: 0 })
      const end = await controlTrial(
        root,
        options.id,
        'finish',
        'unknown',
        () => assert.fail('past deadline'),
        () => start + 11000,
      )
      assert.equal(end.reason, 'incomplete-observation')
    }

    // Act
    const {
      trials: [trial],
      groups: [group],
    } = await reportTrials(root)

    // Assert
    assert.equal(trial.outcome, outcome)
    assert.equal(trial.samples, 2)
    assert.deepEqual(trial.peakProcesses, { build: 1 })
    assert.equal(trial.maxUsedSwapMb, 12000)
    assert.equal(trial.pagingIntervals.host.length, 1)
    assert.equal(trial.pagingIntervals.host[0].pages, 10)
    assert.deepEqual(group.observedCombinations, ['build'])
    assert.deepEqual(group.observedGuestMemoryBytes, [])
  })
}

test('a legacy terminal without a usable deadline keeps observations through its recorded end', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  await put('end.json', { at: at(11), outcome: 'healthy' })
  await put('sample-slot-0.json', sample(start + 10500))
  const after = sample(start + 12000)
  after.host.workloads = { suite: 9 }
  await put('sample-slot-1.json', after)

  for (const deadline of [undefined, 'invalid', at(-1)]) {
    await put('trial.json', { ...options, started: at(0), deadline })

    // Act
    const {
      trials: [trial],
    } = await reportTrials(root)

    // Assert
    assert.equal(trial.samples, 1)
    assert.deepEqual(trial.peakProcesses, { build: 1 })
    assert.equal(trial.outcome, 'healthy')
  }
})

test('an observed stop shortens the declared interval even on a timeout terminal', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  await put('sample-slot-0.json', sample(start + 5000))
  const after = sample(start + 7000)
  after.host.workloads = { suite: 9 }
  await put('sample-slot-1.json', after)
  await put('end.json', {
    at: at(11),
    outcome: 'observer-timeout',
    stopEvidence: {
      running: { from: at(5), to: at(5) },
      stopped: { from: at(6), to: at(6) },
    },
  })

  // Act
  const {
    trials: [trial],
  } = await reportTrials(root)

  // Assert
  assert.equal(trial.samples, 1)
  assert.deepEqual(trial.peakProcesses, { build: 1 })
})

for (const endedAt of [9.5, 10.5]) {
  test(`a timeout recorded at ${endedAt} seconds includes workload and paging evidence only through the ten-second deadline`, async (t) => {
    // Arrange
    const { root, put, at, start } = await startedTrial(t)
    for (const [slot, seconds, count] of [
      [8, 8, 1],
      [9, 9.8, 2],
      [10, 10.2, 99],
    ]) {
      const row = sample(start + seconds * 1000, 'running', true, count)
      row.host.workloads = { build: count }
      await put(`sample-slot-${slot}.json`, row)
    }
    await put('end.json', { at: at(endedAt), outcome: 'observer-timeout' })

    // Act
    const {
      trials: [trial],
    } = await reportTrials(root)

    // Assert
    assert.deepEqual(trial.peakProcesses, { build: 2 })
    assert.equal(trial.samples, 2)
    assert.equal(trial.pagingIntervals.host.length, 1)
    assert.equal(trial.pagingIntervals.host[0].pages, 1)
  })
}

test('legacy plan observations cannot establish an unrecorded approval on recovery', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  await put('plan-stop.json', { at: at(1) })
  await put('observation-abcd.json', {
    ...sample(start + 2000),
    additionalObservation: true,
    afterPlanAt: at(1),
  })
  await put('sample-slot-3.json', sample(start + 3000, 'stopped', null))

  // Act
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('already stopped'),
    () => start + 4000,
  )

  // Assert
  assert.equal(end.outcome, 'unknown')
  assert.equal(end.stopEvidence.running.to, at(2))
})

test('an invalid terminal record reports its file and never restarts the observer', async (t) => {
  // Arrange
  const { root, dir, put, start } = await startedTrial(t)
  for (const invalid of [null, 0, false, '', []]) {
    await put('end.json', invalid)

    // Act and Assert
    const invalidRecord = { message: new RegExp('end\\.json') }
    await assert.rejects(reportTrials(root), invalidRecord)
    await assert.rejects(
      watchTrial(root, options, {
        now: () => start,
        sample: () => assert.fail('corrupt trial'),
      }),
      invalidRecord,
    )
    await assert.rejects(
      controlTrial(root, options.id, 'finish', 'unknown'),
      invalidRecord,
    )
    assert.equal(
      await readFile(join(dir, 'end.json'), 'utf8'),
      JSON.stringify(invalid),
    )
  }
})

test('the CLI preserves a legacy terminal outcome and freezes its surviving samples on first recovery', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  const oldEnd = { at: at(3), sampleAt: at(3), outcome: 'planned-stop' }
  await put('sample-slot-0.json', sample(start))
  await put('sample-slot-3.json', sample(start + 3000, 'stopped', null))
  await put('end.json', oldEnd)
  const script = fileURLToPath(new URL('../native-trial.mjs', import.meta.url))
  const cli = async (...args) =>
    (
      await promisify(execFile)(process.execPath, [
        script,
        ...args,
        '--root',
        root,
      ])
    ).stdout

  // Act
  const first = await cli('report', '--json')
  await put('sample-slot-1.json', sample(start + 1000))
  const finished = await cli(
    'finish',
    '--id',
    options.id,
    '--outcome',
    'unknown',
  )
  await assert.rejects(
    cli('plan-stop', '--id', options.id),
    /Do not stop the VM/,
  )
  const second = await cli('report', '--json')

  // Assert
  assert.equal(JSON.parse(first).trials[0].samples, 2)
  assert.equal(JSON.parse(first).groups[0].counts['planned-stop'], 1)
  assert.deepEqual(JSON.parse(finished), oldEnd)
  assert.equal(first, second)
})

test('an active trial can approve a fresh stop plan after a prior observation was refused', async (t) => {
  // Arrange
  const { root, dir, at, start } = await startedTrial(t)
  const plan = (seconds, state) =>
    controlTrial(
      root,
      options.id,
      'plan-stop',
      undefined,
      async () => sample(start + seconds * 1000, state, state === 'running'),
      () => start + seconds * 1000,
    )

  // Act
  await assert.rejects(plan(1, 'unknown'), /do not stop/i)
  await plan(2, 'running')
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    async () => sample(start + 3000, 'stopped', null),
    () => start + 3000,
  )

  // Assert
  const grant = JSON.parse(
    await readFile(join(dir, 'plan-stop-authorization.json'), 'utf8'),
  )
  assert.equal(grant.status, 'accepted')
  const witness = JSON.parse(await readFile(join(dir, grant.witness), 'utf8'))
  assert.equal(witness.at, at(2))
  assert.equal(end.outcome, 'planned-stop')
  assert.equal(end.stopEvidence.running.to, at(2))
})

for (const [change, response] of [
  ['the deadline arrives', 'refuses shutdown'],
  ['finish closes the trial', 'refuses shutdown'],
  ['the trial stays open', 'allows shutdown'],
]) {
  test(`the stop plan ${response} when ${change} during grant publication`, async (t) => {
    // Arrange
    const { root, dir, start, at } = await startedTrial(t)
    let clock = start + 9900
    const now = () => clock
    const running = async () => sample(clock)
    const checkSync = await interruptJournalSync(
      t,
      dir,
      preparingGrant,
      async () => {
        if (change === 'finish closes the trial') {
          const end = await controlTrial(
            root,
            options.id,
            'finish',
            'healthy',
            running,
            now,
          )
          assert.equal(end.outcome, 'healthy')
        } else {
          clock = start + (change === 'the deadline arrives' ? 10_000 : 9999)
        }
      },
    )

    // Act
    const plan = controlTrial(
      root,
      options.id,
      'plan-stop',
      undefined,
      running,
      now,
    )

    // Assert
    if (change === 'the trial stays open') {
      assert.deepEqual(await plan, { at: at(9.9), requiresAuthorization: true })
    } else {
      await assert.rejects(plan, /Do not stop the VM/)
    }
    checkSync()
  })
}

/** Interleaves a real journal operation at a specific link's first directory sync. */
async function interruptJournalSync(t, dir, matches, interrupt) {
  const handle = await open(dir, 'r')
  const identity = await handle.stat()
  const handles = Object.getPrototypeOf(handle)
  const sync = handles.sync
  await handle.close()
  let reached = false
  t.mock.method(handles, 'sync', async function () {
    const entry = await this.stat()
    if (
      entry.dev === identity.dev &&
      entry.ino === identity.ino &&
      matches(await readdir(dir)) &&
      !reached
    ) {
      reached = true
      await interrupt()
    }
    return sync.call(this)
  })
  return () =>
    assert.ok(reached, 'the operation reached the selected directory sync')
}

const grantFile = 'plan-stop-authorization.json'
const preparingGrant = (files) =>
  files.some((name) => name.startsWith('prepared-observation-')) ||
  files.includes(grantFile)

for (const step of [
  'the watcher closes before commitment',
  'the planner cannot sync its preparation',
  'the watcher closes after commitment',
]) {
  test(`the recorded stop and operator response agree when ${step}`, async (t) => {
    // Arrange
    const { root, dir, start, at } = await startedTrial(t)
    const committed = step === 'the watcher closes after commitment'
    const interrupted = step === 'the planner cannot sync its preparation'
    const watchStop = () =>
      watchTrial(root, options, {
        now: () => start + 3000,
        sample: async () => sample(start + 3000, 'stopped', null),
        sleep: () => assert.fail('the watcher already observed the stop'),
      })
    let end
    const checkSync = await interruptJournalSync(
      t,
      dir,
      committed ? (files) => files.includes(grantFile) : preparingGrant,
      async () => {
        if (interrupted) throw new Error('preparation sync interrupted')
        end = await watchStop()
      },
    )

    // Act
    const plan = controlTrial(
      root,
      options.id,
      'plan-stop',
      undefined,
      async () => sample(start + 2000),
      () => start + 2000,
    )
    if (committed)
      assert.deepEqual(await plan, { at: at(2), requiresAuthorization: true })
    else if (interrupted) {
      await assert.rejects(plan, /preparation sync interrupted/)
      end = await watchStop()
    } else await assert.rejects(plan, /Do not stop the VM/)
    const row = JSON.parse(
      await readFile(join(dir, 'sample-slot-3.json'), 'utf8'),
    )
    const report = await reportTrials(root)

    // Assert
    checkSync()
    const expected = committed ? 'planned-stop' : 'unexpected-stop'
    assert.equal(end.outcome, expected)
    assert.deepEqual(end.stopEvidence.stopped, { from: at(3), to: at(3) })
    if (committed) assert.match(row.stopPlanWitness, /^observation-/)
    else assert.equal(row.stopPlanWitness, null)
    assert.deepEqual(await watchStop(), end)
    assert.deepEqual(
      await controlTrial(root, options.id, 'finish', 'unknown', () =>
        assert.fail('terminal trial'),
      ),
      end,
    )
    assert.equal(report.trials[0].outcome, expected)
  })
}

test('restarting after the closer wins the stop decision recovers its healthy finish and refuses shutdown', async (t) => {
  // Arrange
  const { root, dir, at, start } = await startedTrial(t)
  const now = () => start + 1000
  const checkSync = await interruptJournalSync(
    t,
    dir,
    (files) => files.includes(grantFile),
    async () => {
      throw new Error('closing sync interrupted')
    },
  )

  // Act
  await assert.rejects(
    controlTrial(
      root,
      options.id,
      'finish',
      'healthy',
      async () => sample(now()),
      now,
    ),
    /closing sync interrupted/,
  )
  checkSync()
  assert.ok(!(await readdir(dir)).includes('closing.json'))
  const noProbe = () =>
    assert.fail('the closing decision fences the restarted trial')
  await assert.rejects(
    controlTrial(root, options.id, 'plan-stop', undefined, noProbe, now),
    /Do not stop the VM/,
  )
  const ended = await watchTrial(root, options, {
    now: () => start + 11000,
    sample: noProbe,
  })

  // Assert
  assert.equal(ended.outcome, 'healthy')
  assert.equal(ended.at, at(1))
  assert.deepEqual(
    await controlTrial(root, options.id, 'finish', 'unknown', noProbe, now),
    ended,
  )
})

test('a legacy grant with a refusal for its own witness cannot attribute an observed stop to the operator', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  const witness = 'observation-abcd.json'
  await put('plan-stop.json', { at: at(1), requiresAuthorization: true })
  await put(witness, {
    ...sample(start + 2000),
    additionalObservation: true,
    afterPlanAt: at(1),
  })
  await put(grantFile, { status: 'accepted', witness, acceptedAt: at(2) })
  await put(`refused-${witness}`, { status: 'rejected', witness })
  await put('sample-slot-3.json', {
    ...sample(start + 3000, 'stopped', null),
    stopPlanWitness: witness,
  })

  // Act
  const end = await controlTrial(
    root,
    options.id,
    'finish',
    'unknown',
    () => assert.fail('stop is recorded'),
    () => start + 4000,
  )

  // Assert
  assert.equal(end.outcome, 'unknown')
  assert.deepEqual(end.stopEvidence.stopped, { from: at(3), to: at(3) })
  assert.equal((await reportTrials(root)).groups[0].counts['planned-stop'], 0)
})

for (const [previousGrant, restartAt] of [
  [false, 4],
  [true, 4],
  [false, 11],
]) {
  test(`a restarted guest cannot get another stop plan at ${restartAt} seconds after the watcher recorded ${previousGrant ? 'a planned' : 'an unexpected'} stop and exited`, async (t) => {
    // Arrange
    const { root, dir, at, start } = await startedTrial(t)
    const runningPlan = (seconds, sampleRunning) =>
      controlTrial(
        root,
        options.id,
        'plan-stop',
        undefined,
        sampleRunning,
        () => start + seconds * 1000,
      )
    if (previousGrant) await runningPlan(1, async () => sample(start + 1000))
    const clock = { at: start + 2000 }
    await assert.rejects(
      watchTrial(root, options, {
        ...clocked(clock, (time) =>
          time === start + 2000 ? sample(time) : sample(time, 'stopped', null),
        ),
        note: (row) => {
          if (row.guest === 'stopped')
            throw new Error('watcher exited after sample publication')
        },
      }),
      /watcher exited after sample publication/,
    )
    assert.ok(!(await readdir(dir)).includes('end.json'))
    let newProbes = 0
    const restartedGuest = async () => {
      newProbes++
      return sample(start + restartAt * 1000)
    }

    // Act
    await assert.rejects(
      runningPlan(restartAt, restartedGuest),
      /Do not stop the VM/,
    )
    const terminal = JSON.parse(await readFile(join(dir, 'end.json'), 'utf8'))
    await assert.rejects(
      runningPlan(restartAt, restartedGuest),
      /Do not stop the VM/,
    )
    const refusedProbe = () =>
      assert.fail('a recovered trial cannot probe again')

    // Assert
    assert.equal(newProbes, 0)
    assert.equal(
      terminal.outcome,
      previousGrant ? 'planned-stop' : 'unexpected-stop',
    )
    assert.deepEqual(terminal.stopEvidence.stopped, { from: at(3), to: at(3) })
    assert.deepEqual(
      await watchTrial(root, options, { sample: refusedProbe }),
      terminal,
    )
    assert.deepEqual(
      await controlTrial(root, options.id, 'finish', 'healthy', refusedProbe),
      terminal,
    )
    const report = await reportTrials(root)
    assert.equal(report.trials[0].outcome, terminal.outcome)
  })
}

test('a stop recorded while the planner prepares its grant survives a watcher exit and prevents approval', async (t) => {
  // Arrange
  const { root, dir, start, at } = await startedTrial(t)
  let clock = start + 1000
  const now = () => clock
  const checkPreparation = await interruptJournalSync(
    t,
    dir,
    (files) => files.some((name) => name.startsWith('prepared-observation-')),
    async () => {
      clock = start + 3000
      await assert.rejects(
        watchTrial(root, options, {
          now,
          sample: async () => sample(clock, 'stopped', null),
          note: () => {
            throw new Error('watcher exited with a durable stop')
          },
        }),
        /watcher exited with a durable stop/,
      )
      assert.ok(!(await readdir(dir)).includes('closing.json'))
    },
  )

  // Act
  const plan = controlTrial(
    root,
    options.id,
    'plan-stop',
    undefined,
    async () => sample(clock),
    now,
  )
  await assert.rejects(plan, /Do not stop the VM/)

  // Assert
  checkPreparation()
  const end = JSON.parse(await readFile(join(dir, 'end.json'), 'utf8'))
  assert.equal(end.outcome, 'unexpected-stop')
  assert.deepEqual(end.stopEvidence.stopped, { from: at(3), to: at(3) })
  assert.equal((await reportTrials(root)).trials[0].outcome, 'unexpected-stop')
})

test('a past stopped-only reading, transport failure and pending probe allow a fresh stop plan after the guest starts', async (t) => {
  // Arrange
  const { root, put, at, start } = await startedTrial(t)
  await put('sample-slot-1.json', sample(start + 1000, 'stopped', null))
  await put('sample-slot-2.json', sample(start + 2000, 'running', false))
  await put('pending-abcd.json', { expiresAt: Date.now() + 30_000 })

  // Act
  const plan = await controlTrial(
    root,
    options.id,
    'plan-stop',
    undefined,
    async () => sample(start + 3000),
    () => start + 3000,
  )

  // Assert
  assert.equal(plan.at, at(3))
})

for (const plannerExits of [false, true]) {
  test(`a second process cannot publish a stop inside the grant decision, including when the planner ${plannerExits ? 'exits' : 'commits'}`, async (t) => {
    // Arrange: the watcher has already entered the stopped-state probe while the planner sees a running VM.
    const { root, put, at, start } = await startedTrial(t)
    await put('sample-slot-0.json', sample(start))
    const { DatabaseSync } = await import('node:sqlite')
    const probing = Promise.withResolvers(),
      deliverStop = Promise.withResolvers()
    const releasePath = join(root, 'release-grant')
    let child
    const releasePlanner = () => {
      if (plannerExits) child.kill('SIGKILL')
      else writeFileSync(releasePath, '')
    }
    const exec = DatabaseSync.prototype.exec
    let sawLockOwner = false
    t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
      try {
        return exec.call(this, sql)
      } catch (error) {
        // The observation attempted its publication while the other PID was about to link the grant.
        if (error.errcode === 5 && !sawLockOwner) {
          sawLockOwner = true
          releasePlanner()
        }
        throw error
      }
    })
    const watcher = assert.rejects(
      watchTrial(root, options, {
        now: () => start + 3000,
        sample: async () => {
          probing.resolve()
          await deliverStop.promise
          return sample(start + 3000, 'stopped', null)
        },
        note: () => {
          if (!sawLockOwner) releasePlanner()
          throw new Error('watcher exited after durable publication')
        },
      }),
      /watcher exited after durable publication/,
    )
    await probing.promise
    // The child stops just before the actual link syscall. Its own bounded wait also terminates if the parent exits.
    const source = `
      import fs from 'node:fs'
      import {syncBuiltinESMExports} from 'node:module'
      import {join} from 'node:path'
      const [module, root, id, time, running] = process.argv.slice(1)
      const link = fs.linkSync
      fs.linkSync = function (from, to) {
        if (to === join(root, id, 'plan-stop-authorization.json')) {
          fs.writeSync(1, 'at-grant-link\\n')
          const sleeper = new Int32Array(new SharedArrayBuffer(4))
          const deadline = Date.now() + 15000
          while (!fs.existsSync(join(root, 'release-grant'))) {
            if (Date.now() >= deadline) throw new Error('parent did not observe publication')
            Atomics.wait(sleeper, 0, 0, 10)
          }
          fs.writeSync(1, JSON.stringify({pid:process.pid, stoppedBeforeGrant:fs.existsSync(join(root, id, 'sample-slot-3.json'))})+'\\n')
        }
        return link(from, to)
      }
      syncBuiltinESMExports()
      const {controlTrial} = await import(module)
      await controlTrial(root, id, 'plan-stop', undefined, async () => JSON.parse(running), () => Number(time))
    `
    const planner = promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        source,
        new URL('../utils/nativeTrialJournal.mjs', import.meta.url).href,
        root,
        options.id,
        String(start + 1000),
        JSON.stringify(sample(start + 1000)),
      ],
      { timeout: 20000 },
    )
    child = planner.child
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('at-grant-link')) deliverStop.resolve()
    })

    // Act
    let output
    try {
      if (plannerExits) await assert.rejects(planner, { signal: 'SIGKILL' })
      else output = (await planner).stdout
    } finally {
      deliverStop.resolve()
      await watcher
    }
    const finish = await controlTrial(
      root,
      options.id,
      'finish',
      'unknown',
      () => assert.fail('the stop was already recorded'),
      () => start + 4000,
    )

    // Assert
    if (!plannerExits) {
      const order = JSON.parse(output.trim().split('\n').at(-1))
      assert.notEqual(order.pid, process.pid)
      assert.equal(
        order.stoppedBeforeGrant,
        false,
        'an already published stop must prevent the planner from granting shutdown',
      )
    }
    assert.equal(sawLockOwner, true)
    assert.equal(finish.outcome, plannerExits ? 'unexpected-stop' : 'unknown')
    assert.deepEqual(finish.stopEvidence.stopped, { from: at(3), to: at(3) })
    assert.equal((await reportTrials(root)).groups[0].counts['planned-stop'], 0)
  })
}
