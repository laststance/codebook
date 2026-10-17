import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** What a bounded query of the system is run with: how long it may run and how much it may print, a signal no process can ignore, no console window on Windows, and, for a query whose answer depends on them, the locale and time zone it prints in. */
export type BoundedQueryOptions = {
  timeout: number
  maxBuffer: number
  killSignal: 'SIGKILL'
  windowsHide: true
  env?: Record<string, string>
}

/** Runs a bounded query and answers what it printed; it rejects when the query fails, runs longer than its time bound or prints more than its limit. The shape of {@link runBoundedQuery} and of the runner a test names in its place. */
export type BoundedQueryRunner = (
  file: string,
  queryArguments: string[],
  options: BoundedQueryOptions,
) => Promise<{ stdout: string }>

/**
 * Runs one bounded query of the system without a shell and closes its input, which no such query reads and which, left open, can keep PowerShell waiting; the runner of {@link listProcesses} and of {@link readProcessStart} unless a test names its own.
 * The query is ended with `options.killSignal` once it runs longer than `options.timeout` milliseconds or prints more than `options.maxBuffer` bytes; Node.js marks the error of a query it ended so (`killed`, `signal`, `code`).
 * @param file - The program, started without a shell; a full path where a bare name could be looked up in the current directory first (PowerShell on Windows, {@link windowsPowerShellPath}).
 * @param queryArguments - The program's arguments, each handed over as it is.
 * @param options - The query's bounds ({@link BoundedQueryOptions}).
 * @returns What the query printed on its standard output and its error output.
 * @throws The error of `execFile` when the program cannot be started, ends with an error, runs past its time bound or prints past its limit.
 * @example
 * await runBoundedQuery('ps', ['-axww', '-o', 'pid=,command='], { timeout: 10_000, maxBuffer: 67_108_864, killSignal: 'SIGKILL', windowsHide: true })
 * // => { stdout: '    1 /sbin/launchd\n…', stderr: '' }
 */
export const runBoundedQuery: BoundedQueryRunner = (
  file,
  queryArguments,
  options,
) => {
  const query = promisify(execFile)(file, queryArguments, options)
  query.child.stdin?.end()
  return query
}
