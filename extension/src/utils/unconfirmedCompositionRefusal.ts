/**
 * Says that the two panes of a live run or of a recording could not be confirmed after a selection or a Restore.
 * {@link StudyWorkspace} answers it with the cause as its detail (the tab that covers the captured source, or the reader's own reason); the sentence names the kind of content the reader holds, so a reader that shows a recording is not told about a "live" layout.
 * @param showsRecording - Whether the reader holds a recording; otherwise it follows a live run.
 * @returns The refusal's message.
 * @example
 * unconfirmedCompositionRefusal(true)
 * // => "The recording's Study layout could not be confirmed after Restore."
 */
export function unconfirmedCompositionRefusal(showsRecording: boolean): string {
  return showsRecording
    ? "The recording's Study layout could not be confirmed after Restore."
    : 'The live Study layout could not be confirmed after Restore.'
}
