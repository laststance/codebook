import assert from 'node:assert/strict'
import { basename } from 'node:path'
import { test } from 'node:test'

import { countProcessKinds } from '../native-precheck.mjs'
import { readNativeTrialSample } from '../utils/nativeTrialSample.mjs'

const at = '2026-11-27T06:00:00.000Z'
const now = () => new Date(at)
const hostVmStat =
  'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nSwapouts:    124.\n'
const guestVmStat =
  'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nSwapouts:     18.\n'

/** Answers only the recorder's four read-only commands with fixtures. @example const { run } = fixtureRunner({ state: 'ready' }) */
function fixtureRunner({
  state = 'Ready',
  precheck = {
    code: 3,
    stdout: JSON.stringify({
      memoryPressure: 'warning',
      swap: { usedMb: 42.5 },
      rssMiBByKind: {
        nodeTest: 183.25,
        tsc: 0,
        health: -1,
        gate: '12',
        unrelatedDetail: 4200,
      },
      processes: {
        ...countProcessKinds([], 0),
        nodeTest: 2,
        unrelatedDetail: 'fixture-private',
      },
    }),
  },
  info = {
    code: 0,
    stdout: JSON.stringify({ state, detail: 'fixture-private' }),
  },
  pages = { code: 0, stdout: hostVmStat },
  exec = {
    code: 0,
    stdout: `codebook-qa-sample\n4\n${guestVmStat}memoryBytes=17179869184\nswapUsage=total = 2.00G  used = 768.50M  free = 1279.50M  (encrypted)\n`,
  },
} = {}) {
  const calls = []
  return {
    calls,
    run: async (program, args) => {
      calls.push([program, args])
      if (
        program === process.execPath &&
        args.length === 2 &&
        basename(args[0]) === 'native-precheck.mjs' &&
        args[1] === '--json'
      )
        return precheck
      if (program === '/usr/bin/vm_stat' && args.length === 0) return pages
      if (
        program === 'cua' &&
        args.join(' ') === 'sandbox info local:codebook-qa --json'
      )
        return info
      if (
        program === 'cua' &&
        args.length === 4 &&
        args.slice(0, 3).join(' ') === 'sb exec local:codebook-qa'
      )
        return exec
      throw new Error('Unexpected sample command')
    },
  }
}

test('a busy host and ready guest report independent absolute counters and only recognized workloads', async () => {
  // Value: protects=per-host counter units and busy precheck readings; fails_when=busy is treated as unreadable, pages are combined, or unrelated metadata is journaled; no_claim=live memory pressure.
  // Arrange
  const { run, calls } = fixtureRunner()

  // Act
  const sample = await readNativeTrialSample({ run, now })

  // Assert
  assert.equal(sample.at, '2026-11-27T06:00:00.000Z')
  assert.equal(sample.host.memoryPressure, 'warning')
  assert.equal(sample.host.usedSwapMb, 42.5)
  assert.equal(sample.host.pageSize, 16384)
  assert.equal(sample.host.swapouts, 124)
  assert.equal(sample.host.workloads.nodeTest, 2)
  assert.equal(sample.host.workloads.tsc, 0)
  assert.deepEqual(sample.host.rssMiBByKind, { nodeTest: 183.25, tsc: 0 })
  assert.equal(Object.hasOwn(sample.host.workloads, 'unrelatedDetail'), false)
  assert.deepEqual(sample.guest, {
    stateObservedFrom: '2026-11-27T06:00:00.000Z',
    stateObservedTo: '2026-11-27T06:00:00.000Z',
    state: 'running',
    reachable: true,
    memoryPressure: 'critical',
    memoryBytes: 17179869184,
    usedSwapMb: 768.5,
    pageSize: 4096,
    swapouts: 18,
    swapoutsObservedAt: at,
    measurementsObservedAt: at,
  })
  assert.equal(JSON.stringify(sample).includes('fixture-private'), false)
  assert.equal(calls.length, 4)
  assert.deepEqual(
    calls
      .filter(([program]) => program === 'cua')
      .map(([, args]) => args.slice(0, 3)),
    [
      ['sandbox', 'info', 'local:codebook-qa'],
      ['sb', 'exec', 'local:codebook-qa'],
    ],
  )
})

