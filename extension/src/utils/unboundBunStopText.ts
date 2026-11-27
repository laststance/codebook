import type { NodeServerStopTarget } from '../nodeServerDebugger'

/**
 * Words the failure of a Bun run whose declared stop the debugger left unverified after the late arming, so the chat can declare another line before any request is sent.
 *
 * Why it exists: a Bun run arms its stops once the server listens, when the modules its request runs are loaded, so a stop still unverified then never binds. js-debug keeps its own module-entry breakpoint on the first line Bun can pause at in each module that holds a stop (in a module whose top level only declares functions, the first statement of its first function), and a second breakpoint on that exact place is never verified (Cycle 0152 Task 6 in Cursor: a stop on `const greeting = …`, the first statement of `greet`).
 * Called by `NodeProcessRun.armDeferredStops` when an armed stop has no bound line.
 *
 * @param stop - The declared stop that did not bind.
 * @returns The sentence that names the stop (one-based, as the run's other sentences count stops), the cause and the recovery.
 * @example
 * unboundBunStopText({ declaredStopIndex: 1, path: 'src/greeting.ts', line: 2 })
 * // => 'Declared stop 2 at src/greeting.ts:2 did not bind on Bun: …'
 */
export function unboundBunStopText(
  stop: Pick<NodeServerStopTarget, 'declaredStopIndex' | 'path' | 'line'>,
): string {
  return `Declared stop ${stop.declaredStopIndex + 1} at ${stop.path}:${stop.line} did not bind on Bun: the debugger verified no breakpoint on that line once the server listened, so the request was not sent. On Bun the first line a module can pause at (in a module that only declares functions, the first statement of its first function) holds the debugger's own module-entry breakpoint, and code that is not loaded yet cannot be armed. Declare the stop on another line of the same function, then start a new run.`
}
