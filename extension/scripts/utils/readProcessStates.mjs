import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** How long `ps` may take to print the states, and how much it may print: the same bounds as the process table's. */
const PS_TIMEOUT_MS = 5_000
const PS_MAX_BUFFER_BYTES = 16 * 1024 * 1024

/**
 * Reads the state letter out of the text of a Linux `/proc/<pid>/stat` file.
 *
 * The second field is the program's name in parentheses and may hold spaces and parentheses itself, so the fields are counted from the last `)`: the state is the first field after it.
 * @param statText - The contents of `/proc/<pid>/stat`.
 * @returns The state letter (`R`, `S`, `T`, `Z`, …), or `undefined` when the text has none.
 * @example
 * stateOfStat('4242 (node (a)) T 4100 4242') // => 'T'
 */
function stateOfStat(statText) {
  const afterName = statText.slice(statText.lastIndexOf(')') + 1).trim()
  return /^[A-Za-z]/.test(afterName) ? afterName[0] : undefined
}

/** Reads the states of the asked processes from `/proc/<pid>/stat`; a process that is not there is left out, and `undefined` answers a system without `/proc`. @example readLinuxStates([4242]) // => Map { 4242 => 'T' } */
function readLinuxStates(pids) {
  // Without `/proc` every read would fail and every process would look gone.
  readFileSync('/proc/self/stat', 'utf8')
  const states = new Map()
  for (const pid of pids) {
    try {
      const state = stateOfStat(readFileSync(`/proc/${pid}/stat`, 'utf8'))
      if (state !== undefined) states.set(pid, state)
    } catch {
      // The process ended, or never existed.
    }
  }
  return states
}

/** Reads the states from `ps -A -o pid=,stat=` (macOS, other POSIX systems), whose first letter is the state; answers `undefined` when `ps` fails or prints no state, as a `ps` without the column does. @example readPsStates([4242]) // => Map { 4242 => 'T' } */
function readPsStates(pids) {
  const answer = spawnSync('ps', ['-A', '-o', 'pid=,stat='], {
    encoding: 'utf8',
    timeout: PS_TIMEOUT_MS,
    maxBuffer: PS_MAX_BUFFER_BYTES,
  })
  if (answer.status !== 0 || typeof answer.stdout !== 'string') return undefined
  const wanted = new Set(pids)
  const states = new Map()
  let linesRead = 0
  for (const line of answer.stdout.split('\n')) {
    const [pidText, stat] = line.trim().split(/\s+/)
    const pid = Number(pidText)
    if (!Number.isInteger(pid) || !/^[A-Za-z]/.test(stat ?? '')) continue
    linesRead += 1
    if (wanted.has(pid)) states.set(pid, stat[0])
  }
  // A table without a single state is not a table that says the processes are gone.
  return linesRead === 0 ? undefined : states
}

/**
 * Reads the state of the processes asked for: `T` or `t` stopped, `Z` zombie, `X` dead, `R` or `S` or `D` and the others running.
 *
 * Why: SIGSTOP is delivered asynchronously. A process that is inside a fork when the signal comes finishes it, and stops only on its way back to user space, so the child of that fork is made after the signal was sent; a stopped process is in no system call, so once it shows as stopped every child it made is in the table. The scripts that end a tree ({@link killProcessIds}, {@link trackProcessTree}) read these states before each look at the tree, and a look counts only when every process they stopped reports its stop.
 * Linux reads `/proc/<pid>/stat` of the asked pids alone (the state is the field before the parent id, which {@link readProcessTable} reads); other POSIX systems read `ps -A -o pid=,stat=`, whose first letter is the state; Windows has no signal to wait for and answers `undefined`.
 * Called by {@link haveProcessesStopped}.
 * @param pids - The process ids to read.
 * @param options.platform - A value of `process.platform`; a test passes `darwin` to take the `ps` path on Linux.
 * @returns A map from a process id to its state letter, without the processes that are not listed (gone); `undefined` when the states cannot be read (Windows, no `/proc`, no `ps`, a `ps` that fails or prints no state column).
 * @example
 * readProcessStates([child.pid]).get(child.pid) // => 'S'
 */
export function readProcessStates(pids, { platform = process.platform } = {}) {
  if (platform === 'win32') return undefined
  try {
    return platform === 'linux' ? readLinuxStates(pids) : readPsStates(pids)
  } catch {
    // Unreadable states are no states: the caller counts its look as it did before the states were read.
    return undefined
  }
}
