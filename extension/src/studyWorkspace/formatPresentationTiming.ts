import type { PlaybackPresentationTiming } from '../playbackController'
import type { ReplayInspection } from '../replayDebugger'
import { elapsedMsSince } from '../utils/elapsedMsSince'

/** What {@link ReplayOpening.presentPlayback} records about its own steps for the playback timing journal (Cycle 0137, C1-E). */
export interface PresentationStepTiming {
  /** Each step's whole milliseconds, in the order the steps ended ({@link PresentationStopwatch.laps}). */
  steps: Readonly<Record<string, number>>
  /** The presentation's own total, from its first step to its last. */
  totalMs: number
  /** How the native debugger step ended; none when the moment has no debugger history to present. */
  inspection?: ReplayInspection
  /** The recorded debug adapter's times for this selection, on its wall clock ({@link ReplayDebugger.selectionTimes}). */
  debugger?: {
    selectedAt: number
    stoppedAt?: number
    inspectionReadyAt?: number
  }
}

/**
 * Formats one committed replay presentation as the line the playback timing journal writes to Output › Codebook (Cycle 0137, C1-E).
 * Why it exists: a boundary crossing or a seek took 0.47–0.83 s natively (Cycle 0135, C1), and only a per-step record of real presentations can say which step holds the playhead; the line holds durations and identities only, never a recorded value.
 * Called by {@link StudyWorkspace} for each committed presentation that changed the stop or answered a command.
 * @param timing - The controller's report: trigger, position, stop change and its durations.
 * @param steps - The presentation's own steps, or `undefined` when no presentation ran for this commit.
 * @returns `playback.presentation-timing ` followed by one JSON object; fields without a value are left out.
 * @example
 * ```ts
 * formatPresentationTiming(
 *   { trigger: 'tick', positionMs: 96390, stopChanged: true, totalMs: 541.6, frameMs: 8, presentMs: 530 },
 *   { steps: { retire: 4, source: 61, debugger: 310 }, totalMs: 529, inspection: 'inspected', debugger: { selectedAt: 1000, stoppedAt: 1030, inspectionReadyAt: 1290 } },
 * )
 * // => 'playback.presentation-timing {"trigger":"tick","positionMs":96390,"stopChanged":true,"totalMs":542,"frameMs":8,"presentMs":530,"steps":{"retire":4,"source":61,"debugger":310},"stepsTotalMs":529,"inspection":"inspected","debugger":{"selectToStoppedMs":30,"stoppedToValuesMs":260}}'
 * ```
 */
export function formatPresentationTiming(
  timing: PlaybackPresentationTiming,
  steps: PresentationStepTiming | undefined,
): string {
  const times = steps?.debugger
  return `playback.presentation-timing ${JSON.stringify({
    trigger: timing.trigger,
    positionMs: timing.positionMs,
    stopChanged: timing.stopChanged,
    totalMs: Math.round(timing.totalMs),
    frameMs: Math.round(timing.frameMs),
    presentMs: Math.round(timing.presentMs),
    steps: steps?.steps,
    stepsTotalMs: steps?.totalMs,
    inspection: steps?.inspection,
    // The adapter's own split: how soon Run and Debug was told about the stop, then how long it took to load the values.
    debugger: times && {
      selectToStoppedMs:
        times.stoppedAt === undefined
          ? undefined
          : elapsedMsSince(times.selectedAt, times.stoppedAt),
      stoppedToValuesMs:
        times.inspectionReadyAt === undefined
          ? undefined
          : elapsedMsSince(times.stoppedAt, times.inspectionReadyAt),
    },
  })}`
}
