/** What an agent process's exit said, as data: the Cursor agent's exit code or signal ({@link CursorAgentExitError}); absent for a VS Code chat and for a run that ended otherwise. */
export type WikiAgentExit = {
  exitCode: number | null
  exitSignal: string | null
}

/**
 * Reads the exit code or signal off a failure of the Cursor agent's process ({@link CursorAgentExitError}), by its fields, so a stand-in of the runner in a test is read as the runner is.
 * @param error - What the Cursor agent's run threw.
 * @returns The exit code and signal where the failure carries them; `undefined` for any other failure.
 * @example
 * agentExitOf(Object.assign(new Error('…'), { exitCode: 1, exitSignal: null })) // => { exitCode: 1, exitSignal: null }
 * agentExitOf(new Error('The Wiki update was cancelled.'))                    // => undefined
 */
export function agentExitOf(error: unknown): WikiAgentExit | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const exitCode: unknown = Reflect.get(error, 'exitCode')
  const exitSignal: unknown = Reflect.get(error, 'exitSignal')
  // Only a failure that carries the process's own answer has one; a cancel, a bound or a start failure carries none.
  if (typeof exitCode !== 'number' && typeof exitSignal !== 'string')
    return undefined
  return {
    exitCode: typeof exitCode === 'number' ? exitCode : null,
    exitSignal: typeof exitSignal === 'string' ? exitSignal : null,
  }
}
