import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

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
  assert.deepEqual(last.change.host, {
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
      () => controlTrial(root, options.id, 'plan-stop'),
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
