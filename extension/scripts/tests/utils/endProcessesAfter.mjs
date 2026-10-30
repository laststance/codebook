import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

// There are two of these helpers on purpose: this one serves `scripts/tests`, which run on plain Node without a build (the Windows job's `scripts/tests` step among them) and so cannot import the compiled `src/tests/utils/endProcessesAfter.ts`, and that one serves the extension's compiled tests, which cannot import this `.mjs`. Keep their process rules (zombie, ownership) in step: a change here is made there too.

/** How many parents {@link ownershipOf} follows up from a process before it gives up; a tree of a test is a few levels deep. */
const MAX_PARENT_HOPS = 64

/**
 * Reads the state, the parent id and the age of one process from `ps`.
 * @param pid - The process id.
 * @param exec - Runs `ps` ({@link execFileSync} by default); tests of this helper replace it to make `ps` fail.
 * @returns `{ state, parentPid, ageSeconds }`; `undefined` when `ps` exits with status 1 (no process has this id); `'unreadable'` where `ps` cannot answer (no `ps`, or it fails to run).
 * @example readProcess(process.pid) // => { state: 'S+', parentPid: 4100, ageSeconds: 3 }
 */
export function readProcess(pid, exec = execFileSync) {
  let printed
  try {
    printed = exec('ps', ['-o', 'stat=,ppid=,etime=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    // `ps` exits with status 1 only when no process has this id; any other failure (no `ps`, EAGAIN, EMFILE, ENOMEM...) cannot say, and must not read as "gone".
    return error?.status === 1 ? undefined : 'unreadable'
  }
  const [state, parentText, elapsed] = printed.trim().split(/\s+/)
  if (!state || !elapsed) return undefined
  // `etime` is [[dd-]hh:]mm:ss.
  const [days, clock] = elapsed.includes('-')
    ? elapsed.split('-')
    : [0, elapsed]
  const [seconds = 0, minutes = 0, hours = 0] = clock
    .split(':')
    .map(Number)
    .reverse()
  return {
    state,
    parentPid: Number(parentText),
    ageSeconds: Number(days) * 86_400 + hours * 3_600 + minutes * 60 + seconds,
  }
}

/** Tells whether a process runs: a zombie nobody has reaped yet counts as gone (`process.kill(pid, 0)` finds it), and a system without `ps` falls back to that probe, where `ESRCH` means gone. @example processRuns(4242) // => false */
export function processRuns(pid) {
  const process_ = readProcess(pid)
  if (process_ === 'unreadable') {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error.code !== 'ESRCH'
    }
  }
  return process_ !== undefined && !process_.state.startsWith('Z')
}

/**
 * Reads the ancestors of this process once: the runner that started it and what started that, up to (not including) process 1.
 *
 * Called by {@link endProcesses} and {@link endProcessesAfter}, once per end, so that classifying several ids does not run one `ps` per hop for every id; {@link ownershipOf} reads it itself only when its caller gives no set.
 * @param read - Reads one process's facts ({@link readProcess} by default); tests of this helper replace it.
 * @returns The ids of the ancestors; where `ps` cannot answer, the ones reached up to that hop.
 * @example ancestorsOf() // => Set { 4100, 3990 }
 */
function ancestorsOf(read = readProcess) {
  const ancestors = new Set()
  let ancestor = process.ppid
  for (let hop = 0; hop < MAX_PARENT_HOPS && ancestor > 1; hop += 1) {
    ancestors.add(ancestor)
    const parent = read(ancestor)
    if (typeof parent !== 'object') break
    ancestor = parent.parentPid
  }
  return ancestors
}

/**
 * Tells how a running process stands to this test process, so a recycled id of an unrelated process is never signalled.
 * Never owned: process 1 and below, this process, and its ancestors (the runner that started it, whose group a group end would kill). Owned: an id the test holds a child handle of (`held`), a descendant of this process, or an orphan that started after `sinceMs`, as a child whose parent the test ended. An orphan's parent is process 0 or 1, or an ancestor of this process other than its direct parent: a Linux subreaper (a `systemd --user` manager, a container init that is not process 1) adopts it instead of process 1, and the adopter is always a living ancestor of the chain the orphan came from. The direct parent (`process.ppid`) is excluded: it is the `node --test` runner, which starts sibling test-file processes all the time and is never a subreaper (Node never sets PR_SET_CHILD_SUBREAPER), so a young child of it is a sibling, not an adopted orphan. The remaining exposure is an id recycled to a process that process 1 or a farther ancestor started after the test began, the same class the process 1 rule always had. Where `ps` cannot answer and no handle is held, nothing confirms the id: `'unconfirmed'`, and the caller must not signal it.
 * @param pid - The process id.
 * @param sinceMs - The time from which a process may be the test's: when the test began.
 * @param read - Reads one process's facts ({@link readProcess} by default); tests of this helper replace it.
 * @param held - Ids of children the test holds a handle of.
 * @param ancestors - The ancestors of this process ({@link ancestorsOf}); read here when not given.
 * @returns `'owned'`, `'foreign'` or `'unconfirmed'`.
 * @example ownershipOf(process.ppid, Date.now()) // => 'foreign'
 */
export function ownershipOf(
  pid,
  sinceMs,
  read = readProcess,
  held = [],
  ancestors = ancestorsOf(read),
) {
  if (pid <= 1 || pid === process.pid || pid === process.ppid) return 'foreign'
  // The ancestors of this process are the runner and what started it: never the test's children.
  if (ancestors.has(pid)) return 'foreign'
  if (held.includes(pid)) return 'owned'
  const process_ = read(pid)
  if (process_ === 'unreadable') return 'unconfirmed'
  if (process_ === undefined) return 'foreign'
  let parentPid = process_.parentPid
  for (let hop = 0; hop < MAX_PARENT_HOPS && parentPid > 1; hop += 1) {
    if (parentPid === process.pid) return 'owned'
    const parent = read(parentPid)
    if (typeof parent !== 'object') break
    parentPid = parent.parentPid
  }
  // An orphan older than the test is somebody else's, with the same id by chance.
  // The adopter of an orphan is process 0 or 1, or (Linux subreaper) an ancestor farther than the runner, which is no subreaper and has siblings of this process as children.
  const isOrphan =
    process_.parentPid <= 1 ||
    (process_.parentPid !== process.ppid && ancestors.has(process_.parentPid))
  return isOrphan && process_.ageSeconds <= (Date.now() - sinceMs) / 1000 + 2
    ? 'owned'
    : 'foreign'
}

/** The default `sinceMs` of {@link endProcesses}: when this process started. @example processStartMs() // => 1761900000000 */
function processStartMs() {
  return Date.now() - process.uptime() * 1000
}

/**
 * Kills the given processes with SIGKILL, one by one, and answers which of them still run after the wait.
 * Called by {@link endProcessesAfter} when a test ends, and by the test of this helper with a kill that kills nothing, to show that a survivor is reported.
 * @param pids - Ids of processes a test started. An id that is gone already, a zombie, or a process that cannot be the test's ({@link ownershipOf}: a recycled id of an unrelated process, process 1, this process, its ancestors) is not signalled and is no survivor. A process whose ownership cannot be confirmed (no `ps`, no held handle) is not signalled and is reported as a survivor, so the test fails instead of killing an id it cannot tell.
 * @param options - `kill` replaces the signal call, `readProcessInfo` the `ps` read, `held` names children the test holds a handle of (the test's whatever `ps` says), `waitMs` is how long a killed process may take to be seen gone (5 s by default), `sinceMs` is when the test began (when this process started by default).
 * @returns The ids that still run once the wait is over, and the ones left unsignalled for unconfirmed ownership; empty when all are gone or not the test's.
 * @example
 * await endProcesses([4242, 4243]) // => []
 */
export async function endProcesses(
  pids,
  {
    kill,
    waitMs = 5_000,
    sinceMs = processStartMs(),
    readProcessInfo = readProcess,
    held = [],
  } = {},
) {
  return endClassified(classifyRunning(pids, sinceMs, readProcessInfo, held), {
    kill,
    waitMs,
  })
}

/**
 * Signals the ids {@link classifyRunning} found to be the test's, waits for them to be gone and answers the survivors.
 *
 * Called by {@link endProcesses}, and by {@link endProcessesAfter}, which classifies the ids, lets the tree end run, then classifies them again and passes that second result here, so an id recycled in between is not signalled on the first answer. The classification already checks that each id runs, so nothing is filtered here.
 * @param classified - The result of {@link classifyRunning}.
 * @param options - `kill` replaces the signal call; `waitMs` is how long a killed process may take to be seen gone.
 * @returns The unconfirmed ids and the owned ids that still run once the wait is over.
 * @example await endClassified({ owned: [4242], unconfirmed: [] }, { waitMs: 5_000 }) // => []
 */
async function endClassified({ owned, unconfirmed }, { kill, waitMs = 5_000 }) {
  const signal = kill ?? ((pid) => process.kill(pid, 'SIGKILL'))
  const running = owned
  for (const pid of running)
    try {
      signal(pid)
    } catch {
      // It is gone already, which is what the test wants.
    }
  const until = Date.now() + waitMs
  let survivors = running.filter(processRuns)
  while (survivors.length > 0 && Date.now() < until) {
    await delay(20)
    survivors = survivors.filter(processRuns)
  }
  return [...unconfirmed, ...survivors]
}

/** Splits, once each, the ids that run into those that are surely the test's and those whose ownership cannot be confirmed; foreign ids and gone ones are left out. @example classifyRunning([4242, process.ppid], Date.now(), readProcess, []) // => { owned: [4242], unconfirmed: [] } */
function classifyRunning(
  pids,
  sinceMs,
  read,
  held,
  ancestors = ancestorsOf(read),
) {
  const owned = []
  const unconfirmed = []
  for (const pid of new Set(pids)) {
    if (!Number.isInteger(pid) || !processRuns(pid)) continue
    const kind = ownershipOf(pid, sinceMs, read, held, ancestors)
    if (kind === 'owned') owned.push(pid)
    else if (kind === 'unconfirmed') unconfirmed.push(pid)
  }
  return { owned, unconfirmed }
}

/** The ends registered per test and not run yet, so that {@link runPendingEnds} can run them ahead of a hook that removes the fixture they read. */
const pendingEnds = new WeakMap()

/**
 * Runs the process ends registered for a test, once.
 * `after` hooks run in the order they were registered, and a fixture's folder is registered for removal before the test names the pid file inside it: the pids would be unreadable by the time the end hook runs and the processes never reaped. A hook that removes such a folder calls this first, so the ends read their files while they exist; the hook that {@link endProcessesAfter} registered then finds nothing left to do.
 * @param context - The running test.
 * @returns Once every registered end has run.
 * @throws The assertion of an end whose processes outlived the test.
 * @example
 * context.after(async () => { try { await runPendingEnds(context) } finally { await rm(root, { recursive: true, force: true }) } })
 */
export async function runPendingEnds(context) {
  const ends = pendingEnds.get(context) ?? []
  // Taken first: a second caller finds none, so no end runs twice.
  pendingEnds.set(context, [])
  const results = await Promise.allSettled(ends.map((end) => end()))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}

/**
 * Registers the removal of a fixture folder at the end of a test, after the process ends that were registered for the test have read their files in it ({@link runPendingEnds}), whichever of the two was registered first.
 * @param context - The running test.
 * @param folder - The folder to remove, with everything in it.
 * @example
 * removeAfterProcessEnds(context, root)
 */
export function removeAfterProcessEnds(context, folder) {
  context.after(async () => {
    try {
      await runPendingEnds(context)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
}

/**
 * Registers the end of the processes a test started, with a check that they are gone: the test fails when one outlives it.
 * A test registers it before the first await that can fail, with a reader that finds the ids when the test ends (a pid file the fixture writes, a list that fills while the test runs), so a failed assertion, a timeout or an early return leaves no process behind. The tool under test may still be asserted to end the same process earlier; this only removes what is left. A hook that removes a folder the reader reads calls {@link runPendingEnds} before it removes it.
 * @param context - The running test.
 * @param readPids - Answers the ids to end; read once, when the test ends.
 * @param killTree - Ends the given ids and what they started (`killProcessIds`); a plain SIGKILL of each id is used without it. It gets only ids that run and are surely the test's.
 * @param options - `held` answers the children the test holds a handle of: their ids are the test's even where `ps` cannot say, and they are ended when `readPids` itself fails. `readProcessInfo` replaces the `ps` read (tests of this helper use it to show an id that changes between the tree end and the final kill).
 * @throws The failure of `readPids` (for example an unreadable pid file), after the held children were ended.
 * @example
 * endProcessesAfter(context, () => readPids(join(root, 'pids.log')))
 */
export function endProcessesAfter(context, readPids, killTree, options = {}) {
  const sinceMs = Date.now()
  pendingEnds.set(context, [
    ...(pendingEnds.get(context) ?? []),
    async () => {
      const held = options.held?.() ?? []
      const read = options.readProcessInfo ?? readProcess
      // Read once for this end and reused for every id and both classifications.
      const ancestors = ancestorsOf(read)
      /** Classifies the ids, runs the tree end on the owned ones, then classifies again before the final kill: an id recycled in between must not be signalled on the strength of the first answer. */
      const endIds = async (ids) => {
        killTree?.(classifyRunning(ids, sinceMs, read, held, ancestors).owned)
        return endClassified(
          classifyRunning(ids, sinceMs, read, held, ancestors),
          {},
        )
      }
      let noted
      try {
        noted = await readPids()
      } catch (error) {
        // The ids cannot be read, so the clean-up fails loudly; the children whose handles the test holds are ended first.
        await endIds(held)
        throw error
      }
      const survivors = await endIds(noted)
      // A process that outlives its test would run until the machine restarts.
      assert.deepEqual(survivors, [], 'processes of the test outlived it')
    },
  ])
  context.after(() => runPendingEnds(context))
}

/** Reads the process ids a fixture noted in a file, one per line; none when the file is not there (`ENOENT`). Any other read failure (for example `EACCES`) is thrown: the ids are unknown, and a clean-up that took them for none would let the processes run on. @example await readNotedPids('/tmp/root/pids.log') // => [4242] */
export async function readNotedPids(path) {
  const text = await readFile(path, 'utf8').catch((error) => {
    // A file not written (yet) names no process; any other failure is not "no pids".
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return text
    .split('\n')
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1)
}
