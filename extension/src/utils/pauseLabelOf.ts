import type { ConfiguredRuntimeSnapshot } from '../runtime'

/** The fields that say what a pause is (API 1.16), as the snapshot carries them. */
type PauseLabel = Pick<
  ConfiguredRuntimeSnapshot,
  | 'execution'
  | 'attribution'
  | 'operationIndex'
  | 'declaredIndex'
  | 'executionIndex'
>

/**
 * Picks the pause-label fields a snapshot carries, so the run resource's observations and the inspection resource report them like the snapshot resource does.
 * Absent fields stay absent (no `undefined` keys), so a format 7 or browser-only run, and versions 1 and 2, serialize exactly as before.
 * @param snapshot - A runtime snapshot of the run.
 * @returns An object holding only the label fields present on the snapshot.
 * @example
 * pauseLabelOf({ execution: 'server-render', attribution: 'entry-load', declaredIndex: 0, executionIndex: 0 }) // => same four fields
 * pauseLabelOf({}) // => {}
 */
export function pauseLabelOf(snapshot: PauseLabel): PauseLabel {
  const label: PauseLabel = {}
  // Copy key by key: a plain read would add `undefined` keys, a spread of the snapshot would leak every other field.
  if (snapshot.execution !== undefined) label.execution = snapshot.execution
  if (snapshot.attribution !== undefined)
    label.attribution = snapshot.attribution
  if (snapshot.operationIndex !== undefined)
    label.operationIndex = snapshot.operationIndex
  if (snapshot.declaredIndex !== undefined)
    label.declaredIndex = snapshot.declaredIndex
  if (snapshot.executionIndex !== undefined)
    label.executionIndex = snapshot.executionIndex
  return label
}
