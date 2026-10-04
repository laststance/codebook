import type { BoundPlace } from './describeBoundPlace'

/** Codebook's own place of a stop the debugger moved, as it is kept with each explanation of that stop: the file, the line the agent declared and the line and column the stop paused at. */
export type ExplanationPlace = Pick<
  BoundPlace,
  'path' | 'declaredLine' | 'boundLine' | 'boundColumn'
>

/**
 * Reduces a stop's places to the structured place that is saved with an explanation, so what a learner reads as the place of a moved stop never depends on the agent's prose; {@link StudyService.explain} saves it with the explanation and {@link readRecordingResource} gives it beside each saved interpretation.
 * @param boundPlace - The stop's places ({@link describeBoundPlace}); `undefined` when the snapshot has no declared stop.
 * @returns
 * - The path, the declared line and the bound line and column for a stop the debugger bound on another line
 * - `undefined` for a stop that paused on its declared line, which needs no second place
 * @example
 * explanationPlace(describeBoundPlace({ declared, bound: { line: 23, column: 5 } }))
 * // => { path: 'src/mode.ts', declaredLine: 22, boundLine: 23, boundColumn: 5 }
 * explanationPlace(describeBoundPlace({ declared, bound: { line: 22, column: 3 } })) // => undefined
 */
export function explanationPlace(
  boundPlace: BoundPlace | undefined,
): ExplanationPlace | undefined {
  if (!boundPlace?.isMoved) return undefined
  return {
    path: boundPlace.path,
    declaredLine: boundPlace.declaredLine,
    boundLine: boundPlace.boundLine,
    boundColumn: boundPlace.boundColumn,
  }
}