test('only an explicit stopped state confirms a stop and skips guest execution', async () => {
  // Value: protects=an unavailable control plane is never reported as an unexpected stop; fails_when=partial matches or failed reads are treated as lifecycle evidence; no_claim=the real guest lifecycle.
  // Arrange
  const cases = [
    [{ code: 0, stdout: '{"state":"Stopped"}' }, 'stopped'],
    [{ code: 0, stdout: '{"state":"stopping"}' }, 'unknown'],
    [{ code: 0, stdout: '{"state":"not running"}' }, 'unknown'],
    [{ code: 0, stdout: '{"state":true}' }, 'unknown'],
    [{ code: 0, stdout: 'not JSON' }, 'unknown'],
    [{ code: 1, stdout: '{"state":"stopped"}' }, 'unknown'],
  ]

  for (const [info, state] of cases) {
    const { run, calls } = fixtureRunner({ info })

    // Act
    const sample = await readNativeTrialSample({ run, now })

    // Assert
    assert.deepEqual(sample.guest, {
      stateObservedFrom: '2026-11-27T06:00:00.000Z',
      stateObservedTo: '2026-11-27T06:00:00.000Z',
      state,
      reachable: null,
      memoryPressure: 'unknown',
      memoryBytes: null,
      usedSwapMb: null,
      pageSize: null,
      swapouts: null,
      swapoutsObservedAt: null,
      measurementsObservedAt: null,
    })
    assert.equal(
      calls.some(([, args]) => args[0] === 'sb'),
      false,
    )
    assert.equal(sample.host.swapouts, 124)
  }
})

test('a running guest distinguishes a failed probe, malformed output and an answering guest with partial measurements', async () => {
  // Value: protects=guest reachability and lifecycle remain separate; fails_when=a failed call becomes a stop or a missing field reads as zero; no_claim=live guest behavior.
  // Arrange
  const cases = [
    [{ code: 2, stdout: 'fixture-private' }, false, 'unknown', null, null],
    [{ code: 0, stdout: 'fixture-private' }, null, 'unknown', null, null],
    [
      { code: 0, stdout: 'codebook-qa-sample\n1\nSwapouts: 0.' },
      true,
      'normal',
      null,
      0,
    ],
    [
      {
        code: 0,
        stdout:
          'codebook-qa-sample\n2\n(page size of 4096 bytes)\nSwapouts: -2.',
      },
      true,
      'warning',
      4096,
      null,
    ],
  ]

  for (const [exec, reachable, memoryPressure, pageSize, swapouts] of cases) {
    const { run } = fixtureRunner({ state: 'Running', exec })

    // Act
    const sample = await readNativeTrialSample({ run, now })

    // Assert
    assert.deepEqual(sample.guest, {
      stateObservedFrom: '2026-11-27T06:00:00.000Z',
      stateObservedTo: '2026-11-27T06:00:00.000Z',
      state: 'running',
      reachable,
      memoryPressure,
      memoryBytes: null,
      usedSwapMb: null,
      pageSize,
      swapouts,
      swapoutsObservedAt: swapouts === null ? null : at,
      measurementsObservedAt: memoryPressure === 'unknown' ? null : at,
      ...(reachable !== true
        ? {
            initialRunningObservation: {
              stateObservedFrom: at,
              stateObservedTo: at,
            },
          }
        : {}),
    })
  }
})

test('unreadable precheck counters stay unknown while independent measurements survive', async () => {
  // Value: protects=unavailable or unsafe counter fields are never stored; fails_when=missing workloads count as idle or exception text reaches the sample; no_claim=real command failure.
  // Arrange
  const { run } = fixtureRunner({
    precheck: {
      code: 0,
      stdout:
        '{"memoryPressure":"fixture-private","swap":{"usedMb":-1},"processes":{"tsc":0}}',
    },
    pages: {
      code: 0,
      stdout: '(page size of 0 bytes)\nSwapouts: 9007199254740993.',
    },
  })
  const missing = async () => {
    throw new Error('fixture-private')
  }

  // Act
  const malformed = await readNativeTrialSample({ run, now })
  const unavailable = await readNativeTrialSample({ run: missing, now })

  // Assert
  const unknownHost = {
    workloadsObservedAt: null,
    memoryPressure: 'unknown',
    usedSwapMb: null,
    workloads: null,
    rssMiBByKind: null,
    pageSize: null,
    swapouts: null,
    swapoutsObservedAt: null,
  }
  assert.deepEqual(malformed.host, unknownHost)
  assert.equal(malformed.guest.reachable, true)
  assert.deepEqual(unavailable.host, unknownHost)
  assert.equal(unavailable.guest.state, 'unknown')
  assert.equal(JSON.stringify(unavailable).includes('fixture-private'), false)
})

