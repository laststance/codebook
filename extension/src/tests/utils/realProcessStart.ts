import {
  readProcessStart,
  type ProcessStartInputs,
} from '../../utils/readProcessStart'

/** How long a test waits for the system to name a process's start (milliseconds): ten times the product's bound, because the first PowerShell of a Windows runner starts cold and can take longer than the 3 s the product gives a query. */
const REAL_START_QUERY_TIMEOUT_MS = 30_000

/** What each system is asked for a process's start, as a failed read names it. */
const START_QUERIES_BY_NAME: Partial<Record<NodeJS.Platform, string>> = {
  linux: 'the read of /proc/<pid>/stat',
  darwin: 'the query /bin/ps -o lstart= -p <pid>',
  win32:
    'the PowerShell query (Get-Process -Id <pid>).StartTime, started from %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
}

/**
 * Reads a process's start for a test that needs the system's own answer, with a time bound of the tests' own, and fails with a sentence that names the query when the system gives none: a test that judged a real process without its start would otherwise fail later, as a wrong judgement that says nothing about the read.
 * The tests of the storage lock, of the judgement and of the reader call it for this process before their first case, so that the one read of this process's own start, which the product keeps and which it would keep as failed for a minute, is made with this bound, and for every child process they judge. It can stand in for {@link readProcessStart} wherever a judgement takes a reader.
 * @param pid - The process id of a running process of the test.
 * @param inputs - What the start is read with; the real system unless a test of this utility names its own. The time bound is always the tests' own.
 * @returns The start, as {@link readProcessStart} gives it.
 * @throws "The start of process <pid> could not be read: …", naming the query, when the system names no start within 30 s.
 * @example
 * before(() => realProcessStart(process.pid))
 * await realProcessStart(child.pid!) // => 'linux@4026531836:16362446'
 */
export async function realProcessStart(
  pid: number,
  inputs: ProcessStartInputs = {},
): Promise<string> {
  const start = await readProcessStart(pid, {
    ...inputs,
    queryTimeoutMs: REAL_START_QUERY_TIMEOUT_MS,
  })
  if (start !== undefined) return start
  const platform = inputs.platform ?? process.platform
  const query =
    START_QUERIES_BY_NAME[platform] ??
    `a platform that has no start query (${platform})`
  throw new Error(
    `The start of process ${pid} could not be read: ${query} gave no start within 30 s. The tests that judge a real process need it.`,
  )
}
