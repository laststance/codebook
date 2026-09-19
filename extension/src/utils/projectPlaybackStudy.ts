import { sha256 } from 'codebook-cycle-0001/dist/utils/sha256';
import { learningState, projectStudy } from '../studyModel';
import type { PlaybackBundle } from '../playbackController';

/** Projects the existing learner model at confirmed playback time; no future source, causal claim or live continuation is borrowed. @example projectPlaybackStudy(input, bundle).continueArguments // undefined */
export function projectPlaybackStudy(input: Parameters<typeof projectStudy>[0], bundle?: PlaybackBundle): ReturnType<typeof projectStudy> {
  const observation = bundle?.projection.observation, context = bundle?.context?.study;
  const study = context && { ...context, observations: observation ? [observation] : [], captures: [], links: [] };
  const model = projectStudy({ ...input, study, selection: { ...input.selection, follow: false, tab: 'live' } });
  const text = '// No source was observed by this recorded position.\n';
  return { ...model, matching: false, continueArguments: undefined, image: undefined, scenarioProgress: undefined,
    source: observation?.source ?? { text, hash: sha256(text), line: 1 },
    sourceChanged: Boolean(observation && input.currentSourceAvailable !== false && observation.source.hash !== input.baselines[observation.participant].hash),
    selectedUnderstanding: learningState(input.progress, input.selection.itemId, observation?.source.hash) };
}
