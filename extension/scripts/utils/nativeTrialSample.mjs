import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { countProcessKinds, parseSwapUsage } from '../native-precheck.mjs'

const execute = promisify(execFile)
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
async function readCommand(program, args) {
  try {
    const { stdout } = await execute(program, args, {
      encoding: 'utf8',
      timeout: 12_000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024,
    })
    return { code: 0, stdout }
  } catch (error) {
    // Only completed commands can return usable output on a nonzero exit.
    return {
      code: Number.isInteger(error.code) ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
    }
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

/** Reads an absolute page counter and its unit independently. @example pageFacts('Swapouts: 312.') */
function pageFacts(text) {
  const pageSize = Number(/\(page size of (\d+) bytes\)/.exec(text)?.[1])
  const swapouts = Number(/^Swapouts:[ \t]*(\d+)\.?[ \t]*\r?$/m.exec(text)?.[1])
  return {
    pageSize: Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : null,
    swapouts: Number.isSafeInteger(swapouts) ? swapouts : null,
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

/** Reads the named guest only after the control plane confirms it is running. @example await readGuest(readCommand) */
async function readGuest(run) {
  const info = readJson(
    await run('cua', ['sandbox', 'info', guestName, '--json']),
    [0],
  )
  const state =
    typeof info?.state === 'string' ? info.state.trim().toLowerCase() : ''
  const unmeasured = {
    reachable: null,
    memoryPressure: 'unknown',
    memoryBytes: null,
    usedSwapMb: null,
    pageSize: null,
    swapouts: null,
  }
  if (state === 'stopped') return { state: 'stopped', ...unmeasured }
  if (state !== 'running' && state !== 'ready')
    return { state: 'unknown', ...unmeasured }

  const result = await run('cua', ['sb', 'exec', guestName, guestRead])
  const lines =
    typeof result?.stdout === 'string' ? result.stdout.split(/\r?\n/) : []
  // The marker distinguishes a guest that answered with missing measurements from a failed connection.
  if (lines[0] !== guestMarker) {
    const reachable = result?.code === 0 ? null : false
    return { state: 'running', ...unmeasured, reachable }
  }
  const measurements = lines.slice(1).join('\n')
  const ram = Number(/^memoryBytes=(\d+)$/m.exec(measurements)?.[1])
  const swapLine = /^swapUsage=([^\n]*)$/m.exec(measurements)?.[1]
  return {
    state: 'running',
    reachable: true,
    memoryPressure: Object.hasOwn(guestPressure, lines[1])
      ? guestPressure[lines[1]]
      : 'unknown',
    memoryBytes: Number.isSafeInteger(ram) && ram > 0 ? ram : null,
    usedSwapMb: parseSwapUsage(swapLine)?.usedMb ?? null,
    ...pageFacts(measurements),
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
} = {}) {
  const at = now().toISOString()
  // A missing executable or a failed probe must not discard the independent measurements.
  const safeRun = async (program, args) => {
    try {
      return await run(program, args)
    } catch {
      return { code: null, stdout: '' }
    }
  }
  const [precheck, hostPages, guest] = await Promise.all([
    safeRun(process.execPath, [precheckPath, '--json']),
    safeRun('/usr/bin/vm_stat', []),
    readGuest(safeRun),
  ])
  const facts = readJson(precheck, [0, 3])
  const used = facts?.swap?.usedMb
  return {
    at,
    host: {
      memoryPressure: pressureLevels.has(facts?.memoryPressure)
        ? facts.memoryPressure
        : 'unknown',
      usedSwapMb: Number.isFinite(used) && used >= 0 ? used : null,
      workloads: workloadCounts(facts?.processes),
      rssMiBByKind: workloadRss(facts?.rssMiBByKind),
      ...pageFacts(hostPages?.code === 0 ? hostPages.stdout : ''),
    },
    guest,
  }
}
