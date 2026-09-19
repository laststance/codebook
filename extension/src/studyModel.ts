import { z } from 'zod';
import { STUDY_PROFILES } from 'codebook-cycle-0004/dist/profiles';
import type { StudyItemId } from 'codebook-cycle-0004/dist/constants';
import type { StudyService } from './service';
import { participantSchema, sourceSchema } from './legacyStudySchemas';
import { studyArchiveSchema, selectionSchema } from './studySchemas';
import type { LearnerProgress, SavedLearnerDecision } from './learnerSchemas';
export { participantSchema, studyIdSchema, sourceSchema } from './legacyStudySchemas';
export { capturedImageSchema, observationSchema, studyArchiveSchema, selectionSchema } from './studySchemas';

export type StudyArchive = z.infer<typeof studyArchiveSchema>;
export type StudySelection = z.infer<typeof selectionSchema>;
export type { LearnerProgress, LearnerDecision } from './learnerSchemas';
export { progressV4Schema as progressSchema, learnerDecisionV3Schema as learnerDecisionSchema } from './learnerSchemas';
export type StudyParticipant = z.infer<typeof participantSchema>;
export type SourceBaseline = z.infer<typeof sourceSchema> & { path: string };
export type SourceBaselines = Record<StudyParticipant, SourceBaseline>;
export type LiveStudy = ReturnType<StudyService['state']>;

export const LEARNING_ITEMS = Object.values(STUDY_PROFILES).flatMap(profile => profile.items);

/** Separates current-source understanding from retained historical decisions for {@link projectStudy}. @example learningState(progress, 'paired-cart-demo/server', hash).reviewNeeded */
export function learningState(progress: LearnerProgress | undefined, item: StudyItemId, currentHash: string | undefined) {
  const latest = new Map<string, SavedLearnerDecision>();
  // A later uncheck supersedes only that source revision, never another historical decision.
  for (const decision of progress?.decisions ?? []) if (decision.item === item && decision.context.kind === 'source') latest.set(decision.sourceHash, decision);
  const current = currentHash ? latest.get(currentHash) : undefined;
  return { known: Boolean(progress) && Boolean(currentHash), understood: current?.understood === true, at: current?.at,
    reviewNeeded: current?.understood !== true && [...latest.values()].some(decision => decision.sourceHash !== currentHash && decision.understood), history: [...latest.values()] };
}

/** Joins one selected observation without letting live control or old progress redefine its identity. @example projectStudy({selection, study, live, progress, baselines}).continueArguments */
export function projectStudy(input: { selection: StudySelection; study?: StudyArchive; live?: Pick<LiveStudy, 'instanceId' | 'runId' | 'participants'>; progress?: LearnerProgress; baselines: SourceBaselines; currentSourceAvailable?: boolean }) {
  const { selection, study, live, progress, baselines, currentSourceAvailable = true } = input;
  const profile = STUDY_PROFILES[selection.profile], selectedItem = profile.items.find(item => item.id === selection.itemId);
  if (!selectedItem) throw new Error('Selected item belongs to another profile.');
  const observation = study && study.id === selection.studyId && study.profile === selection.profile ? study.observations.find(value => value.itemId === selection.itemId) : undefined;
  const currentParticipant = Object.values(participantSchema.enum).find(participant => live?.participants[participant].resumable);
  const current = currentParticipant && live?.participants[currentParticipant];
  const currentItemId = current?.itemId, currentItem = LEARNING_ITEMS.find(item => item.id === currentItemId);
  const matching = Boolean(observation && live && study?.runId === live.runId && study.instanceId === live.instanceId && current && observation.snapshotUri === current.snapshotUri && observation.itemId === currentItemId);
  const baseline = baselines[selectedItem.participant];
  const source = observation?.source ?? { ...baseline, line: Math.max(1, baseline.text.split('\n').findIndex(line => line.includes(selectedItem.marker)) + 1) };
  const progressByItem = profile.items.map(item => ({ ...item, ...learningState(progress, item.id, currentSourceAvailable ? baselines[item.participant].hash : undefined) }));
  const lastObservedItem = profile.items.filter(item => study?.observations.some(observation => observation.itemId === item.id)).at(-1);
  const confirmation = study?.observations.find(observation => observation.itemId === 'checkout-demo/purchase-confirmation');
  const scenarioProgress = study && {
    lastObservedTitle: lastObservedItem?.title,
    // The pre-DOM confirmation pause alone does not prove the application displayed a purchase.
    purchaseObserved: confirmation?.actionId === 'checkout' && confirmation.values.orderCount === 1 && study.links.some(link => link.id === 'checkout-browser-screen' && link.status === 'observed'),
    missingImageTitles: profile.capturePhases.filter(phase => !study.captures.some(capture => capture.phase === phase && capture.status === 'captured'))
      .map(phase => profile.items.find(item => item.capturePhase === phase)?.title ?? (phase === 'before' ? 'Before action' : `${profile.actions.find(action => action.afterCapture === phase)!.title} result`)),
    unverifiedLinkCount: profile.requiredLinks.filter(id => !study.links.some(link => link.id === id && link.status === 'observed')).length,
  };
  return { selection, selectedItem, observation, source, currentSourceAvailable, currentParticipant, currentItemId, currentItemTitle: currentItem?.title, currentSnapshotUri: current ? current.snapshotUri : undefined, matching,
    scenarioProgress,
    continueArguments: matching && current ? current.continueArguments : undefined,
    image: observation ? study?.captures.find(capture => capture.phase === observation.capturePhase) : undefined,
    sourceChanged: currentSourceAvailable && source.hash !== baseline.hash,
    selectedUnderstanding: learningState(progress, selection.itemId, observation || currentSourceAvailable ? source.hash : undefined), progressByItem,
    understoodCount: progressByItem.filter(item => item.understood).length, reviewCount: progressByItem.filter(item => item.reviewNeeded).length };
}
