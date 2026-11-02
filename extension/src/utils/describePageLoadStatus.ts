/** What {@link describePageLoadStatus} reads from a run's view: loose, because the server-render fields come from the run's snapshots. */
export type PageLoadStatusInput = {
  /** The run's state word (`paused-server`, `resuming`, `ready`, `completed`, ...). */
  runState: string | undefined
  /** Whether the run declared operations. */
  hasOperations: boolean
  /** The held server pause when one is open: its operation group (0 = entry load) and its place in its set. */
  held?: {
    isServerRender: boolean
    /** 0 for the entry load, k for the render after operation k. */
    group: number
    /** How many pauses of this set were held so far, this one included. */
    paused: number
    /** How many stops the set declares. */
    declared: number
  }
  /** Whether the run already paused an entry-render stop. */
  enteredPageLoad: boolean
  /** Whether any operation was sent. */
  operationStarted: boolean
}

/**
 * Words the entry-load phase of a server-render run for the status item and the run resource (task 3a).
 * Called by {@link describeOperationStatus} callers in {@link StudyWorkspace} and {@link StudyService}.
 * @param input - The run's state and its held pause.
 * @returns
 * - `Page load · paused in server render` (plus ` (<n> of <m>)` for a set of several stops) while an entry-render pause is held
 * - `Page load · finishing` after the last entry-render continue until the page loaded
 * - `Page load · complete` for a finished run without operations
 * - `undefined` otherwise, so today's texts apply
 * @example
 * describePageLoadStatus({ runState: 'paused-server', hasOperations: true, enteredPageLoad: true, operationStarted: false, held: { isServerRender: true, group: 0, paused: 2, declared: 3 } })
 * // => 'Page load · paused in server render (2 of 3)'
 */
export function describePageLoadStatus(
  input: PageLoadStatusInput,
): string | undefined {
  const { held } = input
  if (held?.isServerRender && held.group === 0) {
    const set = held.declared > 1 ? ` (${held.paused} of ${held.declared})` : ''
    return `Page load · paused in server render${set}`
  }
  if (
    input.enteredPageLoad &&
    !input.operationStarted &&
    !held &&
    input.runState === 'resuming'
  )
    return 'Page load · finishing'
  if (
    input.enteredPageLoad &&
    !input.hasOperations &&
    input.runState === 'completed'
  )
    return 'Page load · complete'
  return undefined
}
