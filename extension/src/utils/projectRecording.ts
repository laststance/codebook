import type { RecordingContext, RecordingFrame, RecordingIndex } from '../recordingSchemas';

/** Selects only evidence available at the requested receipt time, preserving missing ranges and separately opted-in later annotations. @example projectRecording(index, context, 500).observation?.values */
export function projectRecording(index: RecordingIndex, context: RecordingContext | undefined, positionMs: number) {
  if (!Number.isFinite(positionMs) || positionMs < index.header.startedMs || positionMs > (index.endMs ?? index.lastVerifiedMs)) throw new Error('Playback position is outside the verified recording range.');
  if (context && (context.version !== index.header.version || context.studyId !== index.header.studyId || context.workspaceKey !== index.header.workspaceKey || context.study.profile !== index.header.profile)) throw new Error('Playback context belongs to another recording.');
  let frame: RecordingFrame | undefined, missing: string | undefined;
  for (const entry of index.entries) {
    if (entry.elapsedMs > positionMs) break;
    if (entry.type === 'frame') frame = entry;
    if (entry.type === 'gap') { missing = entry.reason; frame = undefined; }
  }
  const observed = context?.study.observations.filter(value => value.elapsedMs <= positionMs).sort((left, right) => left.elapsedMs - right.elapsedMs).at(-1);
  const available = (id: string) => context?.interpretationAvailability.find(value => value.id === id)?.elapsedMs;
  const atPosition = (value: { id: string }) => { const elapsed = available(value.id); return elapsed !== undefined && elapsed !== null && elapsed <= positionMs; };
  // Narrow before filtering so demo interpretations cannot acquire configured-only fact types.
  const observation = observed?.actionId === 'repository-click' ? { ...observed, interpretations: observed.interpretations.filter(atPosition) }
    : observed && { ...observed, interpretations: observed.interpretations.filter(atPosition) };
  const laterInterpretations = observed?.interpretations.filter(value => { const elapsed = available(value.id); return elapsed === null || elapsed === undefined || elapsed > positionMs; }).map(value => ({ ...value, availableMs: available(value.id) ?? null })) ?? [];
  const phase = frame?.kind === 'phase' ? context?.phases.find(phase => phase.phase === frame.phase && phase.hash === frame.hash) : undefined;
  return { positionMs, frame, missing: missing ?? (!frame ? 'No application frame was received at this position.' : undefined), observation, laterInterpretations,
    pauseConfirmed: Boolean(phase?.pauseVerifiedMs !== undefined && phase.pauseVerifiedMs <= positionMs && phase.snapshotId === observation?.id),
    rendererConfirmed: Boolean(phase?.rendererConfirmedMs !== undefined && phase.rendererConfirmedMs <= positionMs && (!phase.snapshotId || context?.study.observations.some(value => value.id === phase.snapshotId && value.elapsedMs <= positionMs))),
    contextStatus: context ? 'available' as const : 'unavailable' as const };
}
