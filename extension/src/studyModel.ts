import { z } from 'zod';
import type { StudyService } from './service';
import { participantSchema, sourceSchema, studyArchiveSchema, selectionSchema, progressSchema, learnerDecisionSchema } from './legacyStudySchemas';
export { participantSchema, studyIdSchema, sourceSchema, capturedImageSchema, observationSchema, studyArchiveSchema, selectionSchema, progressSchema, learnerDecisionSchema } from './legacyStudySchemas';

export type StudyArchive = z.infer<typeof studyArchiveSchema>;
export type StudySelection = z.infer<typeof selectionSchema>;
export type LearnerProgress = z.infer<typeof progressSchema>;
export type LearnerDecision = z.infer<typeof learnerDecisionSchema>;
export type StudyParticipant = z.infer<typeof participantSchema>;
export type SourceBaseline = z.infer<typeof sourceSchema> & { path: string };
export type SourceBaselines = Record<StudyParticipant, SourceBaseline>;
export type LiveStudy = ReturnType<StudyService['state']>;

export const LEARNING_ITEMS = [
  { participant: participantSchema.enum.server, id: 'paired-cart-demo/server', title: 'Server cart mutation', file: 'server.mts', overview: 'The server admits the selected cart request and adds the product to its cart state. The stop is immediately before that mutation. These statements describe source structure; a captured observation supplies actual runtime values.' },
  { participant: participantSchema.enum.browser, id: 'paired-cart-demo/browser', title: 'Browser display update', file: 'client.mts', overview: 'The browser awaits the selected cart response and updates the displayed count. The stop is immediately before the DOM update. Request correspondence is observed only when the runtime has closed and checked the complete request set.' },
];

/** Separates current-source understanding from retained historical decisions for {@link projectStudy}. @example learningState(progress, 'server', hash).reviewNeeded */
export function learningState(progress: LearnerProgress | undefined, item: StudyParticipant, currentHash: string | undefined) {
  const latest = new Map<string, LearnerDecision>();
  // A later uncheck supersedes only that source revision, never another historical decision.
  for (const decision of progress?.decisions ?? []) if (decision.item === item) latest.set(decision.sourceHash, decision);
  const current = currentHash ? latest.get(currentHash) : undefined;
  return { known: Boolean(progress) && Boolean(currentHash), understood: current?.understood === true, at: current?.at,
    reviewNeeded: current?.understood !== true && [...latest.values()].some(decision => decision.sourceHash !== currentHash && decision.understood), history: [...latest.values()] };
}

/** Joins one selected observation without letting live control or old progress redefine its identity. @example projectStudy({selection, study, live, progress, baselines}).continueArguments */
export function projectStudy(input: { selection: StudySelection; study?: StudyArchive; live?: Pick<LiveStudy, 'instanceId' | 'runId' | 'participants'>; progress?: LearnerProgress; baselines: SourceBaselines; currentSourceAvailable?: boolean }) {
  const { selection, study, live, progress, baselines, currentSourceAvailable = true } = input;
  const observation = study && study.id === selection.studyId ? study.observations.find(value => value.participant === selection.participant) : undefined;
  const currentParticipant = LEARNING_ITEMS.find(item => live?.participants[item.participant].resumable)?.participant;
  const current = currentParticipant && live?.participants[currentParticipant];
  const matching = Boolean(observation && live && study?.runId === live.runId && study.instanceId === live.instanceId && current && observation.snapshotUri === current.snapshotUri && observation.participant === currentParticipant);
  const source = observation?.source ?? baselines[selection.participant];
  const progressByItem = LEARNING_ITEMS.map(item => ({ ...item, ...learningState(progress, item.participant, currentSourceAvailable ? baselines[item.participant].hash : undefined) }));
  return { selection, observation, source, currentSourceAvailable, currentParticipant, currentSnapshotUri: current ? current.snapshotUri : undefined, matching,
    continueArguments: matching && current ? current.continueArguments : undefined,
    image: observation ? study?.captures.find(capture => capture.phase === `paused-${observation.participant}`) : undefined,
    sourceChanged: currentSourceAvailable && source.hash !== baselines[selection.participant].hash,
    selectedUnderstanding: learningState(progress, selection.participant, observation || currentSourceAvailable ? source.hash : undefined), progressByItem,
    understoodCount: progressByItem.filter(item => item.understood).length, reviewCount: progressByItem.filter(item => item.reviewNeeded).length };
}
