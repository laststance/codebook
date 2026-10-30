import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

/** Tells whether a process exists: `process.kill(pid, 0)` throws `ESRCH` for a process that is gone. @example processRuns(4242) // => false */
export function processRuns(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

/**
 * Kills the given processes with SIGKILL, one by one, and answers which of them still run after the wait.
 * Called by {@link endProcessesAfter} when a test ends, and by the test of this helper with a kill that kills nothing, to show that a survivor is reported.
 * @param pids - Ids of processes a test started; ids that are gone already are not signalled (a recycled id is not the test's).
 * @param options - `kill` replaces the signal call, `waitMs` is how long a killed process may take to be seen gone (5 s by default).
 * @returns The ids that still run once the wait is over; empty when all are gone.
 * @example
 * await endProcesses([4242, 4243]) // => []
 */
export async function endProcesses(pids, { kill, waitMs = 5_000 } = {}) {
  const signal = kill ?? ((pid) => process.kill(pid, 'SIGKILL'))
  const running = [...new Set(pids)].filter(
    (pid) => Number.isInteger(pid) && pid > 1 && processRuns(pid),
  )
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
  return survivors
}

/**
 * Registers the end of the processes a test started, with a check that they are gone: the test fails when one outlives it.
 * A test registers it before the first await that can fail, with a reader that finds the ids when the test ends (a pid file the fixture writes, a list that fills while the test runs), so a failed assertion, a timeout or an early return leaves no process behind. The tool under test may still be asserted to end the same process earlier; this only removes what is left.
 * @param context - The running test.
 * @param readPids - Answers the ids to end; read once, when the test ends.
 * @param killTree - Ends the given ids and what they started (`killProcessIds`); a plain SIGKILL of each id is used without it.
 * @example
 * endProcessesAfter(context, () => readPids(join(root, 'pids.log')))
 */
export function endProcessesAfter(context, readPids, killTree) {
  context.after(async () => {
    const pids = await readPids()
    killTree?.(pids)
    const survivors = await endProcesses(pids)
    // A process that outlives its test would run until the machine restarts.
    assert.deepEqual(survivors, [], 'processes of the test outlived it')
  })
}

/** Reads the process ids a fixture noted in a file, one per line; none when the file is not there. @example await readNotedPids('/tmp/root/pids.log') // => [4242] */
export async function readNotedPids(path) {
  return (await readFile(path, 'utf8').catch(() => ''))
    .split('\n')
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 1)
}
