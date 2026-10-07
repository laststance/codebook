import { WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS } from '../constants'

/**
 * Bounds a text of the editor or of its chat that a failure sentence of a Wiki update quotes, so the sentence stays short enough to be shown whole with its next step; called by {@link describeWikiChatOpenFailure} and {@link describeWikiChatErrorReply}.
 * @param text - What the chat command threw, or the message of the error the chat replied with.
 * @returns The text, cut to {@link WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS} characters and ended with "…" when it is longer.
 * @example
 * cutChatCause('Chat is unavailable') // => 'Chat is unavailable'
 * cutChatCause('x'.repeat(150))       // => 120 times 'x', then '…'
 */
export function cutChatCause(text: string): string {
  return text.length > WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS
    ? `${text.slice(0, WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS).trimEnd()}…`
    : text
}
