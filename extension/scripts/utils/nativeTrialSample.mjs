import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { countProcessKinds, parseSwapUsage } from '../native-precheck.mjs'

const execute = promisify(execFile)
const commandTimeoutMs = 12_000
const precheckPath = fileURLToPath(
  new URL('../native-precheck.mjs', import.meta.url),
)
const workloadKinds = Object.keys(countProcessKinds([], 0))
const pressureLevels = new Set(['normal', 'warning', 'critical', 'unsupported'])
const guestPressure = { 1: 'normal', 2: 'warning', 4: 'critical' }
const guestName = 'local:codebook-qa'
const guestMarker = 'codebook-qa-sample'
const guestRead = [
  `printf '%s\\n' '${guestMarker}'`,
  '/usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level',
  '/usr/bin/vm_stat',
  "printf '\\nmemoryBytes='",
  '/usr/sbin/sysctl -n hw.memsize',
  "printf '\\nswapUsage='",
  '/usr/sbin/sysctl -n vm.swapusage',
].join('; ')

/**
 * Reads one command's bounded stdout. The busy precheck also supplies valid JSON on exit 3.
 * @example
 * await readCommand('/usr/bin/vm_stat', [])
 */
async function readCommand(program, args, timeout = commandTimeoutMs) {
  try {
    const { stdout } = await execute(program, args, {
      encoding: 'utf8',
      timeout,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    })
    return { code: 0, stdout }
  } catch (error) {
    return commandFailure(error)
  }
}

/**
 * Keep the exit status of a completed command separate from a local observer failure.
 * {@link readCommand} and injected runners may report a timeout, signal, output limit or spawn failure.
 * @example commandFailure({ code: 'ENOENT' }).observerFailure // => 'execution-error'
 */
function commandFailure(error) {
  const code = Number.isInteger(error?.code) ? error.code : null
  const stdout = typeof error?.stdout === 'string' ? error.stdout : ''
  if (code !== null) return { code, stdout }
  const timedOut =
    error?.code === 'ETIMEDOUT' ||
    ((error?.code === null || error?.code === undefined) &&
      error?.killed === true &&
      error?.signal === 'SIGKILL')
  return {
    code,
    stdout,
    observerFailure: timedOut ? 'timeout' : 'execution-error',
  }
}

/** Reads JSON from an accepted command exit. @example readJson({ code: 3, stdout: '{}' }, [0, 3]) */
function readJson(result, accepted) {
  if (!accepted.includes(result?.code)) return undefined
  try {
    return JSON.parse(result.stdout)
  } catch {
    return undefined
  }
}

/**
 * Associates a page counter with the completion of its own probe, so slower parallel probes cannot change its rate.
 * @example pageFacts('Swapouts: 312.', '2026-11-27T06:00:10.000Z')
 */
function pageFacts(text, observedAt) {
  const pageSize = Number(/\(page size of (\d+) bytes\)/.exec(text)?.[1])
  const swapouts = Number(/^Swapouts:[ \t]*(\d+)\.?[ \t]*\r?$/m.exec(text)?.[1])
  return {
    pageSize: Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : null,
    swapouts: Number.isSafeInteger(swapouts) ? swapouts : null,
    swapoutsObservedAt: Number.isSafeInteger(swapouts) ? observedAt : null,
  }
}

/** Copies only the precheck's known counters when it supplied a complete reading. @example workloadCounts(countProcessKinds([], 0)) */
function workloadCounts(processes) {
  if (
    !workloadKinds.every(
      (kind) => Number.isSafeInteger(processes?.[kind]) && processes[kind] >= 0,
    )
  )
    return null
  return Object.fromEntries(
    workloadKinds.map((kind) => [kind, processes[kind]]),
  )
}

/**
 * Projects available per-workload RSS readings onto the precheck's known kinds.
 * Missing and malformed measurements never stand in for an observed zero.
 * @example workloadRss({ nodeTest: 142.5, tsc: 0 })
 */
function workloadRss(readings) {
  const measured = workloadKinds.filter(
    (kind) => Number.isFinite(readings?.[kind]) && readings[kind] >= 0,
  )
  return measured.length
    ? Object.fromEntries(measured.map((kind) => [kind, readings[kind]]))
    : null
}

/**
 * Associate the reported guest state with the interval of this particular provider inventory query.
 * {@link readGuest} uses this for both initial discovery and the confirmation after a failed connection.
 * @example await readInventory(runGuest, () => new Date())
 */
async function readInventory(runGuest, now) {
  const from = now().toISOString()
  const result = await runGuest(['sandbox', 'info', guestName, '--json'])
  const to = now().toISOString()
  const info = readJson(result, [0])
  const reported =
    typeof info?.state === 'string' ? info.state.trim().toLowerCase() : ''
  const state =
    reported === 'stopped'
      ? 'stopped'
      : ['running', 'ready'].includes(reported)
        ? 'running'
        : 'unknown'
  return {
    state,
    stateObservedFrom: result?.attempted === false ? null : from,
    stateObservedTo: result?.attempted === false ? null : to,
    ...(!Number.isInteger(result?.code)
      ? {
          observerFailure:
            result?.observerFailure === 'timeout'
              ? 'timeout'
              : 'execution-error',
        }
      : {}),
  }
}

/**
 * Record guest reachability together with a fresh inventory observation after a failed connection.
 * The whole guest read shares the two original command time budgets, including a confirmation query.
 * @example await readGuest(readCommand, () => new Date(), () => performance.now())
 */
