/**
 * Says whether Codebook gives the keyboard to the file a debugger stop opened, instead of leaving the focus where the editor put it.
 * Codebook hands over only where the editor would not focus the paused file itself: the effective `debug.focusEditorOnBreak` is `false` (the contributed default), no explicit layer sets it, no recording is open (a replay's historical debugger opens no file with the keyboard), and the stop is not Codebook's (its chat return keeps the keyboard).
 * Asked by {@link StudyWorkspace} when the editor reports a stop's frame, before it hands the stop's keyboard over and before it decides whether a return to the chat is owed.
 *
 * @param state - The facts the reader knows at that moment.
 * @param state.recordingActive - Whether a learning recording is open.
 * @param state.focusEditorOnBreak - The effective `debug.focusEditorOnBreak`; `undefined` is the editor's own default, which focuses the file.
 * @param state.hasExplicitFocusEditorOnBreak - Whether a user, workspace or workspace-folder layer sets the setting.
 * @param state.isCodebookCausedStop - Whether the stop's session is a Codebook run or an owned Node test run.
 * @returns `true` only when no recording is open, the setting is `false`, no explicit layer sets it and the stop is not Codebook's.
 * @example
 * isStopKeyboardHandOverDue({ recordingActive: false, focusEditorOnBreak: false, hasExplicitFocusEditorOnBreak: false, isCodebookCausedStop: false }) // => true
 * isStopKeyboardHandOverDue({ recordingActive: false, focusEditorOnBreak: false, hasExplicitFocusEditorOnBreak: false, isCodebookCausedStop: true }) // => false
 */
export function isStopKeyboardHandOverDue(state: {
  recordingActive: boolean
  focusEditorOnBreak: boolean | undefined
  hasExplicitFocusEditorOnBreak: boolean
  isCodebookCausedStop: boolean
}): boolean {
  return (
    !state.recordingActive &&
    state.focusEditorOnBreak === false &&
    !state.hasExplicitFocusEditorOnBreak &&
    !state.isCodebookCausedStop
  )
}
