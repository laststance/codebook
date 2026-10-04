import type {
  RecordingContext,
  RecordingFrame,
  RecordingIndex,
} from '../recordingSchemas'

/**
 * When an explanation that the replay shows before its own saved time was saved, measured against the selected stop's recorded pause.
 * {@link projectRecording} sets it and the Study pane turns it into a sentence with {@link savedLaterNote}.
 */
export type ExplanationSavedLater =
  'while-pause-held' | 'after-run-continued' | 'after-recording-ended'

/** One saved explanation as the replay shows it at the selected time; `savedLater` is present only when it is shown before the time it was saved. */
export type ShownInterpretation =
  RecordingContext['study']['observations'][number]['interpretations'][number] & {
    savedLater?: ExplanationSavedLater
  }

/**
 * Selects what the replay shows at one recorded time, for {@link PlaybackController}, the Study workspace and the article links of {@link RepositoryBookStore}.
 *
 * Recorded facts (frame, source, debugger state, phases, confirmations) appear only from their own time. An explanation appears from the time it was saved, with one exception: while the playhead stands in a stop's own recorded pause (its commit time, or inside its sealed paused interval), that stop shows every explanation saved before the pause ended and its first saved explanation (the first of its saved list, which is kept in the order of saving) whenever that was saved. Such an explanation carries `savedLater`. Every other explanation later than the playhead stays in `laterInterpretations`.
 *
 * @param index - The verified recording journal.
 * @param context - The saved study with its receipt times; `undefined` projects the film alone.
 * @param positionMs - The selected recorded time, in milliseconds of the recording's clock.
 * @returns
 * - `observation`: the stop selected at that time with the explanations shown there, or `undefined` when no stop is selected
 * - `laterInterpretations`: the last committed stop's explanations that are later than the playhead and not shown, each with `availableMs` (`null` when it was saved after the recording ended)
 * - `frame`, `missing`, `debugger`, `pauseConfirmed`, `rendererConfirmed`, `contextStatus`: the recorded facts at that time
 * @throws When the position is outside the verified range, or the context belongs to another recording.
 * @example
 * // A stop committed at 500 ms and held until 900 ms, explained at 700 ms:
 * projectRecording(index, context, 500).observation?.interpretations[0]?.savedLater // => 'while-pause-held'
 * projectRecording(index, context, 700).observation?.interpretations[0]?.savedLater // => undefined
 */
export function projectRecording(
  index: RecordingIndex,
  context: RecordingContext | undefined,
  positionMs: number,
) {
  const recordingEndMs = index.endMs ?? index.lastVerifiedMs
  if (
    !Number.isFinite(positionMs) ||
    positionMs < index.header.startedMs ||
    positionMs > recordingEndMs
  )
    throw new Error(
      'Playback position is outside the verified recording range.',
    )
  if (
    context &&
    (context.version !== index.header.version ||
      context.studyId !== index.header.studyId ||
      context.workspaceKey !== index.header.workspaceKey ||
      context.study.profile !== index.header.profile)
  )
    throw new Error('Playback context belongs to another recording.')
  let frame: RecordingFrame | undefined, missing: string | undefined
  for (const entry of index.entries) {
    if (entry.elapsedMs > positionMs) break
    if (entry.type === 'frame') {
      frame = entry
      missing = undefined
    }
    if (entry.type === 'gap') {
      missing = entry.reason
      frame = undefined
    }
  }
  const observed = context?.study.observations
    .filter((value) => value.elapsedMs <= positionMs)
    .sort((left, right) => left.elapsedMs - right.elapsedMs)
    .at(-1)
  const interval = context?.pausedIntervals?.find(
    (value) =>
      value.snapshotId === observed?.id && value.startMs === observed.elapsedMs,
  )
  const hasHistoricalState = Boolean(
    observed &&
    (positionMs === observed.elapsedMs ||
      (interval &&
        positionMs >= interval.startMs &&
        positionMs < interval.endMs)),
  )
  const currentObservation =
    observed?.debugger && !hasHistoricalState ? undefined : observed
  const available = (id: string) =>
    context?.interpretationAvailability.find((value) => value.id === id)
      ?.elapsedMs
  // An explanation without a receipt in the journal was saved after the recording ended.
  const savedMs = (value: { id: string }) =>
    available(value.id) ?? Number.POSITIVE_INFINITY
  // In a stop's own recorded pause that stop shows what was saved until the pause ended; everywhere else only what was saved by the playhead.
  const shownUntilMs =
    hasHistoricalState && interval ? interval.endMs : positionMs
  const isShown = (value: { id: string }, order: number) =>
    savedMs(value) <= shownUntilMs || (hasHistoricalState && order === 0)
  const savedLater = (savedAtMs: number): ExplanationSavedLater | undefined => {
    if (savedAtMs > recordingEndMs) return 'after-recording-ended'
    // Without a sealed interval the recording does not say whether the pause was still held at that time.
    if (!interval) return undefined
    return savedAtMs <= interval.endMs
      ? 'while-pause-held'
      : 'after-run-continued'
  }
  // Keep interpretation availability bound to the selected recorded source.
  const observation = currentObservation && {
    ...currentObservation,
    interpretations: currentObservation.interpretations
      .filter(isShown)
      .map((value): ShownInterpretation => {
        // An explanation shown ahead of the time it was saved at says when that was.
        const saved =
          savedMs(value) > positionMs ? savedLater(savedMs(value)) : undefined
        return saved ? { ...value, savedLater: saved } : value
      }),
  }
  const shownIds = new Set(
    observation?.interpretations.map((value) => value.id),
  )
  const laterInterpretations =
    observed?.interpretations
      .filter((value) => savedMs(value) > positionMs && !shownIds.has(value.id))
      .map((value) => ({
        ...value,
        availableMs: available(value.id) ?? null,
      })) ?? []
  const phase =
    frame?.kind === 'phase'
      ? context?.phases.findLast(
          (phase) =>
            phase.phase === frame.phase &&
            phase.hash === frame.hash &&
            (phase.pixelsMs === undefined || phase.pixelsMs <= positionMs) &&
            (!observation ||
              !phase.snapshotId ||
              phase.snapshotId === observation.id),
        )
      : undefined
  // No sealed pause interval means only the exact receipt point establishes debugger correspondence.
  const debuggerSnapshot = hasHistoricalState ? observed?.debugger : undefined
  return {
    positionMs,
    frame,
    missing:
      missing ??
      (!frame
        ? 'No application frame was received at this position.'
        : undefined),
    observation,
    debugger: debuggerSnapshot,
    laterInterpretations,
    pauseConfirmed: Boolean(
      phase?.pauseVerifiedMs !== undefined &&
      phase.pauseVerifiedMs <= positionMs &&
      phase.snapshotId === observation?.id,
    ),
    rendererConfirmed: Boolean(
      phase?.rendererConfirmedMs !== undefined &&
      phase.rendererConfirmedMs <= positionMs &&
      (!phase.snapshotId ||
        context?.study.observations.some(
          (value) =>
            value.id === phase.snapshotId && value.elapsedMs <= positionMs,
        )),
    ),
    contextStatus: context ? ('available' as const) : ('unavailable' as const),
  }
}
