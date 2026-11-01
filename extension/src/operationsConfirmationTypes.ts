import type { RepositoryOperation } from './repositoryConfigSchemas'

/**
 * What the page said about one declared operation's control when the saved-session confirmation was prepared: whether exactly one control matched, whether it is a secret control, and the visible label of a chosen option.
 * Read through `StudyRuntime.readOperationConfirmationFacts`; never holds a control's value.
 */
export type OperationConfirmationFact = {
  index: number
  found: boolean
  secret: boolean
  optionLabel?: string
}

/** One operation as the saved-session confirmation dialog lists it; `value` is display text already resolved (`(hidden)` for a secret), absent for a click. */
export type SavedSessionOperationLine = {
  index: number
  kind: RepositoryOperation['kind']
  title: string
  value?: string
}

/** The question the saved-session confirmation dialog asks once per run, before operation 1. */
export type SavedSessionOperationsQuestion = {
  runId: string
  repository: string
  entryPath: string
  operations: readonly SavedSessionOperationLine[]
}

/** The notice the editor shows after the dialog was declined, timed out, answered too late, or confirmed through Review again. */
export type OperationsConfirmationNotice = {
  runId: string
  repository: string
  kind: 'declined' | 'timed-out' | 'expired-answer' | 'confirmed'
}

/** The run resource's `confirmation` of a version 3 run: `not-needed` (no saved session, or the setting is off), `awaiting-learner`, `declined` or `confirmed`. */
export type OperationsConfirmationState =
  'not-needed' | 'awaiting-learner' | 'declined' | 'confirmed'

/** The run resource's `confirmationSetting`: `off` when the learner turned the confirmation off in user settings. */
export type OperationsConfirmationSetting = 'off'