test('guest RAM and swap survive independently when one sysctl fails', async () => {
  // Value: protects=trial groups reflect measured guest RAM and swap; fails_when=one failed guest read suppresses the other or unknown becomes zero; no_claim=live sysctl availability.
  // Arrange
  const cases = [
    ['memoryBytes=8589934592\nswapUsage=', 8589934592, null],
    [
      'memoryBytes=\nswapUsage=total = 2.00G  used = 0.25G  free = 1.75G',
      null,
      256,
    ],
    [
      'memoryBytes=9007199254740993\nswapUsage=total = 0.00M  used = 0.00M  free = 0.00M',
      null,
      0,
    ],
    ['memoryBytes=0\nswapUsage=unavailable', null, null],
  ]
  for (const [readings, memoryBytes, usedSwapMb] of cases) {
    const { run, calls } = fixtureRunner({
      exec: {
        code: 1,
        stdout: `codebook-qa-sample\n2\n${guestVmStat}${readings}\n`,
      },
    })

    // Act
    const { guest } = await readNativeTrialSample({ run, now })

    // Assert
    assert.equal(guest.memoryBytes, memoryBytes)
    assert.equal(guest.usedSwapMb, usedSwapMb)
    assert.equal(guest.swapouts, 18)
    assert.equal(guest.reachable, true)
    const guestCalls = calls.filter(([, args]) => args[0] === 'sb')
    assert.equal(guestCalls.length, 1)
    assert.match(guestCalls[0][1][3], /sysctl -n hw\.memsize/)
    assert.match(guestCalls[0][1][3], /sysctl -n vm\.swapusage/)
  }
})

test('the state evidence brackets only its provider query and the sample timestamp follows the last measurement', async () => {
  // Arrange
  const base = Date.parse('2026-11-27T06:00:00Z')
  let offset = 1000
  const fixture = fixtureRunner()
  const run = async (program, args) => {
    if (program === 'cua' && args[0] === 'sandbox') offset = 3700
    if (program === 'cua' && args[0] === 'sb') offset = 6400
    return fixture.run(program, args)
  }

  // Act
  const sample = await readNativeTrialSample({
    run,
    now: () => new Date(base + offset),
  })

  // Assert
  assert.equal(sample.guest.stateObservedFrom, '2026-11-27T06:00:01.000Z')
  assert.equal(sample.guest.stateObservedTo, '2026-11-27T06:00:03.700Z')
  assert.equal(sample.at, '2026-11-27T06:00:06.400Z')
})

test('host and guest paging readings keep their own times while slower probes finish', async () => {
  // Arrange
  const start = Date.parse(at)
  let elapsed = 0
  const guestGate = Promise.withResolvers()
  const hostPrecheckGate = Promise.withResolvers()
  const fixture = fixtureRunner()
  const run = async (program, args) => {
    if (program === 'cua' && args[0] === 'sb') await guestGate.promise
    if (program === process.execPath) await hostPrecheckGate.promise
    return fixture.run(program, args)
  }

  // Act
  const first = await readNativeTrialSample({ run: fixture.run, now })
  elapsed = 10_000
  const secondReading = readNativeTrialSample({
    run,
    now: () => new Date(start + elapsed),
  })
  // Let the unblocked host page query finish at ten seconds before releasing the guest.
  await new Promise((resolve) => setImmediate(resolve))
  elapsed = 20_000
  guestGate.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  elapsed = 30_000
  hostPrecheckGate.resolve()
  const second = await secondReading

  // Assert
  assert.equal(first.host.swapoutsObservedAt, '2026-11-27T06:00:00.000Z')
  assert.equal(first.guest.swapoutsObservedAt, '2026-11-27T06:00:00.000Z')
  assert.equal(second.host.swapoutsObservedAt, '2026-11-27T06:00:10.000Z')
  assert.equal(second.guest.swapoutsObservedAt, '2026-11-27T06:00:20.000Z')
  assert.equal(second.at, '2026-11-27T06:00:30.000Z')
})

