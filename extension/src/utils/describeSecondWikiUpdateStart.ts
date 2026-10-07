/**
 * Where the progress of a running Wiki update can be read in the editor at the moment a second start is refused:
 * - `notification`: a progress notification of the run is shown (the watch of a VS Code update after the chat's first sign, or the Cursor agent's run)
 * - `awaited-chat`: a VS Code update still waits for the first sign that the chat works on the request, and its notification is shown only after that sign
 * - `reader-only`: no notification is shown and none will follow (an editor without the progress API)
 */
export type WikiUpdateProgressPlace =
  'notification' | 'awaited-chat' | 'reader-only'

/** What every refusal of a second start says first: an update runs, and the browser reader shows it in each of its states. */
const ALREADY_UPDATING =
  'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader'

/** How the sentence goes on for each place: it names the notification only where one is shown, and says when one follows where the chat has given no sign yet. */
const PROGRESS_IN_THE_EDITOR: Record<WikiUpdateProgressPlace, string> = {
  notification: ' and in the notification here.',
  'awaited-chat':
    '. Codebook is waiting for the editor chat to take up the request; once it has, a notification here watches the update.',
  'reader-only': '.',
}

/**
 * Words the refusal of a second start of a Wiki update while one runs, with where its progress is at that moment; called by the extension for a second press of the browser's button, of its update link and of the command.
 *
 * Why: a VS Code update shows its notification only after the chat's first sign, so for up to the bound of that wait a sentence that names "the notification here" sends the learner to something that is not on screen.
 *
 * @param place - Where the progress can be read in the editor now.
 * @returns The sentence: that an update already runs, the browser reader, and the notification only where one is shown or will follow.
 * @example
 * describeSecondWikiUpdateStart('notification')
 * // => 'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the notification here.'
 * describeSecondWikiUpdateStart('reader-only')
 * // => 'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader.'
 */
export function describeSecondWikiUpdateStart(
  place: WikiUpdateProgressPlace,
): string {
  return `${ALREADY_UPDATING}${PROGRESS_IN_THE_EDITOR[place]}`
}