async function readGuest(run, now, elapsed) {
  const deadline = elapsed() + 2 * commandTimeoutMs
  const runGuest = async (args) => {
    const timeout = Math.min(commandTimeoutMs, Math.floor(deadline - elapsed()))
    if (timeout <= 0)
      return {
        code: null,
        stdout: '',
        observerFailure: 'timeout',
        attempted: false,
      }
    const result = await run('cua', args, timeout)
    // A command can exit within its timeout while its completion reaches the observer after the shared deadline.
    if (elapsed() > deadline) {
      // The exact guest shell marker still proves contact before receipt; discard all late inventory and telemetry.
      const firstLine =
        args[0] === 'sb' && typeof result?.stdout === 'string'
          ? result.stdout.split(/\r?\n/, 1)[0]
          : ''
      return {
        code: null,
        stdout: firstLine === guestMarker ? guestMarker : '',
        observerFailure: 'timeout',
      }
    }
    return result
  }
  const observation = await readInventory(runGuest, now)
  const unmeasured = {
    reachable: null,
    memoryPressure: 'unknown',
    memoryBytes: null,
    usedSwapMb: null,
    pageSize: null,
    swapouts: null,
    swapoutsObservedAt: null,
    measurementsObservedAt: null,
  }
  if (observation.state !== 'running') return { ...unmeasured, ...observation }

  const result = await runGuest(['sb', 'exec', guestName, guestRead])
  const measuredAt = now().toISOString()
  const lines =
    typeof result?.stdout === 'string' ? result.stdout.split(/\r?\n/) : []
  const probeStarted = lines[0] === guestMarker
  const exited = Number.isInteger(result?.code)
  // A start marker in partial stdout proves earlier contact. Recheck the VM if the observer never saw the command exit.
  if (!probeStarted || !exited) {
    const confirmed = await readInventory(runGuest, now)
    return {
      ...unmeasured,
      ...confirmed,
      initialRunningObservation: {
        stateObservedFrom: observation.stateObservedFrom,
        stateObservedTo: observation.stateObservedTo,
      },
      ...(probeStarted
        ? { probeStarted: true, probeMarkerReceivedAt: measuredAt }
        : {}),
      reachable:
        confirmed.state === 'running' && exited && result.code !== 0
          ? false
          : null,
      ...(!exited
        ? {
            observerFailure:
              result?.observerFailure === 'timeout'
                ? 'timeout'
                : 'execution-error',
          }
        : {}),
    }
  }
  const measurements = lines.slice(1).join('\n')
  const ram = Number(/^memoryBytes=(\d+)$/m.exec(measurements)?.[1])
  const swapLine = /^swapUsage=([^\n]*)$/m.exec(measurements)?.[1]
  const memoryPressure = Object.hasOwn(guestPressure, lines[1])
    ? guestPressure[lines[1]]
    : 'unknown'
  const memoryBytes = Number.isSafeInteger(ram) && ram > 0 ? ram : null
  const usedSwapMb = parseSwapUsage(swapLine)?.usedMb ?? null
  const pages = pageFacts(measurements, measuredAt)
  return {
    ...observation,
    reachable: true,
    memoryPressure,
    memoryBytes,
    usedSwapMb,
    ...pages,
    measurementsObservedAt:
      memoryPressure !== 'unknown' ||
      memoryBytes !== null ||
      usedSwapMb !== null
        ? measuredAt
        : null,
  }
}

/**
 * Takes the trial recorder's read-only sample of the host and the dedicated QA guest.
 * Only the timestamp, known states and numeric measurements enter its journal.
 * @param {object} [options] - Tests inject a command runner returning {code, stdout} and a clock returning a Date.
 * @example
 * const sample = await readNativeTrialSample()
 */
export async function readNativeTrialSample({
  run = readCommand,
  now = () => new Date(),
  elapsed = () => performance.now(),
} = {}) {
  // A missing executable or a failed probe must not discard the independent measurements.
  const safeRun = async (program, args, timeout) => {
    try {
      return await run(program, args, timeout)
    } catch (error) {
      return commandFailure(error)
    }
  }
  const [precheck, hostPages, guest] = await Promise.all([
    safeRun(process.execPath, [precheckPath, '--json']).then((result) => ({
      facts: readJson(result, [0, 3]),
      at: now().toISOString(),
    })),
    safeRun('/usr/bin/vm_stat', []).then((result) =>
      pageFacts(result.code === 0 ? result.stdout : '', now().toISOString()),
    ),
    readGuest(safeRun, now, elapsed),
  ])
  const { facts } = precheck
  const used = facts?.swap?.usedMb
  const usedSwapMb = Number.isFinite(used) && used >= 0 ? used : null
  const memoryPressure = pressureLevels.has(facts?.memoryPressure)
    ? facts.memoryPressure
    : 'unknown'
  const workloads = workloadCounts(facts?.processes)
  const rssMiBByKind = workloadRss(facts?.rssMiBByKind)
  return {
    at: now().toISOString(),
    host: {
      memoryPressure,
      usedSwapMb,
      workloads,
      rssMiBByKind,
      workloadsObservedAt:
        memoryPressure !== 'unknown' ||
        usedSwapMb !== null ||
        workloads ||
        rssMiBByKind
          ? precheck.at
          : null,
      ...hostPages,
    },
    guest,
  }
}
