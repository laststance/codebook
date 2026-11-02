/** The kinds of code a recorded pause can be in; `server-render` and `server-action` are server participants, `browser` keeps its own names. */
export type PauseExecution = 'browser' | 'server-action' | 'server-render'

/** How a server-render pause is tied to the operations of its run (Design decision D13); `after-operation` means "observed after", never "caused by". */
export type PauseAttribution = 'entry-load' | 'after-operation' | 'unconfirmed'

/** What {@link describePauseName} reads from one recorded pause. */
export type PauseNameInput = {
  /** The pause's participant; a format 7 study has no `execution`, so a `server` participant reads as a server action. */
  participant?: 'browser' | 'server'
  execution?: PauseExecution
  attribution?: PauseAttribution
  /** 1-based operation the pause was observed after; absent or 0 for the entry load. */
  operationIndex?: number
  /** Repository path of the paused source file. */
  path: string
  /** The line the pause is on. */
  line: number
}

/** A pause name in the pieces the replay lays out by priority when space is short: state first, then the name, then the path (D034). */
export type PauseNameParts = {
  /** `Page load` or `After operation <k>`; absent for a server action that follows no operation. */
  state?: string
  /** `Server render` or `Server action`. */
  kind: 'Server render' | 'Server action'
  path: string
  line: number
  /** `route not confirmed` for an `unconfirmed` attribution; never colour alone. */
  attribution?: string
  /** 1-based position in the set's declared order, present only when it differs from the order the run paused them. */
  declared?: number
  /** The whole name as one string: the accessible name and the text of a plain label. */
  text: string
}

const ROUTE_NOT_CONFIRMED = 'route not confirmed'

/**
 * Joins the pieces of a pause name into its one-string form, with the declared-order note when the pause has one.
 * Called by {@link describePauseName} and again by {@link projectPauseNames} once the set order is known.
 * @param parts - The pieces; `text` is not read.
 * @returns `<state> · <kind> · <path:line> · <attribution> (declared <i>)`, each missing piece left out.
 * @example joinPauseName({ kind: 'Server action', path: 'a.ts', line: 3 }) // => 'Server action · a.ts:3'
 */
export function joinPauseName(parts: Omit<PauseNameParts, 'text'>): string {
  const base = [parts.state, parts.kind, `${parts.path}:${parts.line}`]
    .filter(Boolean)
    .join(' · ')
  const withAttribution = parts.attribution
    ? `${base} · ${parts.attribution}`
    : base
  return parts.declared === undefined
    ? withAttribution
    : `${withAttribution} (declared ${parts.declared})`
}

/**
 * Words one server pause for the replay's selected-stop label, its Observed moments and their accessible names (task 3a).
 * Called by {@link projectPauseNames} for every observation of a saved study; a browser pause keeps today's name and gets none here.
 * @param input - The recorded pause's fields.
 * @returns The name in pieces, or `undefined` for a browser pause.
 * @example
 * describePauseName({ execution: 'server-render', attribution: 'entry-load', path: 'app/page.tsx', line: 12 })?.text
 * // => 'Page load · Server render · app/page.tsx:12'
 * describePauseName({ execution: 'server-render', attribution: 'unconfirmed', operationIndex: 2, path: 'a.ts', line: 3 })?.text
 * // => 'After operation 2 · Server render · a.ts:3 · route not confirmed'
 */
export function describePauseName(
  input: PauseNameInput,
): PauseNameParts | undefined {
  // A pause without `execution` comes from a format 7 study, where a server participant's pause is a server action.
  const execution =
    input.execution ??
    (input.participant === 'server' ? 'server-action' : 'browser')
  if (execution === 'browser') return undefined
  const kind = execution === 'server-render' ? 'Server render' : 'Server action'
  // `Operation 0` never appears: an entry-load pause (no operation, or 0) reads Page load.
  const operation =
    input.operationIndex !== undefined && input.operationIndex >= 1
      ? input.operationIndex
      : undefined
  const state =
    operation !== undefined
      ? `After operation ${operation}`
      : execution === 'server-render'
        ? 'Page load'
        : undefined
  const attribution =
    input.attribution === 'unconfirmed' ? ROUTE_NOT_CONFIRMED : undefined
  const parts = {
    ...(state && { state }),
    kind,
    path: input.path,
    line: input.line,
    ...(attribution && { attribution }),
  } satisfies Omit<PauseNameParts, 'text'>
  return { ...parts, text: joinPauseName(parts) }
}
