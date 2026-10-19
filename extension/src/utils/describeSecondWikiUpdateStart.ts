/**
 * Where the progress of a running Wiki update can be read in the editor at the moment a second start is refused:
 * - `status-bar`: the status bar entry of a VS Code update's watch is shown (after the chat's first sign)
 * - `notification`: the progress notification of the Cursor agent's run is shown
 * - `awaited-chat`: a VS Code update still waits for the first sign that the chat works on the request, and its status bar entry is shown only after that sign
 * - `reader-only`: nothing is shown in the editor and nothing will follow (an editor without the API that shows the run)
 */
export type WikiUpdateProgressPlace =
  'status-bar' | 'notification' | 'awaited-chat' | 'reader-only'

/** What every refusal of a second start says first: an update runs, and the browser reader shows it in each of its states. */
const ALREADY_UPDATING =
  'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader'

/** How the sentence goes on for each place: it names the status bar entry or the notification only where one is shown, and says when the entry follows where the chat has given no sign yet. */
const PROGRESS_IN_THE_EDITOR: Record<WikiUpdateProgressPlace, string> = {
  'status-bar': ' and in the status bar here.',
  notification: ' and in the notification here.',
  'awaited-chat':
    '. Codebook is waiting for the editor chat to take up the request; once it has, the status bar here shows the watch and its Cancel.',
  'reader-only': '.',
}

/**
 * Words the refusal of a second start of a Wiki update while one runs, with where its progress is at that moment; called by the extension for a second press of the browser's button, of its update link and of the command.
 *
 * Why: a VS Code update shows its watch in the status bar only after the chat's first sign, and a Cursor run in a notification, so a sentence that names one place in every state sends the learner to something that is not on screen.
 *
 * @param place - Where the progress can be read in the editor now.
 * @returns The sentence: that an update already runs, the browser reader, and the status bar or the notification only where one is shown or will follow.
 * @example
 * describeSecondWikiUpdateStart('status-bar')
 * // => 'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader and in the status bar here.'
 * describeSecondWikiUpdateStart('reader-only')
 * // => 'Codebook is already updating this project’s LLM Wiki. Its progress is in the browser reader.'
 */
export function describeSecondWikiUpdateStart(
  place: WikiUpdateProgressPlace,
): string {
  return `${ALREADY_UPDATING}${PROGRESS_IN_THE_EDITOR[place]}`
}
