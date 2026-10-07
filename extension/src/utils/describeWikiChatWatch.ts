import { MS_PER_MINUTE } from '../constants'

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
 * Why: the command **Codebook: Update LLM Wiki** asks for no confirmation, so the notification is the first text that tells its learner that the request went into a new chat and where the chat they had open is. It says only the place of the request; what becomes of a draft is the confirmation's and the README's. It also says when the watch ends, because one end Codebook cannot see: once the chat asked the learner to approve a step, the editor's chat command has returned, so a chat that stops after a refused step is not seen to stop ({@link watchWikiChatReply}), and the watch would go on to its bound unless the learner presses Cancel.
 *
 * @param session - Where the request was sent: a chat session of Codebook's own, or the one the learner had open.
 * @param timeoutMs - The bound of the watch, named in whole minutes.
 * @returns The title: that Codebook watches for the update and where the request is; when the watch ends, and that Cancel stops the watch and not the chat; and to press Cancel after a refused step.
 * @example
 * describeWikiChatWatch('own', 900_000)
 * // => 'Watching for the LLM Wiki update in a new chat; the chat you had open keeps its place in the chat list. The watch ends when the new Wiki is published, after 15 minutes, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.'
 * describeWikiChatWatch('shared', 60_000)
 * // => 'Watching for the LLM Wiki update in the chat that is open. The watch ends when the new Wiki is published, after 1 minute, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.'
 */
export function describeWikiChatWatch(
  session: WikiChatSession,
  timeoutMs: number,
): string {
  const minutes = Math.round(timeoutMs / MS_PER_MINUTE)
  return `Watching for the LLM Wiki update ${WATCHED_REQUEST_PLACES[session]}. The watch ends when the new Wiki is published, after ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, or with Cancel, which stops watching, not the chat. If you refuse a step of the chat, press Cancel.`
}
