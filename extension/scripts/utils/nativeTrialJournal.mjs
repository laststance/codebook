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
  const records = await Promise.all(names.map((n) => readRecord(join(dir, n))))
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

async function stopOutcome(dir, samples, row) {
  // A transport failure never supplies a stopped state, and an initially powered-off guest may simply be awaiting boot.
  if (
    row.guest.state !== 'stopped' ||
    !samples.some((s) => s.guest.state === 'running')
  )
    return null
  const intent = await readRecord(join(dir, 'plan-stop.json'))
  return intent && Date.parse(intent.at) <= Date.parse(row.at)
    ? 'planned-stop'
    : 'unexpected-stop'
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
  const rows = await history(dir)
  const started = Date.parse(trial.started)
  const deadline = Date.parse(trial.deadline)
  const clock = () => new Date(now()).toISOString()
  while (true) {
    const existing = await readRecord(join(dir, 'end.json'))
    if (existing) return existing
    if (signal?.aborted)
      return end(dir, 'observer-interrupted', clock(), rows.at(-1)?.at)
    if (now() >= deadline)
      return end(dir, 'observer-timeout', clock(), rows.at(-1)?.at)
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
    const stopped = await stopOutcome(dir, rows, row)
    if (stopped) return end(dir, stopped, clock(), row.at)
    if (rows.at(-1)?.at !== row.at) rows.push(row)
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
) {
  const dir = join(root, slug(id, 'trial id'))
  const trial = await readRecord(join(dir, 'trial.json'))
  if (!trial) throw new Error('No trial with that ID. Start watch first.')
  const ended = await readRecord(join(dir, 'end.json'))
  if (ended) return ended
  const now = new Date().toISOString()
  if (command === 'plan-stop')
    return publish(dir, 'plan-stop.json', { at: now })
  if (!['healthy', 'disconnected', 'unknown'].includes(outcome))
    throw new Error('Expected outcome healthy, disconnected or unknown.')
  const rows = await history(dir)
  if (Date.parse(now) >= Date.parse(trial.deadline))
    return end(dir, 'observer-timeout', now, rows.at(-1)?.at)
  const row = await observe(dir, rows, await sample())
  const stopped = await stopOutcome(dir, rows, row)
  if (stopped) return end(dir, stopped, row.at, row.at)
  if (Date.parse(row.at) > Date.parse(trial.deadline))
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
    let missing = false
    for (const { host } of samples) {
      if (host.workloads === null) {
        missing = true
        continue
      }
      for (const [kind, count] of Object.entries(host.workloads)) {
        if (count > 0) peaks[kind] = Math.max(count, peaks[kind] ?? 0)
      }
    }
    const kinds = Object.keys(peaks).sort()
    const observed = [
      kinds.join('+') || (missing || !samples.length ? '' : 'none'),
      ...(missing || !samples.length ? ['unknown'] : []),
    ]
      .filter(Boolean)
      .join('+')
    const pressures = [
      ...new Set(samples.map((s) => s.host.memoryPressure)),
    ].sort()
    const swap = samples.map((s) => s.host.usedSwapMb).filter(Number.isFinite)
    const outcome = ended?.outcome ?? 'incomplete'
    const hostRates = samples.map((s) => s.change?.host).filter(Boolean)
    const pressureChanges = {
      peakHostSwapoutPagesPerSecond: hostRates.length
        ? Math.max(...hostRates.map((s) => s.pagesPerSecond))
        : null,
      hostCounterDecreases: hostRates.filter((s) => s.counterDecreased).length,
    }
    const record = {
      ...pressureChanges,
      id: trial.id,
      cycle: trial.cycle,
      profile: trial.profile,
      observed,
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
    const key = JSON.stringify([trial.profile, observed])
    const group = groups.get(key) ?? {
      profile: trial.profile,
      observed,
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
