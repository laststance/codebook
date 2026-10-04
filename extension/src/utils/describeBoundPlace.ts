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
  const { declared, bound, armed, acknowledged, pausable } = input,
    source = declared.stop.source,
    isMoved = bound.line !== source.line
  return {
    path: source.path,
    configurationPath: declared.configurationPath,
    declaredLine: source.line,
    declaredColumn: source.column,
    boundLine: bound.line,
    boundColumn: bound.column,
    ...(armed && { armed }),
    ...(acknowledged && { acknowledged }),
    ...(pausable && { pausable }),
    isMoved,
    // Only another line needs the sentence: a moved column stays on the line the agent declared.
    ...(isMoved && {
      place: [
        `${source.path}: this stop paused on line ${bound.line}, column ${bound.column}.`,
        `You declared line ${source.line} (${declared.configurationPath}); the debugger bound the breakpoint on line ${bound.line}.`,
        `Name line ${bound.line} as the place of this pause in the interpretation, in the learning summary and in your answer to the learner.`,
        // A stop requested after its unmapped declared line is told which line to declare as well, because Codebook chose that line.
        ...(pausable
          ? [
              `Line ${pausable.line} can pause at column ${pausable.column}; declare ${pausable.line === source.line ? 'that column' : `line ${pausable.line} at that column`} to stop there.`,
            ]
          : []),
      ].join(' '),
    }),
  }
}
