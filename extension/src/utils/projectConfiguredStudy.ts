import { sha256 } from '../runtimeSupport/utils/sha256'
import type { StudyProjection, StudyProjectionInput } from '../studyModel'

import { citationLearningState } from './citationLearningState'
import { describeStudy } from './describeStudy'

/** Projects one sealed browser item and its complete citation ledger for {@link projectStudy}, never granting control to another run. @example projectConfiguredStudy(input).progressByItem.length // 1 */
export function projectConfiguredStudy(
  input: StudyProjectionInput,
): StudyProjection {
  const { selection, progress, live } = input
  if (selection.profile !== 'repository-browser')
    throw new Error('Configured selection is required.')
  const study =
    input.study && input.study.id === selection.studyId
      ? input.study
      : undefined
  const descriptor = describeStudy(study ?? selection),
    declaredItem = descriptor.items[0]!
  if (selection.itemId !== declaredItem.id)
    throw new Error('Selected item belongs to another configured article.')
  const observation = study?.observations.findLast(
    (value) => value.itemId === selection.itemId,
  )
  const selectedItem = {
    ...declaredItem,
    participant: observation?.participant ?? declaredItem.participant,
    capturePhase: observation?.capturePhase ?? declaredItem.capturePhase,
  }
  const captured = study?.descriptor?.sources.find(
    (source) => source.path === study.configuration.source.path,
  )
  const placeholder =
    '// Configured source is unavailable. Open the article or retry preparation.\n'
  const source =
    observation?.source ??
    (captured
      ? { ...captured, line: study!.configuration.source.line }
      : { text: placeholder, hash: sha256(placeholder), line: 1 })
  const anchors = study?.descriptor?.anchors,
    states = input.citationSources
  const currentSourceAvailable = Boolean(
    anchors &&
    states &&
    anchors.every((anchor) =>
      states.some(
        (state) =>
          state.path === anchor.path &&
          state.hash === anchor.hash &&
          state.status !== 'unavailable' &&
          state.currentHash,
      ),
    ),
  )
  const sourceChanged = Boolean(
    anchors &&
    states?.some(
      (state) =>
        anchors.some(
          (anchor) => anchor.path === state.path && anchor.hash === state.hash,
        ) && state.status === 'changed',
    ),
  )
  const selectedUnderstanding = {
    ...citationLearningState(progress, selection.itemId, anchors ?? []),
    known: Boolean(progress && anchors),
  }
  // Progress refers to all current citations; the historical checkbox retains its own immutable context.
  const currentAnchors =
    anchors?.map((anchor) => ({
      ...anchor,
      hash:
        states?.find(
          (state) => state.path === anchor.path && state.hash === anchor.hash,
        )?.currentHash ?? anchor.hash,
    })) ?? []
  const currentUnderstanding = citationLearningState(
    progress,
    selection.itemId,
    currentAnchors,
  )
  const itemProgress = {
    ...selectedItem,
    ...currentUnderstanding,
    known: Boolean(progress) && currentSourceAvailable,
    understood: currentSourceAvailable && currentUnderstanding.understood,
    reviewNeeded:
      currentUnderstanding.reviewNeeded ||
      (sourceChanged && selectedUnderstanding.understood),
  }
  const currentParticipant = live?.participants.browser?.resumable
    ? 'browser'
    : live?.participants.server?.resumable
      ? 'server'
      : undefined
  const current = currentParticipant && live?.participants[currentParticipant]
  const currentItem = input.liveDescriptor?.items.find(
    (item) => item.id === current?.itemId,
  )
  const matching = Boolean(
    observation &&
    current &&
    study?.instanceId === live?.instanceId &&
    study?.runId === live?.runId &&
    observation.snapshotUri === current.snapshotUri &&
    observation.itemId === current.itemId,
  )
  return {
    selection,
    selectedItem,
    observation,
    source,
    currentSourceAvailable,
    sourceChanged,
    selectedUnderstanding,
    progressByItem: [itemProgress],
    understoodCount: itemProgress.understood ? 1 : 0,
    reviewCount: itemProgress.reviewNeeded ? 1 : 0,
    currentParticipant,
    currentItemId: current?.itemId,
    currentItemTitle:
      currentItem?.title ??
      (current?.itemId === selectedItem.id ? selectedItem.title : undefined),
    currentSnapshotUri: current ? current.snapshotUri : undefined,
    matching,
    continueArguments:
      matching && current ? current.continueArguments : undefined,
    image: observation
      ? study?.captures.find(
          (capture) =>
            capture.phase === observation.capturePhase &&
            (capture.snapshotId === observation.id ||
              (study.observations.length === 1 && !capture.snapshotId)),
        )
      : undefined,
    scenarioProgress: study && {
      lastObservedTitle: observation ? selectedItem.title : undefined,
      unverifiedLinkCount: 0,
      missingImageTitles: descriptor.capturePhases
        .filter(
          (phase) =>
            !study.captures.some(
              (capture) =>
                capture.phase === phase && capture.status === 'captured',
            ),
        )
        .map((phase) =>
          phase === 'before'
            ? 'Before action'
            : phase === 'after'
              ? `${selectedItem.title} result`
              : selectedItem.title,
        ),
    },
  }
}
