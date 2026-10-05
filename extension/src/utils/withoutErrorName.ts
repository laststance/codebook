/**
 * Drops the leading error name from the string form of a thrown error, for the sentences {@link recordingNotShownReason} and {@link StudyWorkspace} build around a playback failure: the playback controller keeps a failure as that string form (`Error: …`).
 * @param reason - The string form of an error, or any other sentence.
 * @returns The text without a leading `<Name>Error: `; a text that has none is returned unchanged.
 * @example
 * withoutErrorName('Error: The recording is unavailable.')  // => 'The recording is unavailable.'
 * withoutErrorName('StudyError: Focus the work window.')    // => 'Focus the work window.'
 * withoutErrorName('The recording is unavailable.')         // => 'The recording is unavailable.'
 */
export function withoutErrorName(reason: string): string {
  return reason.replace(/^[A-Za-z]*Error: /, '')
}
