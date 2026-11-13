import type { ConfiguredObservation } from '../configuredStudySchemas'
import type { ReplayRecordedInspection } from '../replayDebugAdapter'

import { maskSavedFacts } from './maskSavedFacts'

/** The inspections already derived for an observation, keyed by the observation's own `values` record so the same stop keeps one array. */
const inspectionsByValues = new WeakMap<
  ConfiguredObservation['values'],
  readonly ReplayRecordedInspection[]
>()

/**
 * Turns one recorded fact of a browser observation into the row native "Recorded inspections" lists.
 * @param name - The fact's key, `value:<path>` or `type:<path>`.
 * @param fact - The recorded fact, already masked.
 * @returns The inspection row, or `undefined` for a key that names neither mode.
 */
function inspectionOfFact(
  name: string,
  fact: ConfiguredObservation['values'][string],
): ReplayRecordedInspection | undefined {
  const separator = name.indexOf(':')
  const mode = name.slice(0, separator)
  const path = name.slice(separator + 1)
  // A type inspection records only `typeof`, so the row holds the type and never a value.
  if (mode === 'type' && typeof fact === 'string')
    return { path, mode: 'type', display: fact }
  if (mode !== 'value') return undefined
  // An object or function marker keeps no members, so only its type was recorded.
  if (typeof fact === 'object' && fact !== null) {
    return fact.type === 'undefined'
      ? { path, mode: 'value', display: 'undefined', type: 'undefined' }
      : { path, mode: 'type', display: fact.type }
  }
  return {
    path,
    mode: 'value',
    // Strings are quoted, as the node histories display them, so a string is told from a number or a keyword.
    display: typeof fact === 'string' ? JSON.stringify(fact) : String(fact),
    type: fact === null ? 'null' : typeof fact,
  }
}

/**
 * Lists the values a browser stop recorded, for the native debugger's "Recorded inspections" scope of a learning replay.
 * Why: a browser snapshot keeps only bounded scopes, so a declared inspection outside them (a closure value) was cited by the chat yet unreadable in the replay.
 * Called by {@link StudyWorkspace} replay presentation (`presentPlayback`) for the shown stop.
 * @param observation - The saved observation shown at the playhead, or `undefined` for a gap.
 * @returns The rows in recorded order; the same array for the same observation `values` record (the debugger treats a different array as a new selection); `undefined` for a gap, a stop without a recorded debugger snapshot, or a stop with no recorded value.
 * @example
 * recordedInspectionsOfObservation({ values: { 'value:timeApi.reducerPath': 'timeApi' } }) // => [{ path: 'timeApi.reducerPath', mode: 'value', display: '"timeApi"', type: 'string' }]
 */
export function recordedInspectionsOfObservation(
  observation: Pick<ConfiguredObservation, 'values' | 'debugger'> | undefined,
): readonly ReplayRecordedInspection[] | undefined {
  // Without a recorded debugger snapshot the stop shows no native values, so its inspections have no scope to join.
  if (!observation?.debugger) return undefined
  const known = inspectionsByValues.get(observation.values)
  if (known) return known.length ? known : undefined
  const inspections = Object.entries(
    maskSavedFacts(observation.values),
  ).flatMap(([name, fact]) => inspectionOfFact(name, fact) ?? [])
  inspectionsByValues.set(observation.values, inspections)
  return inspections.length ? inspections : undefined
}
