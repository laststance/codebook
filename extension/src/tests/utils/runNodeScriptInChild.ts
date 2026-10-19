import { spawn } from 'node:child_process'

/** How a script run by {@link runNodeScriptInChild} ended. */
type ChildScriptEnd<Output> = {
  /** The child's exit code; `null` when a signal ended it. */
  exitCode: number | null
  /** The signal that ended the child: `'SIGABRT'` when the process aborted (V8's `FATAL ERROR: Reached heap limit`, which a shell reports as exit code 134), `'SIGKILL'` when it ran past its time and was killed. */
  signal: NodeJS.Signals | null
  /** What the child wrote on its standard output, read as JSON; `undefined` when it wrote nothing that reads as JSON of the expected shape (a child that aborted wrote nothing). */
  output: Output | undefined
}

/**
 * Runs a compiled script of the tests in a child process of this Node binary, without a shell, hands it its input as JSON on its standard input, and reads the JSON it writes on its standard output.
 * Why: a page worker that reaches its heap limit can abort its whole process on a Node build without pointer compression (`FATAL ERROR: Reached heap limit`, `SIGABRT`) instead of ending its thread; run in a child, such an abort ends the test in its assertion instead of ending the test runner. The child's standard error goes to the test's, so an abort's report is seen.
 * Called by the tests' helpers that run page workers in a child process ({@link pagesServedInChildProcess}, {@link readerAnswersInChildProcess}).
 * @param scriptPath - The compiled script; it reads its input from its standard input and writes one JSON value on its standard output.
 * @param input - What the script is handed, as JSON.
 * @param waitMs - How long the child may run before it is killed with `SIGKILL`.
 * @param isOutput - Tells whether the JSON the child wrote has the shape the caller reads.
 * @returns How the child ended ({@link ChildScriptEnd}).
 * @example
 * await runNodeScriptInChild('/x/dist/tests/utils/pagesServedInChildProcess.js', { pages: ['<p></p>'] }, 30_000, isServedPageList)
 * // => { exitCode: 0, signal: null, output: [{ state: 'served', html: '…' }] }
 */
export function runNodeScriptInChild<Output>(
  scriptPath: string,
  input: unknown,
  waitMs: number,
  isOutput: (value: unknown) => value is Output,
): Promise<ChildScriptEnd<Output>> {
  return new Promise((resolveEnd, rejectEnd) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const outputChunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk))
    // A child that runs past its time is killed, so the test ends in its assertion.
    const killer = setTimeout(() => child.kill('SIGKILL'), waitMs)
    child.once('error', (error) => {
      clearTimeout(killer)
      rejectEnd(error)
    })
    child.once('close', (exitCode, signal) => {
      clearTimeout(killer)
      const output = jsonOrUndefined(
        Buffer.concat(outputChunks).toString('utf8'),
      )
      resolveEnd({
        exitCode,
        signal,
        output: isOutput(output) ? output : undefined,
      })
    })
    child.stdin.end(JSON.stringify(input))
  })
}

/**
 * Reads a child's output as JSON; called by {@link runNodeScriptInChild} when the child has ended.
 * @param text - The output.
 * @returns The value, or `undefined` when the text is empty or no JSON (a child that aborted wrote nothing).
 * @example jsonOrUndefined('{"a":1}') // => { a: 1 }
 */
function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
