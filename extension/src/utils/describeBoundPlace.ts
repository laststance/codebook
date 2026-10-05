import type { DeclaredStopOfSnapshot } from './declaredStopOfSnapshot'

/** When the run first knew where the debugger bound a stop: the adapter acknowledged the binding while the stop was armed, or it was first seen at the stop's pause. */
export type BindingAcknowledgement = 'before-pause' | 'at-pause'

/** The three places of one committed stop (declared, requested when it differs, bound), with the sentence an agent reads for a moved stop. */
export interface BoundPlace {
  /** Repository path of the stop's source file. */
  path: string
  /** Where the configuration holds the stop's line and column ({@link DeclaredStopOfSnapshot.configurationPath}). */
  configurationPath: string
  declaredLine: number
  declaredColumn: number
  /** The line and column the debugger bound the breakpoint on and paused at. */
  boundLine: number
  boundColumn: number
  /** Where Codebook requested the breakpoint, present only when that differs from the declared place. A saved study keeps the line only. */
  armed?: { line: number; column?: number }
  /** Present for a live run whose journal tells it; a saved study does not keep it. */
  acknowledged?: BindingAcknowledgement
  /** The line the breakpoint was requested on and a column the debugger can pause at there, present only for a live stop whose binding was first known at its pause and lies past that line. */
  pausable?: { line: number; column: number }
  /** Whether the debugger bound the stop on another line than the declared one. */
  isMoved: boolean
  /** The sentence that names the paused line and asks for it; present only for a moved stop. */
  place?: string
}

/**
 * Keeps the places and the acknowledgement a caller knows and leaves the others out, so that an unknown one is an absent key instead of an `undefined` value; called by {@link describeBoundPlace}.
 * @param known.armed - Where the breakpoint was requested, only when that differs from the declared place.
 * @param known.acknowledged - When the binding became known, where the caller can tell.
 * @param known.pausable - Where the requested line can pause, when the binding first known at the pause lies past it.
 * @returns The given values under their own keys, in the order `armed`, `acknowledged`, `pausable`; an empty object when none is known.
 * @example
 * knownPlaces({ armed: { line: 23 }, acknowledged: undefined, pausable: undefined }) // => { armed: { line: 23 } }
 */
function knownPlaces(
  known: Pick<BoundPlace, 'armed' | 'acknowledged' | 'pausable'>,
): Pick<BoundPlace, 'armed' | 'acknowledged' | 'pausable'> {
  const { armed, acknowledged, pausable } = known
  return {
    ...(armed && { armed }),
    ...(acknowledged && { acknowledged }),
    ...(pausable && { pausable }),
  }
}

/**
 * Words the sentence that tells an agent which line a moved stop paused on and which line to name; called by {@link describeBoundPlace} only for a stop the debugger bound on another line than the declared one.
 * @param declared - The snapshot's declared stop.
 * @param bound - The position the snapshot was committed at.
 * @param pausable - Where the requested line can pause; the sentence then ends with which column (and, for another line than the declared one, which line) to declare to stop there.
 * @param armed - Where Codebook requested the breakpoint, when the caller knows it; a line other than the declared one is named as Codebook's request, so the sentence does not say the debugger moved the stop.
 * @returns The sentence: the paused place, the declared line with its configuration path, the line Codebook requested when it is not the declared one, the line to name, and the pausable column when there is one.
 * @example
 * describeMovedStop(declared, { line: 23, column: 5 }, undefined, undefined)
 * // => 'src/mode.ts: this stop paused on line 23, column 5. You declared line 22 (configuration.additionalStops[1].source); the debugger bound the breakpoint on line 23. Name line 23 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.'
 * describeMovedStop(declared, { line: 23, column: 5 }, undefined, { line: 23 })
 * // => 'src/mode.ts: this stop paused on line 23, column 5. You declared line 22 (configuration.additionalStops[1].source); Codebook requested the breakpoint on line 23 and the debugger bound it on line 23. Name line 23 …'
 */
function describeMovedStop(
  declared: DeclaredStopOfSnapshot,
  bound: { line: number; column: number },
  pausable: BoundPlace['pausable'],
  armed: BoundPlace['armed'],
): string {
  const source = declared.stop.source
  return [
    `${source.path}: this stop paused on line ${bound.line}, column ${bound.column}.`,
    // A line Codebook chose (after a line without a mapped position or a line that declares a required binding) is said to be Codebook's request, not the debugger's move.
    armed && armed.line !== source.line
      ? `You declared line ${source.line} (${declared.configurationPath}); Codebook requested the breakpoint on line ${armed.line} and the debugger bound it on line ${bound.line}.`
      : `You declared line ${source.line} (${declared.configurationPath}); the debugger bound the breakpoint on line ${bound.line}.`,
    `Name line ${bound.line} as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.`,
    // A stop requested after its unmapped declared line is told which line to declare as well, because Codebook chose that line.
    ...(pausable
      ? [
          `Line ${pausable.line} can pause at column ${pausable.column}; declare ${pausable.line === source.line ? 'that column' : `line ${pausable.line} at that column`} to stop there.`,
        ]
      : []),
  ].join(' ')
}

/**
 * Puts a committed stop's declared, requested and bound places into one value, and words the sentence that tells an agent which line a moved stop paused on; called for a live snapshot by {@link StudyService.boundPlace} (inspection resource, run resource, `codebook_explain`), for a saved observation by {@link readRecordingResource}, and by the Study pane's label of a moved stop.
 * The numbers come from the run (the declared stop and the committed snapshot), never from an agent's text.
 * @param input.declared - The snapshot's declared stop ({@link declaredStopOfSnapshot}).
 * @param input.bound - The position the snapshot was committed at.
 * @param input.armed - Where the breakpoint was requested, only when that differs from the declared place.
 * @param input.acknowledged - When the binding became known, where the caller can tell.
 * @param input.pausable - Where the requested line can pause, when the binding first known at the pause lies past it ({@link journaledBindingOfSnapshot}); the sentence then says which column to declare to stop on that line.
 * @returns The places; `place` holds the sentence only when the bound line differs from the declared line, so a stop that paused on its declared line (also at another column) carries none.
 * @example
 * describeBoundPlace({ declared, bound: { line: 23, column: 5 } }).place
 * // => 'src/mode.ts: this stop paused on line 23, column 5. You declared line 22 (configuration.additionalStops[1].source); the debugger bound the breakpoint on line 23. Name line 23 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.'
 * describeBoundPlace({ declared, bound: { line: 22, column: 12 } }).place // => undefined
 * describeBoundPlace({ declared, bound: { line: 23, column: 5 }, pausable: { line: 22, column: 3 } }).place
 * // => '… Name line 23 as the place of this pause in the interpretation, in the learning summary and in your answer to the learner. Line 22 can pause at column 3; declare that column to stop there.'
 */
export function describeBoundPlace(input: {
  declared: DeclaredStopOfSnapshot
  bound: { line: number; column: number }
  armed?: { line: number; column?: number }
  acknowledged?: BindingAcknowledgement
  pausable?: { line: number; column: number }
}): BoundPlace {
  const { declared, bound, pausable, armed } = input,
    source = declared.stop.source,
    isMoved = bound.line !== source.line
  return {
    path: source.path,
    configurationPath: declared.configurationPath,
    declaredLine: source.line,
    declaredColumn: source.column,
    boundLine: bound.line,
    boundColumn: bound.column,
    ...knownPlaces(input),
    isMoved,
    // Only another line needs the sentence: a moved column stays on the line the agent declared.
    ...(isMoved && {
      place: describeMovedStop(declared, bound, pausable, armed),
    }),
  }
}
