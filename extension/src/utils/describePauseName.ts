/** The kinds of code a recorded pause can be in; `server-render`, `server-action` and `route-handler` are server participants, `browser` keeps its own names. */
export type PauseExecution =
  'browser' | 'server-action' | 'server-render' | 'route-handler'

/** How a server-render pause is tied to the operations of its run (Design decision D13); `after-operation` means "observed after", never "caused by". */
export type PauseAttribution =
  'entry-load' | 'after-operation' | 'unconfirmed' | 'preparation'

/** What {@link describePauseName} reads from one recorded pause. */
export type PauseNameInput = {
  /** The pause's participant; a format 7 study has no `execution`, so a `server` participant reads as a server action. */
  participant?: 'browser' | 'server'
  execution?: PauseExecution
  attribution?: PauseAttribution
  /** `module` for a pause inside a module's evaluation (format 12). */
  scope?: 'module'
  /** The request a route-handler pause was observed for (format 13): its HTTP method and the route pattern from the file path. */
  routeHandler?: { method: string; route: string }
  /** 1-based operation the pause was observed after; absent or 0 for the entry load. */
  operationIndex?: number
  /** Repository path of the paused source file. */
  path: string
  /** The line the pause is on. */
  line: number
}

/** A pause name in the pieces the replay lays out by priority when space is short: state first, then the name, then the path (D034). */
export type PauseNameParts = {
  /** `Page load`, `Preparation` or `After operation <k>`; absent for a server action that follows no operation. */
  state?: string
  /** `Server render` or `Server action`. */
  kind:
    | 'Server render'
    | 'Module evaluation'
    | 'Server action'
    | `Route handler ${string}`
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
 * Picks the kind word of a server pause: a module-evaluation pause reads `Module evaluation` in place of `Server render`, because the code that ran is a module's top level, not the render.
 * Called by {@link describePauseName}.
 * @param execution - The pause's server execution.
 * @param input - The recorded pause's fields: `scope` `module` reads Module evaluation, `routeHandler` names a route handler's request.
 * @returns The kind word.
 * @example
 * kindOfPause('server-render', { scope: 'module', path: 'a.ts', line: 1 }) // => 'Module evaluation'
 * kindOfPause('route-handler', { routeHandler: { method: 'POST', route: '/api/todos' }, path: 'a.ts', line: 1 }) // => 'Route handler POST /api/todos'
 */
function kindOfPause(
  execution: 'server-render' | 'server-action' | 'route-handler',
  input: PauseNameInput,
): PauseNameParts['kind'] {
  if (execution === 'server-action') return 'Server action'
  // A route handler is named by its request, never as a render: `Route handler POST /api/todos`.
  if (execution === 'route-handler')
    return `Route handler ${[input.routeHandler?.method, input.routeHandler?.route].filter(Boolean).join(' ')}`
  return input.scope === 'module' ? 'Module evaluation' : 'Server render'
}

/**
 * Picks the state word of a server pause: `After operation <k>`, `Preparation` for Codebook's own request (the learner's page load had not happened yet), `Page load` for a render, none for a server action that follows no operation.
 * Called by {@link describePauseName}.
 * @param execution - The pause's server execution.
 * @param input - The recorded pause's fields.
 * @returns The state word, or `undefined` when there is none.
 * @example stateOfPause('server-render', { attribution: 'preparation', path: 'a.ts', line: 1 }) // => 'Preparation'
 */
function stateOfPause(
  execution: 'server-render' | 'server-action' | 'route-handler',
  input: PauseNameInput,
): string | undefined {
  // `Operation 0` never appears: an entry-load pause (no operation, or 0) reads Page load.
  if (input.operationIndex !== undefined && input.operationIndex >= 1)
    return `After operation ${input.operationIndex}`
  if (execution !== 'server-render') return undefined
  return input.attribution === 'preparation' ? 'Preparation' : 'Page load'
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
 * describePauseName({ execution: 'server-render', attribution: 'preparation', scope: 'module', path: 'db/index.ts', line: 12 })?.text
 * // => 'Preparation · Module evaluation · db/index.ts:12'
 * describePauseName({ execution: 'route-handler', attribution: 'after-operation', operationIndex: 2, routeHandler: { method: 'POST', route: '/api/todos' }, path: 'app/api/todos/route.ts', line: 25 })?.text
 * // => 'After operation 2 · Route handler POST /api/todos · app/api/todos/route.ts:25'
 */
export function describePauseName(
  input: PauseNameInput,
): PauseNameParts | undefined {
  // A pause without `execution` comes from a format 7 study, where a server participant's pause is a server action.
  const execution =
    input.execution ??
    (input.participant === 'server' ? 'server-action' : 'browser')
  if (execution === 'browser') return undefined
  const kind = kindOfPause(execution, input)
  const state = stateOfPause(execution, input)
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
