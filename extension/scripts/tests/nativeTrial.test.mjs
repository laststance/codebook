import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
      await after()
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
  const clock = { at: Date.now() }
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
        controlTrial(root, other.id, 'finish', 'disconnected', async () =>
          sample(clock.at, 'running', false),
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
  const clock = { at: Date.now() }
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
            controlTrial(root, options.id, 'finish', 'healthy', async () =>
              sample(clock.at, 'unknown', null),
            ),
            /running and reachable/,
          )
          assert.equal(
            (await reportTrials(root)).trials[0].outcome,
            'incomplete',
          )
        } else
          await controlTrial(root, options.id, 'finish', 'healthy', async () =>
            sample(clock.at),
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
    const start = Date.now()
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
              await controlTrial(root, id, 'finish', 'healthy', async () =>
                sample(c.at),
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
      controlTrial(
        root,
        options.id,
        'plan-stop',
        undefined,
        async () => sample(start + 1200, 'unknown', null),
        () => start + 1200,
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
    await mkdir(dir)
    await writeFile(join(dir, 'trial.json'), JSON.stringify(options))
    const first = join(dir, 'sample-slot-0.json')
    await writeFile(first, JSON.stringify(sample(Date.now())))
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
      controlTrial(
        root,
        options.id,
        'plan-stop',
        undefined,
        async () => sample(start + 300, 'stopped', null),
        () => start + 200,
      ),
  )

  // Act
  const ended = await watchTrial(root, options, seams)

  // Assert
  assert.equal(ended.outcome, 'unknown')
})

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
    // Observe either durable closing claim; on the old implementation end.json commits prematurely.
    for (let n = 0; n < 200; n++) {
      const ready = await Promise.all(
        ['closing.json', 'end.json'].map(async (name) =>
          readFile(join(root, options.id, name)).then(
            () => true,
            () => false,
          ),
        ),
      )
      if (ready.some(Boolean)) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
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
