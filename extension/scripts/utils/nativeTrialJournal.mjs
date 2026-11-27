import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { readNativeTrialSample } from './nativeTrialSample.mjs'

const SLUG = /^[a-z0-9][a-z0-9_-]{0,71}$/i
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
    .filter((n) => /^sample-(slot-\d+|\d+-[\da-f-]+)\.json$/.test(n))
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
  const seconds = (Date.parse(sample.at) - Date.parse(previous.at)) / 1000
  const before = previous[side]
  const after = sample[side]
  if (
    !(seconds > 0) ||
    !Number.isSafeInteger(before?.swapouts) ||
    !Number.isSafeInteger(after?.swapouts)
  )
    return null
  const pages = after.swapouts - before.swapouts
  return {
    since: previous.at,
    seconds,
    pages,
    pagesPerSecond: pages / seconds,
    counterDecreased: pages < 0,
  }
}

async function observe(dir, records, sample, slot) {
  const latest = records.at(-1)
  const row = {
    ...sample,
    change: {
      host: swapoutChange(latest, sample, 'host'),
      guest: swapoutChange(latest, sample, 'guest'),
    },
  }
  const key =
    slot === undefined
      ? `${Date.parse(row.at)}-${randomUUID()}`
      : `slot-${slot}`
  return publish(dir, `sample-${key}.json`, row)
}

async function end(dir, outcome, at, sampleAt) {
  return publish(dir, 'end.json', { outcome, at, sampleAt: sampleAt ?? null })
}

/**
 * Recover the earliest provable running-to-stopped transition from durable samples before closing a trial.
 * A guest inventory query brackets the observation. Older samples provide only their original point timestamp.
 * @example await settleRecordedStop(dir, rows, Date.parse(trial.deadline))
 */
async function settleRecordedStop(dir, rows, deadline) {
  let earliestRunning = Infinity
  const stopped = []
  for (const row of rows) {
    const { state, stateObservedFrom, stateObservedTo } = row.guest
    if (state !== 'running' && state !== 'stopped') continue
    const legacy =
      stateObservedFrom === undefined && stateObservedTo === undefined
    const from = Date.parse(legacy ? row.at : stateObservedFrom)
    const to = Date.parse(legacy ? row.at : stateObservedTo)
    // Incomplete or inverted observation windows cannot prove temporal order, nor can a later response prove a timely stop.
    if (!(from <= to && to <= deadline)) continue
    if (state === 'running') earliestRunning = Math.min(earliestRunning, to)
    else stopped.push({ row, from, to, legacy })
  }
  const first = stopped
    .filter((s) => earliestRunning < s.from)
    .sort((a, b) => a.to - b.to)[0]
  if (!first) return null

  const intent = await readRecord(join(dir, 'plan-stop.json'))
  let outcome = 'unexpected-stop'
  if (intent) {
    const plannedAt = Date.parse(intent.at)
    if (plannedAt < first.from || (first.legacy && plannedAt === first.from))
      outcome = 'planned-stop'
    // Intent within the observation interval cannot establish which happened first.
    else if (!(plannedAt > first.to)) outcome = 'unknown'
  }
  return end(dir, outcome, first.row.at, first.row.at)
}

/**
 * Re-read immutable samples before publishing an observer timeout or interruption.
 * Another watcher may have committed stop evidence since this observer last sampled.
 * @example await closeObserver(dir, 'observer-timeout', clock(), deadline)
 */
async function closeObserver(dir, fallback, at, deadline) {
  const rows = await history(dir)
  return (
    (await settleRecordedStop(dir, rows, deadline)) ??
    end(dir, fallback, at, rows.at(-1)?.at)
  )
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
  let sawRunning = rows.some((row) => row.guest.state === 'running')
  const started = Date.parse(trial.started)
  const deadline = Date.parse(trial.deadline)
  const clock = () => new Date(now()).toISOString()
  const recovered = await settleRecordedStop(dir, rows, deadline)
  if (recovered) return recovered
  while (true) {
    const existing = await readRecord(join(dir, 'end.json'))
    if (existing) return existing
    if (signal?.aborted)
      return closeObserver(dir, 'observer-interrupted', clock(), deadline)
    if (now() >= deadline)
      return closeObserver(dir, 'observer-timeout', clock(), deadline)
    const slot = Math.floor((now() - started) / (declaration.interval * 1000))
    // Retries and overlapping observers share a single durable sample per scheduled interval.
    const recorded = await readRecord(join(dir, `sample-slot-${slot}.json`))
    const row = recorded ?? (await observe(dir, rows, await sample(), slot))
    note({
      id,
      at: row.at,
      guest: row.guest.state,
      reachable: row.guest.reachable,
      workloads: row.host.workloads,
    })
    if (!recorded || rows.at(-1)?.at !== row.at) rows.push(row)
    if (row.guest.state === 'running') sawRunning = true
    if (sawRunning && row.guest.state === 'stopped') {
      const stopped = await settleRecordedStop(dir, rows, deadline)
      if (stopped) return stopped
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
  if (ended) return ended
  const at = new Date(now()).toISOString()
  if (command === 'plan-stop') return publish(dir, 'plan-stop.json', { at })
  if (!['healthy', 'disconnected', 'unknown'].includes(outcome))
    throw new Error('Expected outcome healthy, disconnected or unknown.')
  const rows = await history(dir)
  const deadline = Date.parse(trial.deadline)
  const recovered = await settleRecordedStop(dir, rows, deadline)
  if (recovered) return recovered
  if (Date.parse(at) >= deadline)
    return closeObserver(dir, 'observer-timeout', at, deadline)
  const row = await observe(dir, rows, await sample())
  // Finishing must also honor a stop another observer committed while this fresh probe was in flight.
  const stopped = await settleRecordedStop(dir, await history(dir), deadline)
  if (stopped) return stopped
  if (Date.parse(row.at) > deadline)
    return end(dir, 'observer-timeout', row.at, row.at)
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
  return end(dir, outcome, row.at, row.at)
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
    const samples = ended
      ? rows.filter((s) => Date.parse(s.at) <= Date.parse(ended.at))
      : rows
    const peaks = {}
    const combinations = new Set()
    for (const { host } of samples) {
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
    if (!samples.length) combinations.add('unknown')
    const observedCombinations = [...combinations].sort()
    const observed = observedCombinations.join(' | ')
    const pressures = [
      ...new Set(samples.map((s) => s.host.memoryPressure)),
    ].sort()
    const swap = samples.map((s) => s.host.usedSwapMb).filter(Number.isFinite)
    const guestMemory = observedGuestMemory(samples)
    const guestSwap = samples
      .map((s) => s.guest?.usedSwapMb)
      .filter(Number.isFinite)
    const guestPressures = [
      ...new Set(samples.map((s) => s.guest?.memoryPressure ?? 'unknown')),
    ].sort()
    const outcome = ended?.outcome ?? 'incomplete'
    const hostRates = samples.map((s) => s.change?.host).filter(Boolean)
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
      ...guestMemory,
      ...peakWorkloadRss(samples),
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
      samples: samples.length,
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
