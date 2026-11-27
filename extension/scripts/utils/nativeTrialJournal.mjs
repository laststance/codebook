import { randomUUID } from 'node:crypto'
import { linkSync, lstatSync, readdirSync, writeFileSync } from 'node:fs'
import { link, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { readNativeTrialSample } from './nativeTrialSample.mjs'

const EVIDENCE_FILE =
  /^(sample-(slot-\d+|\d+-[\da-f-]+)|observation-[\da-f-]+)\.json$/
const TERMINAL_EVIDENCE = 'terminal-evidence.json'
const PLAN_AUTHORIZATION = 'plan-stop-authorization.json'
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
    const record = JSON.parse(await readFile(path, 'utf8'))
    if (!record || typeof record !== 'object' || Array.isArray(record))
      throw new Error(`Expected a JSON object in ${path}`)
    return record
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Rejects a damaged declaration before admitting an observer or aggregating a bounded timeout.
 * @example trialDeadline(dir, trial)
 */
function trialDeadline(dir, trial) {
  const deadline =
    typeof trial.deadline === 'string' ? Date.parse(trial.deadline) : NaN
  if (!Number.isFinite(deadline))
    throw new Error(`Invalid deadline in ${join(dir, 'trial.json')}`)
  const started =
    typeof trial.started === 'string' ? Date.parse(trial.started) : NaN
  if (!Number.isFinite(started) || started >= deadline)
    throw new Error(`Invalid observation window in ${join(dir, 'trial.json')}`)
  return deadline
}

/** Confirms the directory entry of a linked record, including when the original publisher's sync failed. */
async function syncDirectory(dir) {
  const directory = await open(dir, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

/** Watch and finish may return an existing terminal record only after its directory entry is synced. */
async function durableEnd(dir) {
  const ended = await readRecord(join(dir, 'end.json'))
  if (ended) await syncDirectory(dir)
  return ended
}

/**
 * Order observation, closure and grant links across independent Node processes. SQLite owns the OS lock
 * until the synchronous filesystem operation finishes or the process exits. No journal data lives in the database.
 * @param action - A synchronous directory check or link. Collection, durable sync and terminal recovery run outside the lock.
 * @example await withPublicationLock(dir, () => linkSync(prepared, destination))
 */
async function withPublicationLock(dir, action) {
  const { DatabaseSync } = await import('node:sqlite')
  const lockFile = join(dir, '.publication.sqlite')
  // Only the first publisher creates the private file. SQLite manages every descriptor of an existing lock.
  if (!lstatSync(lockFile, { throwIfNoEntry: false })) {
    try {
      writeFileSync(lockFile, '', { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  if (!lstatSync(lockFile).isFile())
    throw new Error('The trial publication lock must be a regular file')
  const database = new DatabaseSync(lockFile)
  try {
    const limit = performance.now() + PROBE_LEASE_MS
    // BEGIN IMMEDIATE takes SQLite's process-owned write lock. Its default busy timeout is zero.
    for (;;) {
      try {
        database.exec('BEGIN IMMEDIATE')
        break
      } catch (error) {
        if (error.errcode !== 5 || performance.now() >= limit) throw error
        // SQLITE_BUSY means another publisher holds the lock. Other work in this process can still finish.
        await delay(10)
      }
    }
    return action()
  } finally {
    database.close()
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
    let published = record
    try {
      const destination = join(dir, name)
      if (
        EVIDENCE_FILE.test(name) ||
        name === PLAN_AUTHORIZATION ||
        name === 'closing.json'
      ) {
        await withPublicationLock(dir, () => linkSync(tmp, destination))
      } else {
        await link(tmp, destination)
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      published = await readRecord(join(dir, name))
    }
    // A winner's link can be visible before its sync succeeds.
    await syncDirectory(dir)
    return published
  } finally {
    await unlink(tmp)
  }
}

/**
 * Read the single immutable decision used by planners and observers. Old grants may have a matching
 * refusal written after publication, in which case the journal cannot prove the caller had permission.
 * @example await stopDecision(dir)
 */
async function stopDecision(dir) {
  const decision = await readRecord(join(dir, PLAN_AUTHORIZATION))
  if (decision?.status === 'accepted' && !decision.requiresCommitLink) {
    if (
      !EVIDENCE_FILE.test(decision.witness ?? '') ||
      (await readRecord(join(dir, `refused-${decision.witness}`)))
    )
      return null
  }
  return decision
}

/**
 * Recover any known stop, then compare its append-only evidence set and commit the grant under the same
 * lock that publishes observations. A changed set must be read before granting or reusing permission.
 * @param commit - Links the prepared grant when a new planner wins. A retry only rechecks the earlier grant.
 * @example await openForStopPlan(dir, deadline, now, () => linkSync(prepared, destination))
 */
async function openForStopPlan(dir, deadline, now, commit) {
  do {
    const files = await evidenceFiles(dir)
    if (await recoverRecordedStop(dir, deadline, files)) return false
    const granted = await withPublicationLock(dir, () => {
      const names = readdirSync(dir)
      if (names.includes('closing.json')) return false
      if (
        names.filter((name) => EVIDENCE_FILE.test(name)).length !== files.length
      )
        return null
      if (now() >= deadline) return false
      commit?.()
      return true
    })
    if (granted !== null) return granted
  } while (now() < deadline)
  return false
}

/**
 * Prepare a durable candidate, then compete with closure for one final link. Only that link grants permission.
 * A later close cannot revoke a winning decision. A failed sync of its link leaves the caller's result uncertain.
 * @example await commitStopPlan(dir, row, decisionAt, deadline, now)
 */
async function commitStopPlan(dir, row, decisionAt, deadline, now) {
  const name = `prepared-${row.file}`
  await publish(dir, name, {
    status: 'accepted',
    requiresCommitLink: true,
    witness: row.file,
    preparedAt: new Date(decisionAt).toISOString(),
  })
  // Recover any stop published during preparation before racing closure for the final link.
  try {
    const won = await openForStopPlan(dir, deadline, now, () =>
      linkSync(join(dir, name), join(dir, PLAN_AUTHORIZATION)),
    )
    if (!won) return false
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    // An earlier successful planner may also be retried, but a new caller must still find an open trial.
    if ((await stopDecision(dir))?.status !== 'accepted') return false
    await syncDirectory(dir)
    return openForStopPlan(dir, deadline, now)
  }
  await syncDirectory(dir)
  return true
}

async function evidenceFiles(dir) {
  return (await readdir(dir)).filter((name) => EVIDENCE_FILE.test(name)).sort()
}

/** Reads an immutable filename set in order without opening an entire long trial at once. */
async function history(dir, files) {
  const names = files === undefined ? await evidenceFiles(dir) : files
  if (!Array.isArray(names))
    throw new Error(
      `Invalid observation list in ${join(dir, TERMINAL_EVIDENCE)}`,
    )
  const records = []
  for (const name of names) {
    if (typeof name !== 'string' || !EVIDENCE_FILE.test(name))
      throw new Error(
        `Invalid observation filename in ${join(dir, TERMINAL_EVIDENCE)}`,
      )
    const row = await readRecord(join(dir, name))
    if (!row) throw new Error(`Missing observation ${join(dir, name)}`)
    records.push({ ...row, file: name })
  }
  return records.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** Freeze the same evidence set for concurrent closers and a restart after the first closer exits. */
async function sealEvidence(dir, incomplete) {
  const existing = await readRecord(join(dir, TERMINAL_EVIDENCE))
  if (existing) {
    await syncDirectory(dir)
    return existing
  }
  return publish(dir, TERMINAL_EVIDENCE, {
    files: await evidenceFiles(dir),
    incomplete,
  })
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
    // The grant's decision clock predates its publication. Bind each probe to the durable grant visible before it starts.
    const grant = await stopDecision(dir)
    if (grant?.status === 'closed') return null
    const stopPlanWitness = grant?.status === 'accepted' ? grant.witness : null
    if (stopPlanWitness) await syncDirectory(dir)
    if (now() >= deadline) return null
    const row = { ...(await collect()), stopPlanWitness }
    if (!afterPlanAt) {
      const key =
        slot === undefined ? `${Date.parse(row.at)}-${id}` : `slot-${slot}`
      const winner = await publish(dir, `sample-${key}.json`, row)
      if (winner === row) return row
    }
    // Wait for directory sync before releasing the pending observation to a concurrent finisher.
    const file = `observation-${id}.json`
    const observation = await publish(dir, file, {
      ...row,
      additionalObservation: true,
      ...(afterPlanAt ? { afterPlanAt } : {}),
    })
    return { ...observation, file }
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
      // If rechecking the guest no longer confirmed it running, the earlier read cannot authorize the operator's shutdown.
      if (initial) running.push(initial)
    }
    const observed = stateWindow(row.guest, row.at, deadline)
    if (!observed) continue
    if (state === 'running')
      running.push({
        ...observed,
        file: row.file,
        afterPlanAt:
          Date.parse(row.at) < deadline ? row.afterPlanAt : undefined,
      })
    else if (state === 'stopped') stopped.push({ row, ...observed })
  }
  const earliestRunning = running.reduce(
    (earliest, r) => Math.min(earliest, r.to),
    Infinity,
  )
  const confirmed = stopped
    .filter((s) => earliestRunning < s.from)
    .sort((a, b) => a.to - b.to)
  const first = confirmed[0]
  if (!first) return null

  const beforeStop = running
    .filter((r) => r.to < first.from)
    .sort((a, b) => b.to - a.to)
  const intent = await readRecord(join(dir, 'plan-stop.json'))
  let witness = beforeStop[0]
  let outcome = 'unexpected-stop'
  if (intent) {
    const plannedAt = Date.parse(intent.at)
    const authorization = await stopDecision(dir)
    const afterPlan = beforeStop.filter(
      (r) => r.afterPlanAt === intent.at && plannedAt <= r.from,
    )
    const authorized = afterPlan.find((r) => r.file === authorization?.witness)
    const earliestPossibleRunning = running.reduce(
      (earliest, r) => Math.min(earliest, r.from),
      Infinity,
    )
    if (
      authorization?.status === 'accepted' &&
      authorized &&
      // Proving a transition needs ordered readings. Ruling out an earlier stop must also include queries that straddle the running witness or trial deadline.
      rows.every((row) => {
        if (
          row.guest.state !== 'stopped' ||
          row.stopPlanWitness === authorized.file
        )
          return true
        const window = stateWindow(row.guest, row.at, Infinity)
        return (
          window &&
          (window.to < earliestPossibleRunning || window.from > first.to)
        )
      }) &&
      Date.parse(authorization.preparedAt ?? authorization.acceptedAt) <=
        first.from
    ) {
      witness = authorized
      outcome = 'planned-stop'
    } else if (!(plannedAt > first.to)) {
      // A later stop is unplanned when closure won against a confirmed running probe.
      // A legacy intent or overlapping readings cannot establish that order.
      const closedWithoutGrant =
        intent.requiresAuthorization &&
        authorization?.status === 'closed' &&
        afterPlan.length > 0
      if (!closedWithoutGrant) outcome = 'unknown'
    }
  }
  return {
    outcome,
    at: first.row.at,
    sampleAt: first.row.at,
    stopEvidence: { running: isoWindow(witness), stopped: isoWindow(first) },
  }
}

/**
 * Resume closure when the trial already contains a confirmed transition, even if the guest has restarted.
 * Watch, finish and stop planning must all use the same first durable stop and terminal outcome.
 * @example await recoverRecordedStop(dir, deadline)
 */
async function recoverRecordedStop(dir, deadline, files) {
  const stopped = await recordedStop(dir, await history(dir, files), deadline)
  if (!stopped) return null
  return closeObserver(
    dir,
    stopped.outcome,
    stopped.at,
    deadline,
    stopped.sampleAt,
  )
}

/**
 * Seal admission, wait for previously admitted probes, then derive the terminal record from all durable evidence.
 * Every finisher uses the same immutable claim, including anyone resuming after the first closer was interrupted.
 * A missing observer has a bounded lease. Its incomplete evidence cannot prove a healthy completion or a timeout.
 * @example await closeObserver(dir, 'observer-timeout', clock(), deadline)
 */
async function closeObserver(dir, fallback, at, deadline, sampleAt) {
  const requested = { outcome: fallback, at, sampleAt: sampleAt ?? null }
  // Fence stop approval first. The winning closer's claim survives a crash before closing.json is written.
  const decision = await publish(dir, PLAN_AUTHORIZATION, {
    status: 'closed',
    closing: requested,
  })
  const claim = await publish(
    dir,
    'closing.json',
    decision.status === 'closed' ? (decision.closing ?? requested) : requested,
  )
  let incomplete = false
  const limit = Date.now() + PROBE_LEASE_MS
  while (true) {
    const existing = await durableEnd(dir)
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
  const evidence = await sealEvidence(dir, incomplete)
  const rows = await history(dir, evidence.files ?? null)
  const stopped = await recordedStop(dir, rows, deadline)
  const final = stopped ?? {
    ...claim,
    sampleAt: claim.sampleAt ?? rows.at(-1)?.at ?? null,
  }
  // A lost probe could have seen the stop before approval. Preserve the confirmed window even when its order is unknown.
  if (evidence.incomplete && stopped?.outcome !== 'unexpected-stop') {
    final.outcome = 'unknown'
    final.reason = 'incomplete-observation'
  }
  return publish(dir, 'end.json', { ...final, evidence: TERMINAL_EVIDENCE })
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
  const alreadyEnded = await durableEnd(dir)
  if (alreadyEnded) return alreadyEnded
  const deadline = trialDeadline(dir, trial)
  const started = Date.parse(trial.started)
  const clock = () => new Date(now()).toISOString()
  const recovered = await recoverRecordedStop(dir, deadline)
  if (recovered) return recovered
  while (true) {
    const existing = await durableEnd(dir)
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
    // A competing watcher or stop planner may have supplied the only running witness.
    if (row.guest.state === 'stopped') {
      const stopped = await recoverRecordedStop(dir, deadline)
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
  const ended = await durableEnd(dir)
  const at = new Date(now()).toISOString()
  const deadline = ended ? NaN : trialDeadline(dir, trial)
  if (command === 'plan-stop') {
    if (
      !ended &&
      !(await recoverRecordedStop(dir, deadline)) &&
      now() < deadline &&
      !(await readRecord(join(dir, 'closing.json')))
    ) {
      const intent = await publish(dir, 'plan-stop.json', {
        at,
        requiresAuthorization: true,
      })
      // Admission can close between the intent and its observation.
      const row = await observe(
        dir,
        sample,
        { afterPlanAt: intent.at },
        deadline,
        now,
      )
      const running =
        row?.guest.state === 'running' &&
        stateWindow(row.guest, row.at, deadline)
      const closing = await readRecord(join(dir, 'closing.json'))
      const decisionAt = now()
      if (
        running &&
        !closing &&
        Date.parse(intent.at) <= running.from &&
        Date.parse(row.at) < deadline &&
        decisionAt < deadline
      ) {
        if (await commitStopPlan(dir, row, decisionAt, deadline, now))
          return intent
      }
      if (row)
        await publish(dir, `refused-${row.file}`, {
          status: 'rejected',
          witness: row.file,
        })
    }
    throw new Error(
      'The trial can no longer observe this stop plan. Do not stop the VM under this trial.',
    )
  }
  if (ended) return ended
  if (!['healthy', 'disconnected', 'unknown'].includes(outcome))
    throw new Error('Expected outcome healthy, disconnected or unknown.')
  const recovered = await recoverRecordedStop(dir, deadline)
  if (recovered) return recovered
  if (Date.parse(at) >= deadline)
    return closeObserver(dir, 'observer-timeout', at, deadline)
  const row = await observe(dir, sample, {}, deadline, now)
  if (!row) return closeObserver(dir, 'observer-timeout', at, deadline)
  // Finishing must also honor a stop another observer committed while this fresh probe was in flight.
  const stopped = await recoverRecordedStop(dir, deadline)
  if (stopped) return stopped
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
    const ended = await durableEnd(dir)
    // Older terminal results retain their recorded outcome. Only an active or timed-out trial requires an intact declared interval.
    const deadline =
      !ended || ended.outcome === 'observer-timeout'
        ? trialDeadline(dir, trial)
        : Date.parse(trial.deadline)
    let evidence
    if (ended) {
      // Older terminals have no historical manifest. Freeze their surviving evidence on first recovery.
      evidence = ended.evidence
        ? await readRecord(join(dir, TERMINAL_EVIDENCE))
        : await sealEvidence(dir, false)
    }
    const rows = await history(
      dir,
      ended ? (evidence?.files ?? null) : undefined,
    )
    // Older terminal files named their stopped sample without storing its inventory interval.
    let stopEvidence = ended?.stopEvidence
    if (
      ended?.sampleAt &&
      !stopEvidence &&
      ['unexpected-stop', 'planned-stop', 'unknown'].includes(ended.outcome)
    ) {
      const stop = await recordedStop(dir, rows, deadline)
      if (stop?.sampleAt === ended.sampleAt) stopEvidence = stop.stopEvidence
    }
    // A timeout describes the declared interval. A confirmed stop can shorten it.
    const terminalTime =
      stopEvidence?.stopped.to ??
      (ended?.outcome === 'observer-timeout' ? trial.deadline : ended?.at)
    // Older terminals can lack a valid declaration. Their own observation boundary still applies.
    const hasDeclaredWindow =
      typeof trial.started === 'string' &&
      typeof trial.deadline === 'string' &&
      Date.parse(trial.started) < deadline
    const cutoff = Math.min(
      hasDeclaredWindow ? deadline : Infinity,
      ended ? Date.parse(terminalTime) : Infinity,
    )
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
        within(row.at) ||
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
    // A confirmed slot can lack a precheck clock even when another slot measured a workload.
    // A known post-stop measurement remains outside the trial.
    if (
      !hostSamples.length ||
      [...counted].some(
        (row) =>
          !Number.isFinite(
            Date.parse(readingAt(row, 'host', 'workloadsObservedAt')),
          ),
      )
    )
      combinations.add('unknown')
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
