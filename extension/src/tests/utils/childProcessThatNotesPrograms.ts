import * as childProcess from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Builds a stand-in for `node:child_process`, for a loaded module whose programs a test wants to know: its `execFile` notes the program of every call made through `promisify(execFile)`, as the product's Git callers make them, and runs it as the real one does.
 * @returns `childProcess`, the stand-in to hand to a loaded module as `node:child_process`, and `started`, every program started so far, in order.
 * @example
 * const noted = childProcessThatNotesPrograms()
 * const loaded = await loadModule<typeof module>(path, { 'node:child_process': noted.childProcess }) // noted.started => ['/usr/bin/git', …] after its Git commands
 */
export function childProcessThatNotesPrograms(): {
  childProcess: Record<string, unknown>
  started: string[]
} {
  const started: string[] = []
  const runReally = promisify(childProcess.execFile)
  const notingExecFile = Object.assign(
    (...callArguments: unknown[]): unknown =>
      Reflect.apply(childProcess.execFile, undefined, callArguments),
    {
      [promisify.custom]: (
        file: string,
        programArguments: string[],
        options: childProcess.ExecFileOptions,
      ) => {
        started.push(file)
        return runReally(file, programArguments, options)
      },
    },
  )
  return {
    childProcess: { ...childProcess, execFile: notingExecFile },
    started,
  }
}
