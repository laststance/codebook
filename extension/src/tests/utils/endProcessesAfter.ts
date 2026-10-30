import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

import { isProcessGone } from '../../utils/isProcessGone'

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
 * @param pids - Ids of processes a test started. Ids that are gone already are skipped.
 * @param options - `group` also signals the process group each id leads (a child started `detached`); `signalProcess` replaces the signal call, `waitMs` shortens the wait.
 * @returns The ids still running once the wait is over; empty when every process is gone.
 * @example
 * ```ts
 * const survivors = await endProcesses([child.pid!], { group: true }) // => []
 * ```
 */
export async function endProcesses(
  pids: readonly number[],
  options: {
    group?: boolean
    signalProcess?: SignalProcess
    waitMs?: number
  } = {},
): Promise<number[]> {
  const signalProcess: SignalProcess =
    options.signalProcess ?? ((pid, signal) => process.kill(pid, signal))
  // Only ids that run get a signal: a recycled id of an unrelated process is not this test's.
  const running = [...new Set(pids)].filter((pid) => !isProcessGone(pid))
  for (const pid of running) {
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
  let survivors = running.filter((pid) => !isProcessGone(pid))
  while (survivors.length > 0 && Date.now() < deadline) {
    await delay(PROCESS_GONE_POLL_MS)
    survivors = survivors.filter((pid) => !isProcessGone(pid))
  }
  return survivors
}

/**
 * Registers the end of every process a test started, whatever way the test ends, and fails the test when one of them cannot be ended.
 *
 * A test registers it before the first await that can fail, with a reader that finds the ids when the test ends (a file the fixture wrote its pid into, a list that fills while the test runs), so a failed assertion, a timeout or an early return leaves no process behind. The product under test may still be asserted to end the same process earlier: this only removes what is left.
 * Called by the tests that start a child that outlives its test unless something ends it.
 *
 * @param context - The running test, at whose end the processes are ended.
 * @param readPids - Answers the ids to end; read once, when the test ends.
 * @param options - `group` also ends the process group each id leads.
 * @example
 * ```ts
 * const started: number[] = []
 * endProcessesAfter(context, () => started, { group: true })
 * ```
 */
export function endProcessesAfter(
  context: TestContext,
  readPids: () => readonly number[] | Promise<readonly number[]>,
  options: { group?: boolean } = {},
): void {
  context.after(async () => {
    const survivors = await endProcesses(await readPids(), options)
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
 * @example
 * ```ts
 * await readProcessIdFiles(['/tmp/project/agent.pid']) // => [4242]
 * ```
 */
export async function readProcessIdFiles(
  paths: readonly string[],
): Promise<number[]> {
  const written = await Promise.all(
    paths.map((path) => readFile(path, 'utf8').catch(() => '')),
  )
  return written.map(Number).filter((pid) => Number.isInteger(pid) && pid > 1)
}
