import { WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS } from '../constants'

/**
 * Bounds a text of the editor or of its chat that a failure sentence of a Wiki update quotes, so the sentence stays short enough to be shown whole with its next step; called by {@link describeWikiChatOpenFailure}, {@link describeWikiChatErrorReply}, {@link describeBrokenWikiWatch} and {@link unreadWikiUpdateEnd}.
 * Characters are counted and cut as code points, as {@link cutTextToFit} cuts, so an emoji or another character outside the Basic Multilingual Plane is never split into half a surrogate pair.
 * @param text - What the chat command threw, or the message of the error the chat replied with.
 * @returns The text, cut to {@link WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS} characters and ended with "…" when it is longer.
 * @example
 * cutChatCause('Chat is unavailable') // => 'Chat is unavailable'
 * cutChatCause('x'.repeat(150))       // => 120 times 'x', then '…'
 */
export function cutChatCause(text: string): string {
  const characters = Array.from(text)
  return characters.length > WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS
    ? `${characters.slice(0, WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS).join('').trimEnd()}…`
    : text
}
