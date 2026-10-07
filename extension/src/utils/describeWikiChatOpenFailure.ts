import { cutChatCause } from './cutChatCause'

/**
 * Words the failure of a VS Code Wiki update whose chat command threw; called by the extension when it records that end.
 *
 * Why: the sentence ends with the learner's next step and is marked as one Codebook wrote, so the page shows it whole. The thrown text inside it comes from the editor, so it is bounded ({@link cutChatCause}); otherwise a long one would make the whole sentence as long as it is.
 *
 * @param thrownText - The message of what the chat command threw.
 * @returns The sentence with the thrown text in brackets, cut to {@link WIKI_CHAT_OPEN_CAUSE_LIMIT_CHARS} characters and ended with "…" when it is longer, followed by the next step.
 * @example
 * describeWikiChatOpenFailure('Chat is unavailable')
 * // => 'The editor chat could not be opened (Chat is unavailable). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.'
 */
export function describeWikiChatOpenFailure(thrownText: string): string {
  return `The editor chat could not be opened (${cutChatCause(thrownText)}). Install or enable GitHub Copilot Chat, then press Update LLM Wiki again.`
}
