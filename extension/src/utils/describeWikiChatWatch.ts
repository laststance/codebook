import {
  NEW_CHAT_PLACE,
  OPEN_CHAT_KEEPS_ITS_PLACE,
  OPEN_CHAT_PLACE,
} from './describeWikiChatHandOver'
import type { WikiChatSession } from './handWikiRequestToChat'

/** Where the watched request is, for each session it can have gone to; the words are those of the confirmation. */
const WATCHED_REQUEST_PLACES: Record<WikiChatSession, string> = {
  own: `${NEW_CHAT_PLACE}; the chat you had open ${OPEN_CHAT_KEEPS_ITS_PLACE}`,
  shared: OPEN_CHAT_PLACE,
}

/**
 * Words the notification that watches a VS Code Wiki update; called by the extension for the title of the progress notification, which every entry of the update shows (the browser's button and the command).
 *
 * Why: the command **Codebook: Update LLM Wiki** asks for no confirmation, so the notification is the first text that tells its learner that the request went into a new chat and where the chat they had open is. It says only the place of the request; what becomes of a draft is the confirmation's and the README's.
 *
 * @param session - Where the request was sent: a chat session of Codebook's own, or the one the learner had open.
 * @returns The title: that Codebook watches for the update, where the request is, and that Cancel stops the watch and not the chat.
 * @example
 * describeWikiChatWatch('own')
 * // => 'Watching for the LLM Wiki update in a new chat; the chat you had open keeps its place in the chat list (Cancel stops watching, not the chat)'
 * describeWikiChatWatch('shared')
 * // => 'Watching for the LLM Wiki update in the chat that is open (Cancel stops watching, not the chat)'
 */
export function describeWikiChatWatch(session: WikiChatSession): string {
  return `Watching for the LLM Wiki update ${WATCHED_REQUEST_PLACES[session]} (Cancel stops watching, not the chat)`
}
