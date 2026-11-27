import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { readNativeTrialSample } from './nativeTrialSample.mjs'

const SLUG = /^[a-z0-9][a-z0-9_-]{0,71}$/i
// Guest inventory and guest measurements each allow up to 12 seconds. Leave time to publish their evidence.
const PROBE_LEASE_MS = 30_000

const OUTCOMES = [
  'healthy',
  'unexpected-stop',
  'planned-stop',
  'observer-timeout',
  'disconnected',
  'observer-interrupted',
  'unknown',
  'incomplete',
]

function slug(value, label) {
  if (!SLUG.test(value ?? ''))
    throw new Error(
      `Invalid ${label}. Use 1–72 letters, digits, underscores or hyphens.`,
    )
  return value
}

function integer(value, low, high, label) {
  if (
    !/^\d+$/.test(String(value)) ||
    Number(value) < low ||
    Number(value) > high
  )
    throw new Error(`${label} must be an integer between ${low} and ${high}.`)
  return Number(value)
}

async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Publish one complete, synced host record. An existing record wins even if two readers finish together.
 * @example await publish(trialDir, 'end.json', { outcome: 'healthy' })
 */
async function publish(dir, name, record) {
  const tmp = join(dir, `.writing-${randomUUID()}`)
  const file = await open(tmp, 'wx', 0o600)
  try {
    try {
      await file.writeFile(JSON.stringify(record) + '\n')
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      await link(tmp, join(dir, name))
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      return readRecord(join(dir, name))
    }
    const directory = await open(dir, 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
    return record
  } finally {
    await unlink(tmp)
  }
}

async function history(dir) {
  const names = (await readdir(dir))
    .filter((n) =>
      /^(sample-(slot-\d+|\d+-[\da-f-]+)|observation-[\da-f-]+)\.json$/.test(n),
    )
    .sort()
  // The maximum trial has 7,200 slots. Keep one file open at a time, independent of trial length.
  const records = []
  for (const name of names) records.push(await readRecord(join(dir, name)))
  return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/**
 * Retains signed page-counter changes. A decrease indicates a reset or discontinuity; its signed rate is not a paging rate.
 * @example swapoutChange(first, next, 'host')
 */
export function swapoutChange(previous, sample, side) {
  if (!previous) return null
  const before = previous[side]
  const after = sample[side]
  const since = counterAt(previous, side)
  const seconds =
    (Date.parse(counterAt(sample, side)) - Date.parse(since)) / 1000
  if (
    !(seconds > 0) ||
    !Number.isSafeInteger(before?.pageSize) ||
    before.pageSize <= 0 ||
    before.pageSize !== after?.pageSize ||
    !Number.isSafeInteger(before?.swapouts) ||
    before.swapouts < 0 ||
    !Number.isSafeInteger(after?.swapouts) ||
    after.swapouts < 0
  )
    return null
  const pages = after.swapouts - before.swapouts
  return {
    since,
    seconds,
    pages,
    pagesPerSecond: pages / seconds,
    counterDecreased: pages < 0,
  }
}

/** Per-counter timestamp on new records, with the original sample clock retained for older journals. */
function counterAt(row, side) {
  return readingAt(row, side, 'swapoutsObservedAt')
}

/** An explicit null means the measurement time is unknown; only records predating that field use completion time. */
function readingAt(row, side, field) {
  const reading = row[side]
  return reading && Object.hasOwn(reading, field) ? reading[field] : row.at
}

/**
 * Announce a probe before starting it, then publish its raw facts before releasing its reservation.
 * The closing claim fences new probes. An overlapping slot contributes one workload sample, while an
 * independent observation that lost publication of the slot still contributes its own state and counters.
 * @example await observe(dir, readNativeTrialSample, {slot: 1}, deadline, Date.now)
 */
async function observe(dir, collect, { slot, afterPlanAt }, deadline, now) {
  const id = randomUUID()
  const name = `pending-${id}.json`
  try {
    // A link can stand even if syncing its directory then fails. Release this reservation on either result.
    await publish(dir, name, { expiresAt: Date.now() + PROBE_LEASE_MS })
    if (
      now() >= deadline ||
      (await readRecord(join(dir, 'closing.json'))) ||
      (await readRecord(join(dir, 'end.json')))
    )
      return null
    const row = await collect()
    if (!afterPlanAt) {
      const key =
        slot === undefined ? `${Date.parse(row.at)}-${id}` : `slot-${slot}`
      const winner = await publish(dir, `sample-${key}.json`, row)
      if (winner === row) return row
    }
    // Wait for directory sync before releasing the pending observation to a concurrent finisher.
    return await publish(dir, `observation-${id}.json`, {
      ...row,
      additionalObservation: true,
      ...(afterPlanAt ? { afterPlanAt } : {}),
    })
  } finally {
    await unlink(join(dir, name)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/** Reads an inventory interval, falling back to the host timestamp only for legacy point readings. */
function stateWindow(observation, legacyAt, deadline) {
  const { stateObservedFrom, stateObservedTo } = observation
  const legacy =
    stateObservedFrom === undefined && stateObservedTo === undefined
  const from = Date.parse(legacy ? legacyAt : stateObservedFrom)
  const to = Date.parse(legacy ? legacyAt : stateObservedTo)
  return from <= to && to <= deadline ? { from, to } : null
}

/** Keeps the two host-clock bounds visible in the terminal record and its report. */
function isoWindow({ from, to }) {
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

/**
 * Recover the earliest provable running-to-stopped transition from durable samples before closing a trial.
 * A guest inventory query brackets the observation. Older samples provide only their original point timestamp.
 * @example await recordedStop(dir, rows, Date.parse(trial.deadline))
 */
async function recordedStop(dir, rows, deadline) {
  const running = []
  const stopped = []
  for (const row of rows) {
    const { state, initialRunningObservation } = row.guest
    // A failed guest probe can contain two real inventory reads: the initial running state and the recheck.
    if (initialRunningObservation) {
      const initial = stateWindow(
        initialRunningObservation,
        undefined,
        deadline,
      )
      if (initial) running.push({ ...initial, afterPlanAt: row.afterPlanAt })
    }
    const observed = stateWindow(row.guest, row.at, deadline)
    if (!observed) continue
    if (state === 'running')
      running.push({ ...observed, afterPlanAt: row.afterPlanAt })
    else if (state === 'stopped') stopped.push({ row, ...observed })
  }
  const earliestRunning = running.reduce(
    (earliest, r) => Math.min(earliest, r.to),
    Infinity,
  )
  const first = stopped
    .filter((s) => earliestRunning < s.from)
    .sort((a, b) => a.to - b.to)[0]
  if (!first) return null

  const beforeStop = running
    .filter((r) => r.to < first.from)
    .sort((a, b) => b.to - a.to)
  const intent = await readRecord(join(dir, 'plan-stop.json'))
  let witness = beforeStop[0]
  let outcome = 'unexpected-stop'
  if (intent) {
    const plannedAt = Date.parse(intent.at)
    // Only this plan's own post-publication observation establishes that the VM was still running after the intent stood.
    const afterPlan = beforeStop.find(
      (r) => r.afterPlanAt === intent.at && plannedAt <= r.from,
    )
    if (afterPlan) {
      witness = afterPlan
      outcome = 'planned-stop'
    } else if (!(plannedAt > first.to)) outcome = 'unknown'
  }
  return {
    outcome,
    at: first.row.at,
    sampleAt: first.row.at,
    stopEvidence: { running: isoWindow(witness), stopped: isoWindow(first) },
  }
}

/**
 * Seal admission, wait for previously admitted probes, then derive the terminal record from all durable evidence.
 * Every finisher uses the same immutable claim, including anyone resuming after the first closer was interrupted.
 * A missing observer has a bounded lease. Its incomplete evidence cannot prove a healthy completion or a timeout.
 * @example await closeObserver(dir, 'observer-timeout', clock(), deadline)
 */
async function closeObserver(dir, fallback, at, deadline, sampleAt) {
  const claim = await publish(dir, 'closing.json', {
    outcome: fallback,
    at,
    sampleAt: sampleAt ?? null,
  })
  let incomplete = false
  const limit = Date.now() + PROBE_LEASE_MS
  while (true) {
    const existing = await readRecord(join(dir, 'end.json'))
    if (existing) return existing
    const names = (await readdir(dir)).filter((name) =>
      /^pending-[\da-f-]+\.json$/.test(name),
    )
    let waiting = false
    for (const name of names) {
      const probe = await readRecord(join(dir, name))
      if (!probe) continue
      if (Date.now() < Math.min(probe.expiresAt, limit)) waiting = true
      else incomplete = true
    }
    if (!waiting) break
    await delay(20)
  }
  const rows = await history(dir)
  const stopped = await recordedStop(dir, rows, deadline)
  const final = stopped ?? {
    ...claim,
    ...(incomplete
      ? { outcome: 'unknown', reason: 'incomplete-observation' }
      : {}),
    sampleAt: claim.sampleAt ?? rows.at(-1)?.at ?? null,
  }
  return publish(dir, 'end.json', final)
}

/**
 * Create or resume a bounded watch. Private immutable files preserve completed samples and the first terminal outcome.
 * @example await watchTrial(root, { id: 'c151-devin', profile: 'vm-only', cycle: 151, interval: 10, duration: 1200 })
 */
export async function watchTrial(
  root,
  options,
  {
    sample = readNativeTrialSample,
    now = Date.now,
    sleep = delay,
    signal,
    note = () => {},
  } = {},
) {
  const { id, cycle, profile, interval = 10, duration = 1200 } = options
  const dir = join(root, slug(id, 'trial id'))
  const declaration = {
    id,
    cycle: integer(cycle, 1, 999999, 'cycle'),
    profile: slug(profile, 'profile'),
    interval: integer(interval, 1, 600, 'interval'),
    duration: integer(duration, 1, 7200, 'duration'),
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const at = now()
  const trial = await publish(dir, 'trial.json', {
    ...declaration,
    schema: 1,
    space: 'local:codebook-qa',
    started: new Date(at).toISOString(),
    deadline: new Date(at + declaration.duration * 1000).toISOString(),
  })
  for (const [key, value] of Object.entries(declaration)) {
    if (trial[key] !== value)
      throw new Error(
        `Trial ID already records another ${key}. Use its original arguments or a fresh ID.`,
      )
  }
  const alreadyEnded = await readRecord(join(dir, 'end.json'))
  if (alreadyEnded) return alreadyEnded
  const rows = await history(dir)
  let sawRunning = rows.some(
    (row) =>
      row.guest.state === 'running' || row.guest.initialRunningObservation,
  )
  const started = Date.parse(trial.started)
  const deadline = Date.parse(trial.deadline)
  const clock = () => new Date(now()).toISOString()
  const recovered = await recordedStop(dir, rows, deadline)
  if (recovered)
    return closeObserver(
      dir,
      recovered.outcome,
      recovered.at,
      deadline,
      recovered.sampleAt,
    )
  while (true) {
    const existing = await readRecord(join(dir, 'end.json'))
    if (existing) return existing
    if (await readRecord(join(dir, 'closing.json')))
      return closeObserver(dir, 'unknown', clock(), deadline)
    if (signal?.aborted)
      return closeObserver(dir, 'observer-interrupted', clock(), deadline)
    if (now() >= deadline)
      return closeObserver(dir, 'observer-timeout', clock(), deadline)
    const slot = Math.floor((now() - started) / (declaration.interval * 1000))
    // Retries and overlapping observers share a single durable sample per scheduled interval.
    const recorded = await readRecord(join(dir, `sample-slot-${slot}.json`))
    const row =
      recorded ?? (await observe(dir, sample, { slot }, deadline, now))
    if (!row) return closeObserver(dir, 'observer-timeout', clock(), deadline)
    note({
      id,
      at: row.at,
      guest: row.guest.state,
      reachable: row.guest.reachable,
      workloads: row.host.workloads,
    })
    if (!recorded || rows.at(-1)?.at !== row.at) rows.push(row)
    if (row.guest.state === 'running' || row.guest.initialRunningObservation)
      sawRunning = true
    if (
      (sawRunning || row.additionalObservation) &&
      row.guest.state === 'stopped'
    ) {
      const stopped = await recordedStop(dir, await history(dir), deadline)
      if (stopped)
        return closeObserver(
          dir,
          stopped.outcome,
          stopped.at,
          deadline,
          stopped.sampleAt,
        )
    }
    // The signal and deadline bound the observer without changing or interrupting the workload it watches.
    try {
      await sleep(
        Math.max(0, Math.min(declaration.interval * 1000, deadline - now())),
        undefined,
        { signal },
      )
    } catch (error) {
      if (error.name !== 'AbortError') throw error
    }
  }
}

/**
 * Close a trial based on an observed VM state and the operator's completion report, or record intent to stop.
 * @example await controlTrial(root, 'c151-devin', 'finish', 'healthy')
 */
export async function controlTrial(
  root,
  id,
  command,
  outcome,
  sample = readNativeTrialSample,
  now = Date.now,
) {
  const dir = join(root, slug(id, 'trial id'))
  const trial = await readRecord(join(dir, 'trial.json'))
  if (!trial) throw new Error('No trial with that ID. Start watch first.')
  const ended = await readRecord(join(dir, 'end.json'))
  const at = new Date(now()).toISOString()
  const deadline = Date.parse(trial.deadline)
  if (command === 'plan-stop') {
    if (
      !ended &&
      Date.parse(at) < deadline &&
      !(await readRecord(join(dir, 'closing.json')))
    ) {
      const intent = await publish(dir, 'plan-stop.json', { at })
      // Admission can close between the intent and its observation.
      if (await observe(dir, sample, { afterPlanAt: intent.at }, deadline, now))
        return intent
    }
    throw new Error(
      'The trial can no longer observe this stop plan. Do not stop the VM under this trial.',
    )
  }
  if (ended) return ended
  if (!['healthy', 'disconnected', 'unknown'].includes(outcome))
    throw new Error('Expected outcome healthy, disconnected or unknown.')
  const rows = await history(dir)
  const recovered = await recordedStop(dir, rows, deadline)
  if (recovered)
    return closeObserver(
      dir,
      recovered.outcome,
      recovered.at,
      deadline,
      recovered.sampleAt,
    )
  if (Date.parse(at) >= deadline)
    return closeObserver(dir, 'observer-timeout', at, deadline)
  const row = await observe(dir, sample, {}, deadline, now)
  if (!row) return closeObserver(dir, 'observer-timeout', at, deadline)
  // Finishing must also honor a stop another observer committed while this fresh probe was in flight.
  const stopped = await recordedStop(dir, await history(dir), deadline)
  if (stopped)
    return closeObserver(
      dir,
      stopped.outcome,
      stopped.at,
      deadline,
      stopped.sampleAt,
    )
  if (Date.parse(row.at) > deadline)
    return closeObserver(dir, 'observer-timeout', row.at, deadline, row.at)
  if (
    outcome === 'healthy' &&
    !(row.guest.state === 'running' && row.guest.reachable === true)
  )
    throw new Error(
      'Healthy completion requires a fresh running and reachable guest.',
    )
  if (outcome === 'disconnected' && row.guest.reachable !== false)
    throw new Error(
      'Disconnection requires a failed guest probe while its running state is confirmed. Use unknown for unavailable inventory.',
    )
  return closeObserver(dir, outcome, row.at, deadline, row.at)
}

function countsByOutcome() {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]))
}

/**
 * Describe the sizes the guest itself reported during a trial. Older records have no RAM measurement.
 * @example observedGuestMemory([{ guest: { memoryBytes: 17179869184 } }])
 */
function observedGuestMemory(samples) {
  const measured = samples
    .map((row) => row.guest?.memoryBytes)
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  const sizes = [...new Set(measured)].sort((a, b) => a - b)
  return {
    guestMemoryBytes: sizes.length === 1 ? sizes[0] : null,
    observedGuestMemoryBytes: sizes,
    guestMemorySamples: measured.length,
  }
}

/**
 * Keeps the largest observed per-kind sum across samples. Distinct peaks may come from different times.
 * @example peakWorkloadRss([{host:{rssMiBByKind:{tsc:128}}}])
 */
function peakWorkloadRss(samples) {
  const peaks = {}
  let measured = 0
  for (const { host } of samples) {
    if (!host.rssMiBByKind) continue
    measured++
    for (const [kind, value] of Object.entries(host.rssMiBByKind)) {
      if (Number.isFinite(value) && (value > 0 || host.workloads?.[kind] > 0))
        peaks[kind] = Math.max(peaks[kind] ?? 0, value)
    }
  }
  return {
    peakHostRssMiBByKind: measured ? peaks : null,
    hostRssSamples: measured,
  }
}

/**
 * Group every recorded trial by declared profile and actual workload kinds so both successes and failures have denominators.
 * @example const { trials, groups } = await reportTrials(root)
 */
export async function reportTrials(root) {
  let dirs
  try {
    dirs = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return { trials: [], groups: [] }
    throw error
  }
  const trials = []
  const groups = new Map()
  for (const entry of dirs
    .filter((d) => d.isDirectory() && SLUG.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = join(root, entry.name)
    const trial = await readRecord(join(dir, 'trial.json'))
    if (!trial) continue
    const ended = await readRecord(join(dir, 'end.json'))
    const rows = await history(dir)
    // Older terminal files named their stopped sample without storing its inventory interval.
    let stopEvidence = ended?.stopEvidence
    if (
      ended?.sampleAt &&
      !stopEvidence &&
      ['unexpected-stop', 'planned-stop', 'unknown'].includes(ended.outcome)
    ) {
      const stop = await recordedStop(dir, rows, Date.parse(trial.deadline))
      if (stop?.sampleAt === ended.sampleAt) stopEvidence = stop.stopEvidence
    }
    const cutoff = ended
      ? Date.parse(stopEvidence?.stopped.to ?? ended.at)
      : Infinity
    const within = (timestamp) => Date.parse(timestamp) <= cutoff
    const regular = rows.filter((row) => !row.additionalObservation)
    // With no per-metric clock in an older journal, only its completion time bounds the reading.
    const hostSamples = regular.filter((row) =>
      within(readingAt(row, 'host', 'workloadsObservedAt')),
    )
    const guestSamples = regular.filter((row) =>
      within(readingAt(row, 'guest', 'measurementsObservedAt')),
    )
    const counted = new Set([...hostSamples, ...guestSamples])
    for (const row of regular) {
      if (
        stateWindow(row.guest, row.at, cutoff) ||
        (row.guest.initialRunningObservation &&
          stateWindow(
            row.guest.initialRunningObservation,
            undefined,
            cutoff,
          )) ||
        ['host', 'guest'].some(
          (side) =>
            Number.isSafeInteger(row[side]?.swapouts) &&
            within(counterAt(row, side)),
        )
      )
        counted.add(row)
    }
    const peaks = {}
    const combinations = new Set()
    for (const { host } of hostSamples) {
      if (host.workloads === null) {
        combinations.add('unknown')
        continue
      }
      const active = []
      for (const [kind, count] of Object.entries(host.workloads)) {
        if (count > 0) {
          active.push(kind)
          peaks[kind] = Math.max(count, peaks[kind] ?? 0)
        }
      }
      combinations.add(active.sort().join('+') || 'none')
    }
    if (!hostSamples.length) combinations.add('unknown')
    const observedCombinations = [...combinations].sort()
    const observed = observedCombinations.join(' | ')
    const pressures = [
      ...new Set(hostSamples.map((s) => s.host.memoryPressure)),
    ].sort()
    const swap = hostSamples
      .map((s) => s.host.usedSwapMb)
      .filter(Number.isFinite)
    const guestMemory = observedGuestMemory(guestSamples)
    const guestSwap = guestSamples
      .map((s) => s.guest?.usedSwapMb)
      .filter(Number.isFinite)
    const guestPressures = [
      ...new Set(guestSamples.map((s) => s.guest?.memoryPressure ?? 'unknown')),
    ].sort()
    const outcome = ended?.outcome ?? 'incomplete'
    const pagingIntervals = {}
    for (const side of ['host', 'guest']) {
      // A late publication can precede an already-written counter. Reconstruct adjacent deltas from immutable absolute values.
      const counters = rows
        .filter(
          (row) =>
            Number.isSafeInteger(row[side]?.swapouts) &&
            within(counterAt(row, side)),
        )
        .sort(
          (a, b) =>
            Date.parse(counterAt(a, side)) - Date.parse(counterAt(b, side)),
        )
      pagingIntervals[side] = counters
        .slice(1)
        .map((row, i) => swapoutChange(counters[i], row, side))
        .filter(Boolean)
    }
    const hostRates = pagingIntervals.host
    const pagingRates = hostRates.filter(
      (s) =>
        !s.counterDecreased &&
        Number.isFinite(s.pagesPerSecond) &&
        s.pagesPerSecond >= 0,
    )
    const pressureChanges = {
      peakHostSwapoutPagesPerSecond: pagingRates.length
        ? Math.max(...pagingRates.map((s) => s.pagesPerSecond))
        : null,
      hostCounterDecreases: hostRates.filter((s) => s.counterDecreased).length,
    }
    const record = {
      ...pressureChanges,
      pagingIntervals,
      ...guestMemory,
      ...peakWorkloadRss(hostSamples),
      stopEvidence: stopEvidence ?? null,
      guestPressures,
      minGuestUsedSwapMb: guestSwap.length ? Math.min(...guestSwap) : null,
      maxGuestUsedSwapMb: guestSwap.length ? Math.max(...guestSwap) : null,
      guestSwapSamples: guestSwap.length,
      id: trial.id,
      cycle: trial.cycle,
      profile: trial.profile,
      observed,
      observedCombinations,
      peakProcesses: peaks,
      outcome,
      samples: counted.size,
      pressures,
      minUsedSwapMb: swap.length ? Math.min(...swap) : null,
      maxUsedSwapMb: swap.length ? Math.max(...swap) : null,
      started: trial.started,
      ended: ended?.at ?? null,
    }
    trials.push(record)
    const key = JSON.stringify([
      trial.profile,
      observedCombinations,
      guestMemory.observedGuestMemoryBytes,
    ])
    const group = groups.get(key) ?? {
      guestMemoryBytes: guestMemory.guestMemoryBytes,
      observedGuestMemoryBytes: guestMemory.observedGuestMemoryBytes,
      profile: trial.profile,
      observed,
      observedCombinations,
      total: 0,
      counts: countsByOutcome(),
      ids: [],
    }
    group.total++
    group.counts[outcome]++
    group.ids.push(trial.id)
    groups.set(key, group)
  }
  return { trials, groups: [...groups.values()] }
}
