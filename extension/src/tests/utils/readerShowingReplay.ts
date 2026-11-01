import type { StudyService } from '../../service'

/** The reader revision the stub reports, which the refusal text names as `expectedRevision`. */
export const REPLAY_READER_REVISION = 4

/**
 * Installs a presentation controller on a service whose open reader shows a saved replay, so the reader does not follow the current run.
 * Used by the per-profile start tests that pin the refusal an open replay gives every profile; no reader, workspace or editor is involved.
 * @param service - The service whose starts the reader gates.
 * @returns `returnToCurrent`, which makes the reader follow the current run again as `codebook_return_current` does.
 * @example
 * const reader = readerShowingReplay(harness.service)
 * reader.returnToCurrent() // the next start is accepted
 */
export function readerShowingReplay(service: StudyService): {
  returnToCurrent: () => void
} {
  let followingCurrentRun = false
  const unused = (): never => {
    throw new Error(
      'This presentation call is not part of the start under test.',
    )
  }
  service.presentationController = {
    presentationState: () =>
      ({
        state: 'open',
        reader: {
          followingCurrentRun,
          contentRevision: REPLAY_READER_REVISION,
        },
      }) as unknown as ReturnType<
        NonNullable<StudyService['presentationController']>['presentationState']
      >,
    readPresentationState: unused,
    changePresentation: unused,
    returnToCurrent: unused,
    assertPresentationIdle: () => undefined,
    nodeHistoryLearningMaterialSaved: unused,
    replayControlAccepted: unused,
    markAgentRecordingOpen: unused,
    publishLearningSave: () => undefined,
  }
  return {
    returnToCurrent: (): void => {
      followingCurrentRun = true
    },
  }
}

/** The refusal text for {@link REPLAY_READER_REVISION}, hard-coded so a test pins the wording the agent reads. */
export const REPLAY_READER_REFUSAL =
  "The run was not started: the reader shows saved history and does not follow the current run (reader.followingCurrentRun is false), so none of this run's captures would be displayed. Call codebook_return_current with expectedRevision 4 (reader.contentRevision), then start again with a new key."
