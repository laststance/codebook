import { REPOSITORY_BROWSER_ACTION } from '../constants'
import type { PlaybackBundle } from '../playbackController'
import { sha256 } from '../runtimeSupport/utils/sha256'
import { learningState, projectStudy } from '../studyModel'

import { movedStopDeclaredLine } from './movedStopDeclaredLine'

/** Projects the existing learner model at confirmed playback time; no future source, causal claim or live continuation is borrowed. @example projectPlaybackStudy(input, bundle).continueArguments // undefined */
export function projectPlaybackStudy(
  input: Parameters<typeof projectStudy>[0],
  bundle?: PlaybackBundle,
): ReturnType<typeof projectStudy> {
  const observation = bundle?.projection.observation,
    context = bundle?.context?.study ?? input.study
  // Project only the matching version and receipt-time observation; later context never leaks future facts.
  const study = context
    ? {
        ...context,
        observations:
          observation?.actionId === REPOSITORY_BROWSER_ACTION
            ? [observation]
            : [],
        captures: [],
        links: [],
      }
    : undefined
  const model = projectStudy({
    ...input,
    // Playback's shared moment replaces any earlier exact Wiki history visit.
    observationId: undefined,
    study,
    selection: { ...input.selection, follow: false, tab: 'live' },
  })
  const text = context?.observations.some((value) => value.debugger)
    ? '// Not recorded at this moment.\n'
    : '// No source was observed by this recorded position.\n'
  return {
    ...model,
    matching: false,
    continueArguments: undefined,
    image: undefined,
    scenarioProgress: undefined,
    source: observation?.source ?? { text, hash: sha256(text), line: 1 },
    // The projected study holds only the shown observation; a stop is found by its position among all of the saved ones.
    sourceDeclaredLine: movedStopDeclaredLine(context, observation),
    sourceChanged:
      input.selection.profile === 'repository-browser'
        ? model.sourceChanged
        : Boolean(
            observation &&
            input.currentSourceAvailable !== false &&
            observation.source.hash !==
              input.baselines[observation.participant].hash,
          ),
    selectedUnderstanding:
      input.selection.profile === 'repository-browser'
        ? {
            ...model.selectedUnderstanding,
            known: Boolean(observation) && model.selectedUnderstanding.known,
          }
        : learningState(
            input.progress,
            input.selection.itemId,
            observation?.source.hash,
          ),
  }
}
