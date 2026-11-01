import { NODE_LEARNING_SAVE_ACTION } from './describeNodeLearningSave'
import { stripTerminalControls } from './stripTerminalControls'

/** The kind of replay a Save notice calls the saved study. */
export type ReplayLabel = 'Server' | 'Extension'

/** The three notices that end a Save whose history was sealed and read. */
export type ProfileSaveOutcome =
  | { kind: 'saved' }
  | {
      kind: 'partial'
      /** The first reason the capture is partial, and how many more there are. */
      firstReason: string
      moreCount: number
    }
  | { kind: 'explanation-missing' }

/**
 * Words the notice that ends a Save of a server or extension run: saved, saved as partial with its first reason, or saved with the chat's explanation still missing; each offers Open replay.
 * Called by the describe functions of both profiles and by {@link ProfileLearningSave.finishSaved}.
 * @param label - The kind of replay the notice names.
 * @param outcome - Which of the three notices.
 * @returns The notice's text and its Open replay action.
 * @example describeReplayOutcome('Extension', { kind: 'saved' }).text // => 'Extension replay saved.'
 */
export function describeReplayOutcome(
  label: ReplayLabel,
  outcome: ProfileSaveOutcome,
): { text: string; actions: readonly string[] } {
  const actions = [NODE_LEARNING_SAVE_ACTION.openReplay]
  switch (outcome.kind) {
    case 'saved':
      return { text: `${label} replay saved.`, actions }
    case 'partial':
      return {
        text: `${label} replay saved as partial: ${stripTerminalControls(outcome.firstReason).replace(/\.$/, '')}${outcome.moreCount ? ` (+${outcome.moreCount} more)` : ''}.`,
        actions,
      }
    case 'explanation-missing':
      return {
        text: `${label} replay saved; the chat's explanation is not saved yet.`,
        actions,
      }
  }
}
