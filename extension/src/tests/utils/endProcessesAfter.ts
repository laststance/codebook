import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { isProcessGone } from '../../utils/isProcessGone'
import { systemErrorCode } from '../../utils/systemErrorCode'

// There are two of these helpers on purpose: this one serves the extension's compiled tests, which cannot import `scripts/tests/utils/endProcessesAfter.mjs`, and that one serves `scripts/tests`, which run on plain Node without a build (the Windows job's `scripts/tests` step among them) and cannot import this file. Keep their process rules (zombie, ownership) in step: a change here is made there too.

/** How many parents {@link ownershipOf} follows up from a process before it gives up; a tree of a test is a few levels deep. */
const MAX_PARENT_HOPS = 64

/** What `ps` says about one process. */
type ProcessInfo = { state: string; parentPid: number; ageSeconds: number }

/**
 * Reads the state, the parent id and the age of one process from `ps`.
 *
 * Called by {@link processRuns} and {@link ownershipOf}.
 *
 * @param pid - The process id.
 * @param exec - Runs `ps` ({@link execFileSync} by default); tests of this helper replace it to make `ps` fail.
 * @returns The process's facts; `undefined` when `ps` exits with status 1 (no process has this id); `'unreadable'` where `ps` cannot answer (no `ps`, or it fails to run).
 * @example
 * ```ts
 * readProcess(process.pid) // => { state: 'S+', parentPid: 4100, ageSeconds: 3 }
 * ```
 */
