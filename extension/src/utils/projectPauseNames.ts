import {
  describePauseName,
  joinPauseName,
  type PauseAttribution,
  type PauseExecution,
  type PauseNameParts,
} from './describePauseName'

/** The fields of a saved observation this projection reads; format 8 adds `execution` and the indexes, a format 7 study has none of them. */
type PauseFields = {
  participant?: unknown
  execution?: unknown
  attribution?: unknown
  operationIndex?: unknown
  declaredIndex?: unknown
  executionIndex?: unknown
  source?: unknown
}

/** A declared stop as the study's configuration lists it. */
type ConfiguredStopPlace = {
  participant?: string
  source: { path: string; line: number }
}

/** One observation of a saved study with the name of its pause. */
export type NamedPause<T> = {
  observation: T
  /** `undefined` for a browser pause, which keeps its own name. */
  name: PauseNameParts | undefined
}

const EXECUTIONS: readonly string[] = [
  'browser',
  'server-action',
  'server-render',
]
const ATTRIBUTIONS: readonly string[] = [
  'entry-load',
  'after-operation',
  'unconfirmed',
]

/** Reads a number field of a loosely typed observation. @example numberOf(3) // => 3 */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The line an observation paused on. @example lineOf({ source: { line: 4 } }) // => 4 */
function lineOf(fields: PauseFields): number | undefined {
  return numberOf((fields.source as { line?: unknown } | undefined)?.line)
}

/**
 * Finds the repository path of the stop an observation paused at, from the study's configuration.
 * A format 8 observation names its stop by `declaredIndex`; a format 7 one is matched by participant and declared line.
 * @param stops - The configuration's stops in declared order.
 * @param fields - The observation's fields.
 * @returns The stop's path, or `'unknown source'` when no stop matches.
 * @example pathOfStop([{ participant: 'server', source: { path: 'a.ts', line: 3 } }], { participant: 'server', source: { line: 3 } }) // => 'a.ts'
 */
function pathOfStop(
  stops: readonly ConfiguredStopPlace[],
  fields: PauseFields,
): string {
  const declaredIndex = numberOf(fields.declaredIndex)
  const byIndex = declaredIndex === undefined ? undefined : stops[declaredIndex]
  if (byIndex) return byIndex.source.path
  const sameParticipant = stops.filter(
    (stop) => (stop.participant ?? 'browser') === fields.participant,
  )
  return (
    (
      sameParticipant.find((stop) => stop.source.line === lineOf(fields)) ??
      sameParticipant[0]
    )?.source.path ?? 'unknown source'
  )
}

/** Names the pause of one observation. @example nameOf({ participant: 'server' }, stops) // the Server action name */
function nameOf(
  fields: PauseFields,
  stops: readonly ConfiguredStopPlace[],
): PauseNameParts | undefined {
  const execution = EXECUTIONS.includes(String(fields.execution))
    ? (fields.execution as PauseExecution)
    : undefined
  const attribution = ATTRIBUTIONS.includes(String(fields.attribution))
    ? (fields.attribution as PauseAttribution)
    : undefined
  const participant =
    fields.participant === 'server' || fields.participant === 'browser'
      ? fields.participant
      : undefined
  return describePauseName({
    participant,
    execution,
    attribution,
    operationIndex: numberOf(fields.operationIndex),
    path: pathOfStop(stops, fields),
    line: lineOf(fields) ?? 1,
  })
}

/**
 * Names every pause of a saved study and lists them in the order the run paused them.
 * Called by {@link StudyWorkspace} for the Observed moments and the selected-stop label of a replay (task 3a). A pause of one set (the same render) is listed in execution order, with its declared position added when that differs; a study without `executionIndex` keeps the saved order.
 * @param observations - The study's observations as saved.
 * @param stops - The study configuration's stops in declared order, for the path of each pause.
 * @returns The observations with their names, in execution order when every observation carries `executionIndex`.
 * @example
 * projectPauseNames([{ participant: 'server', execution: 'server-render', attribution: 'entry-load', declaredIndex: 0, executionIndex: 0, source: { line: 4 } }], stops)[0]?.name?.text // => 'Page load · Server render · app/page.tsx:4'
 */
export function projectPauseNames<T extends object>(
  observations: readonly T[],
  stops: readonly ConfiguredStopPlace[],
): NamedPause<T>[] {
  const executionIndexOf = (observation: T): number | undefined =>
    numberOf((observation as PauseFields).executionIndex)
  // Execution order needs every observation to say where the run paused it.
  const isOrdered = observations.every(
    (observation) => executionIndexOf(observation) !== undefined,
  )
  const ordered = isOrdered
    ? [...observations].sort(
        (a, b) => (executionIndexOf(a) ?? 0) - (executionIndexOf(b) ?? 0),
      )
    : [...observations]
  return withDeclaredPositions(
    ordered.map((observation) => ({
      observation,
      name: nameOf(observation as PauseFields, stops),
    })),
  )
}

/**
 * Adds ` (declared <i>)` to a server-render pause whose place in its set's declared order differs from the place the run paused it in.
 * A set is the pauses of one render: the entry load, or the render after one operation.
 * @param named - The named pauses in execution order.
 * @returns The same pauses; one out of declared order carries `declared` and the longer text.
 * @example withDeclaredPositions(named)
 */
function withDeclaredPositions<T extends object>(
  named: NamedPause<T>[],
): NamedPause<T>[] {
  const sets = new Map<number, NamedPause<T>[]>()
  for (const pause of named) {
    if (pause.name?.kind !== 'Server render') continue
    const group =
      numberOf((pause.observation as PauseFields).operationIndex) ?? 0
    sets.set(group, [...(sets.get(group) ?? []), pause])
  }
  const declaredOf = (pause: NamedPause<T>): number =>
    numberOf((pause.observation as PauseFields).declaredIndex) ?? 0
  const declaredPositions = new Map<NamedPause<T>, number>()
  for (const set of sets.values()) {
    const byDeclared = [...set].sort((a, b) => declaredOf(a) - declaredOf(b))
    set.forEach((pause, executionPosition) => {
      const declaredPosition = byDeclared.indexOf(pause)
      // Only a pause with a declared index can be out of order.
      if (
        declaredPosition !== executionPosition &&
        numberOf((pause.observation as PauseFields).declaredIndex) !== undefined
      )
        declaredPositions.set(pause, declaredPosition + 1)
    })
  }
  return named.map((pause) => {
    const declared = declaredPositions.get(pause)
    if (!pause.name || declared === undefined) return pause
    const { text: _text, ...parts } = pause.name
    return {
      observation: pause.observation,
      name: { ...parts, declared, text: joinPauseName({ ...parts, declared }) },
    }
  })
}

/**
 * Says whether a saved study holds a server-render pause, which is when the replay shows the run-level first-execution note.
 * Called by {@link PlaybackController} for the replay state.
 * @param observations - The study's observations as saved.
 * @returns `true` when one observation has `execution: 'server-render'`.
 * @example hasServerRenderPause([{ execution: 'server-render' }]) // => true
 */
export function hasServerRenderPause(observations: readonly object[]): boolean {
  return observations.some(
    (observation) => (observation as PauseFields).execution === 'server-render',
  )
}
