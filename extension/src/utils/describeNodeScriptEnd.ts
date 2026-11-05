import {
  NODE_SERVER_RESPONSE_SHOWN_BYTES,
  type NODE_SCRIPT_END_LIMITS,
} from '../constants'
import type { NodeScriptEndView } from '../nodeScriptRuntimeTypes'

import type { NodeServerExit } from './launchNodeServer'
import { hidePrivateRoots, type CauseRoots } from './sanitizeCause'

/** What ended a script run when Codebook itself started the ending: `codebook_stop`, or a limit it enforced. */
export type NodeScriptEndCause =
  | { kind: 'stopped' }
  | { kind: 'limit'; limit: (typeof NODE_SCRIPT_END_LIMITS)[number] }

/** What {@link describeNodeScriptEnd} reads of a finished run. */
export type NodeScriptEndInput = {
  /** A cause Codebook started; it outranks the signal that ending sent. */
  cause?: NodeScriptEndCause
  /** The process's own exit event; absent when it could not be read. */
  exit?: NodeServerExit
  /** Every declared stop index. */
  declaredStopIndices: number[]
  /** Declared stops captured, in hit order (repeats allowed). */
  stopsReached: number[]
  captureBudgetExhausted: boolean
  /** The combined output as the launcher kept it. */
  output: string
  roots: CauseRoots
}

/**
 * Cuts the output to the last {@link NODE_SERVER_RESPONSE_SHOWN_BYTES} bytes at a character boundary and hides private roots.
 * @param output - The kept output.
 * @param roots - The private roots to hide.
 * @returns The shown tail and whether bytes were cut.
 * @example outputTail('hello', roots) // => { tail: 'hello', truncated: false }
 */
function outputTail(
  output: string,
  roots: CauseRoots,
): { tail: string; truncated: boolean } {
  const bytes = Buffer.from(hidePrivateRoots(output, roots))
  if (bytes.byteLength <= NODE_SERVER_RESPONSE_SHOWN_BYTES)
    return { tail: bytes.toString(), truncated: false }
  const cut = bytes.subarray(
    bytes.byteLength - NODE_SERVER_RESPONSE_SHOWN_BYTES,
  )
  // A cut inside a multi-byte character leaves replacement characters at the start; they are dropped.
  return { tail: cut.toString().replace(/^�+/, ''), truncated: true }
}

/**
 * Builds the end of a script run: its kind by the precedence a cause Codebook started over the process's own exit code or signal, the stops reached and not reached (not observed once the capture budget was spent), and the output tail.
 * Called by the script run once its process group is released, and by tests of the precedence.
 * @param input - The cause, exit, stops and output.
 * @returns The end the run resource shows and the history records (the tail excluded).
 * @example
 * describeNodeScriptEnd({ exit: { exitCode: 3, signal: null }, declaredStopIndices: [0, 1], stopsReached: [0], captureBudgetExhausted: false, output: 'x', roots }).stopsNeverReached // => [1]
 */
export function describeNodeScriptEnd(
  input: NodeScriptEndInput,
): NodeScriptEndView {
  const reached = [...new Set(input.stopsReached)].sort((a, b) => a - b)
  const unreached = input.declaredStopIndices.filter(
    (index) => !reached.includes(index),
  )
  const stops = {
    stopsReached: reached,
    // Once the budget was spent the breakpoints were retired, so a stop not reached is not observed rather than never reached.
    stopsNeverReached: input.captureBudgetExhausted ? [] : unreached,
    ...(input.captureBudgetExhausted
      ? {
          captureBudgetExhausted: true as const,
          stopsNotObserved: unreached,
        }
      : {}),
    output: outputTail(input.output, input.roots),
  }
  if (input.cause?.kind === 'limit')
    return { kind: 'limit', limit: input.cause.limit, ...stops }
  if (input.cause?.kind === 'stopped') return { kind: 'stopped', ...stops }
  if (input.exit?.signal)
    return { kind: 'signal', signal: input.exit.signal, ...stops }
  if (typeof input.exit?.exitCode === 'number')
    return { kind: 'exited', exitCode: input.exit.exitCode, ...stops }
  return {
    kind: 'exited',
    exitUnknown: 'The process exit code could not be read.',
    ...stops,
  }
}