export function readProcess(
  pid: number,
  exec: (
    file: string,
    args: string[],
    options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore'] },
  ) => string = execFileSync,
): ProcessInfo | 'unreadable' | undefined {
  let printed: string
  try {
    printed = exec('ps', ['-o', 'stat=,ppid=,etime=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    // `ps` exits with status 1 only when no process has this id; any other failure (no `ps`, EAGAIN, EMFILE, ENOMEM...) cannot say, and must not read as "gone".
    return (error as { status?: unknown } | null)?.status === 1
      ? undefined
      : 'unreadable'
  }
  const [state, parentText, elapsed] = printed.trim().split(/\s+/)
  if (!state || !elapsed) return undefined
  // `etime` is [[dd-]hh:]mm:ss.
  const [days, clock] = elapsed.includes('-')
    ? elapsed.split('-')
    : ['0', elapsed]
  const [seconds = 0, minutes = 0, hours = 0] = (clock ?? '')
    .split(':')
    .map(Number)
    .reverse()
  return {
    state,
    parentPid: Number(parentText),
    ageSeconds: Number(days) * 86_400 + hours * 3_600 + minutes * 60 + seconds,
  }
}

/**
 * Says whether a process runs: a zombie nobody has reaped yet counts as gone (the signal probe of {@link isProcessGone} finds it), and a system without `ps` falls back to that probe.
 *
 * Called by {@link endProcesses}.
 *
 * @param pid - The process id.
 * @returns `false` for a process that is gone or a zombie.
 * @example
 * ```ts
 * processRuns(4242) // => false
 * ```
 */
function processRuns(pid: number): boolean {
  const info = readProcess(pid)
  if (info === 'unreadable') return !isProcessGone(pid)
  return info !== undefined && !info.state.startsWith('Z')
}

/** What the helper can tell of a running process's ownership: the test's, somebody else's, or not confirmable (no `ps`, no held child handle). */
type Ownership = 'owned' | 'foreign' | 'unconfirmed'

/** Reads one process's facts; tests of the helper replace it to show how the helper acts where `ps` cannot answer. */
type ReadProcess = (pid: number) => ProcessInfo | 'unreadable' | undefined

/**
 * Says whether a running process can be one this test process started, so a recycled id of an unrelated process is never signalled.
 *
 * Never owned: process 1 and below, this process, and its ancestors (the runner that started it, whose group a `group` end would kill). Owned: an id the test holds a child handle of (`held`), a descendant of this process, or an orphan (its parent is gone, so the system parents it to process 1) that started after `sinceMs`, as a child whose parent the test ended. Where `ps` cannot answer and no handle is held, nothing confirms the id: `'unconfirmed'`, and the caller must not signal it.
 *
 * @param pid - The process id.
 * @param sinceMs - The time from which a process may be the test's: when the test began.
 * @param read - Reads one process's facts ({@link readProcess} by default).
 * @param held - Ids of children the test holds a handle of.
 * @returns How the process stands to the test.
 * @example
 * ```ts
 * ownershipOf(process.ppid, Date.now(), readProcess, []) // => 'foreign'
 * ```
 */
function ownershipOf(
  pid: number,
  sinceMs: number,
  read: ReadProcess,
  held: readonly number[],
): Ownership {
  if (pid <= 1 || pid === process.pid || pid === process.ppid) return 'foreign'
  // The ancestors of this process are the runner and what started it: never the test's children.
  let ancestor = process.ppid
  for (let hop = 0; hop < MAX_PARENT_HOPS && ancestor > 1; hop += 1) {
    if (ancestor === pid) return 'foreign'
    const parent = read(ancestor)
    if (typeof parent !== 'object') break
    ancestor = parent.parentPid
  }
  if (held.includes(pid)) return 'owned'
  const info = read(pid)
  if (info === 'unreadable') return 'unconfirmed'
  if (info === undefined) return 'foreign'
  let parentPid = info.parentPid
  for (let hop = 0; hop < MAX_PARENT_HOPS && parentPid > 1; hop += 1) {
    if (parentPid === process.pid) return 'owned'
    const parent = read(parentPid)
    if (typeof parent !== 'object') break
    parentPid = parent.parentPid
  }
  // An orphan older than the test is somebody else's, with the same id by chance.
  return info.parentPid <= 1 &&
    info.ageSeconds <= (Date.now() - sinceMs) / 1000 + 2
    ? 'owned'
    : 'foreign'
}

/** How long {@link endProcesses} waits for a killed process to be seen gone. */
const PROCESS_GONE_WAIT_MS = 5_000

/** How often {@link endProcesses} looks again at a process it killed. */
const PROCESS_GONE_POLL_MS = 20

/** The signal call {@link endProcesses} uses; tests of the helper replace it to show a process that outlives its test. */
type SignalProcess = (pid: number, signal: NodeJS.Signals) => void

/**
 * Ends the given processes (and the process group each one leads, when asked) with SIGKILL and answers which of them are still seen after the wait.
 *
 * Called by {@link endProcessesAfter} when a test ends, and by the test of the helper itself with a signal call that kills nothing, to show that a survivor is reported.
 *
 * @param pids - Ids of processes a test started. An id that is gone already or a zombie is not signalled and is no survivor; a process that cannot be the test's ({@link ownershipOf}: a recycled id of an unrelated process, process 1, this process, its ancestors) is not signalled and is no survivor either. A process whose ownership cannot be confirmed (no `ps`, no held handle) is not signalled and is reported as a survivor, so the test fails instead of killing an id it cannot tell.
 * @param options - `group` also signals the process group each id leads (a child started `detached`); `held` names children the test holds a handle of, which are the test's whatever `ps` says; `signalProcess` replaces the signal call, `readProcessInfo` the `ps` read, `waitMs` shortens the wait, `sinceMs` is when the test began (when this process started by default).
 * @returns The ids still running once the wait is over, and the ones left unsignalled for unconfirmed ownership; empty when every process is gone or not the test's.
 * @example
 * ```ts
 * const survivors = await endProcesses([child.pid!], { group: true }) // => []
 * ```
 */
export async function endProcesses(
  pids: readonly number[],
  options: {
    group?: boolean
    held?: readonly number[]
    readProcessInfo?: ReadProcess
    signalProcess?: SignalProcess
    waitMs?: number
    sinceMs?: number
  } = {},
): Promise<number[]> {
  const signalProcess: SignalProcess =
    options.signalProcess ?? ((pid, signal) => process.kill(pid, signal))
  const sinceMs = options.sinceMs ?? Date.now() - process.uptime() * 1000
  const read = options.readProcessInfo ?? readProcess
  const held = options.held ?? []
  const ownership = new Map<number, Ownership>()
  // Only ids that run and can be the test's get a signal: a recycled id of an unrelated process (or of its group) is not this test's.
  for (const pid of new Set(pids))
    if (Number.isInteger(pid) && processRuns(pid))
      ownership.set(pid, ownershipOf(pid, sinceMs, read, held))
  const running = [...ownership].filter(([, kind]) => kind === 'owned')
  // Not signalled, and not silently dropped: the test must fail, so that the id is looked at.
  const unconfirmed = [...ownership]
    .filter(([, kind]) => kind === 'unconfirmed')
    .map(([pid]) => pid)
  for (const [pid] of running) {
    // A detached child leads a group of its own, whose other members would outlive the leader.
    if (options.group)
      try {
        signalProcess(-pid, 'SIGKILL')
      } catch {
        // The group is gone already, which is what the test wants.
      }
    try {
      signalProcess(pid, 'SIGKILL')
    } catch {
      // The process is gone already, which is what the test wants.
    }
  }
  const deadline = Date.now() + (options.waitMs ?? PROCESS_GONE_WAIT_MS)
  let survivors = running.map(([pid]) => pid).filter(processRuns)
  while (survivors.length > 0 && Date.now() < deadline) {
    await delay(PROCESS_GONE_POLL_MS)
    survivors = survivors.filter(processRuns)
  }
  return [...unconfirmed, ...survivors]
}

/**
 * Registers the end of every process a test started, whatever way the test ends, and fails the test when one of them cannot be ended.
 *
 * A test registers it before the first await that can fail, with a reader that finds the ids when the test ends (a file the fixture wrote its pid into, a list that fills while the test runs), so a failed assertion, a timeout or an early return leaves no process behind. The product under test may still be asserted to end the same process earlier: this only removes what is left.
 * Called by the tests that start a child that outlives its test unless something ends it.
 *
 * @param context - The running test, at whose end the processes are ended.
 * @param readPids - Answers the ids to end; read once, when the test ends.
 * @param options - `group` also ends the process group each id leads; `held` names the children the test holds a handle of (their ids are the test's even where `ps` cannot say, and they are ended when `readPids` itself fails).
 * @throws The failure of `readPids` (for example an unreadable pid file), after the held children were ended.
 * @example
 * ```ts
 * const started: number[] = []
 * endProcessesAfter(context, () => started, { group: true })
 * ```
 */
export function endProcessesAfter(
  context: TestContext,
  readPids: () => readonly number[] | Promise<readonly number[]>,
  options: { group?: boolean; held?: () => readonly number[] } = {},
): void {
  const sinceMs = Date.now()
  context.after(async () => {
    const { held, ...endOptions } = options
    let pids: readonly number[]
    try {
      pids = await readPids()
    } catch (error) {
      // The ids cannot be read, so the clean-up fails loudly; the children whose handles the test holds are ended first.
      await endProcesses(held?.() ?? [], {
        ...endOptions,
        held: held?.() ?? [],
        sinceMs,
      })
      throw error
    }
    const survivors = await endProcesses(pids, {
      ...endOptions,
      held: held?.() ?? [],
      sinceMs,
    })
    // A process that outlives its test would run until the machine restarts.
    assert.deepEqual(survivors, [], 'processes of the test outlived it')
  })
}

/**
 * Reads the process ids that a fixture wrote into files, skipping files not written (yet) and content that is no id.
 *
 * Called by the readers of {@link endProcessesAfter} for stand-in programs that note their own pid.
 *
 * @param paths - Files that hold one process id each.
 * @returns The ids found.
 * @throws A read failure other than a missing file (for example `EACCES`): the ids in such a file are unknown, and a clean-up that took them for none would let the processes run on.
 * @example
 * ```ts
 * await readProcessIdFiles(['/tmp/project/agent.pid']) // => [4242]
 * ```
 */
export async function readProcessIdFiles(
  paths: readonly string[],
): Promise<number[]> {
  const written = await Promise.all(
    paths.map((path) =>
      readFile(path, 'utf8').catch((error: unknown) => {
        // A file not written (yet) names no process; any other failure is not "no pids".
        if (systemErrorCode(error) === 'ENOENT') return ''
        throw error
      }),
    ),
  )
  return written.map(Number).filter((pid) => Number.isInteger(pid) && pid > 1)
}