test('a failed guest connection uses a fresh inventory state and its own observation interval', async () => {
  // Arrange
  const start = Date.parse(at)
  for (const [info, state, reachable] of [
    [{ code: 0, stdout: '{"state":"Stopped"}' }, 'stopped', null],
    [{ code: 0, stdout: '{"state":"Ready"}' }, 'running', false],
    [{ code: 1, stdout: 'fixture-private' }, 'unknown', null],
  ]) {
    const fixture = fixtureRunner()
    let elapsed = 0,
      inventories = 0
    const run = async (program, args) => {
      if (program === 'cua' && args[0] === 'sandbox') {
        if (++inventories === 2) {
          elapsed = 900
          return info
        }
        elapsed = 200
      }
      if (program === 'cua' && args[0] === 'sb') {
        elapsed = 650
        return { code: 2, stdout: 'fixture-private' }
      }
      return fixture.run(program, args)
    }

    // Act
    const result = await readNativeTrialSample({
      run,
      now: () => new Date(start + elapsed),
    })

    // Assert
    assert.equal(inventories, 2)
    assert.equal(result.guest.state, state)
    assert.deepEqual(result.guest.initialRunningObservation, {
      stateObservedFrom: '2026-11-27T06:00:00.000Z',
      stateObservedTo: '2026-11-27T06:00:00.200Z',
    })
    assert.equal(result.guest.reachable, reachable)
    assert.equal(result.guest.stateObservedFrom, '2026-11-27T06:00:00.650Z')
    assert.equal(result.guest.stateObservedTo, '2026-11-27T06:00:00.900Z')
    assert.equal(result.guest.measurementsObservedAt, null)
    assert.equal(JSON.stringify(result).includes('fixture-private'), false)
  }
})

test('observer timeouts and spawn errors leave reachability unknown on a confirmed running guest', async () => {
  // Arrange
  for (const [failure, reason] of [
    [
      Object.assign(new Error('fixture-private'), {
        killed: true,
        signal: 'SIGKILL',
        code: null,
      }),
      'timeout',
    ],
    [
      Object.assign(new Error('fixture-private'), { code: 'ENOENT' }),
      'execution-error',
    ],
  ]) {
    const fixture = fixtureRunner()
    const run = async (program, args) => {
      if (program === 'cua' && args[0] === 'sb') throw failure
      return fixture.run(program, args)
    }

    // Act
    const result = await readNativeTrialSample({ run, now })

    // Assert
    assert.equal(result.guest.state, 'running')
    assert.equal(result.guest.reachable, null)
    assert.equal(result.guest.observerFailure, reason)
    assert.equal(JSON.stringify(result).includes('fixture-private'), false)
  }
})

test('host precheck and guest telemetry keep the time of each command response', async () => {
  // Arrange
  const fixture = fixtureRunner(),
    start = Date.parse(at)
  const host = Promise.withResolvers(),
    guest = Promise.withResolvers()
  let elapsed = 0
  const run = async (program, args) => {
    if (program === process.execPath) await host.promise
    if (program === 'cua' && args[0] === 'sb') await guest.promise
    return fixture.run(program, args)
  }

  // Act
  const reading = readNativeTrialSample({
    run,
    now: () => new Date(start + elapsed),
  })
  await new Promise((resolve) => setImmediate(resolve))
  elapsed = 1000
  host.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  elapsed = 3000
  guest.resolve()
  const result = await reading

  // Assert
  assert.equal(result.host.workloadsObservedAt, '2026-11-27T06:00:01.000Z')
  assert.equal(result.guest.measurementsObservedAt, '2026-11-27T06:00:03.000Z')
})

test('the confirmation shares the original sampling budget and exhausted time cannot establish a stopped or disconnected guest', async () => {
  // Arrange
  const fixture = fixtureRunner(),
    start = Date.parse(at)
  const commands = []
  let elapsed = 0
  const run = async (program, args, timeout) => {
    if (program === 'cua') {
      commands.push([args[0], timeout])
      if (args[0] === 'sandbox') elapsed = 12000
      else {
        elapsed = 24000
        return { code: 2, stdout: '' }
      }
    }
    return fixture.run(program, args)
  }

  // Act
  const result = await readNativeTrialSample({
    run,
    now: () => new Date(start + elapsed),
    elapsed: () => elapsed,
  })

  // Assert
  assert.deepEqual(commands, [
    ['sandbox', 12000],
    ['sb', 12000],
  ])
  assert.equal(result.guest.state, 'unknown')
  assert.equal(result.guest.stateObservedFrom, null)
  assert.equal(result.guest.stateObservedTo, null)
  assert.equal(result.guest.reachable, null)
  assert.equal(result.guest.observerFailure, 'timeout')
  assert.equal(
    result.guest.initialRunningObservation.stateObservedTo,
    '2026-11-27T06:00:12.000Z',
  )
})
