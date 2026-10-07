import { cutChatCause } from './cutChatCause'

/**
 * Words the failure of a VS Code Wiki update whose watch broke off with an error while the chat worked on the request; called by the extension when it records that end.
 *
 * Why: the watch is Codebook's, the update is the chat's. A watch that threw says nothing about the chat, which was not stopped and can still publish, so the sentence must not read like the end of the update: it says that Codebook stopped watching and why, that the chat goes on, and the two things the learner can do. The thrown text comes from the system, so it is bounded ({@link cutChatCause}); the sentence is marked as Codebook's own, so the page shows it whole.
 *
 * @param thrownText - The message of what the watch threw.
 * @returns The sentence with the thrown text in brackets, cut to the limit of {@link cutChatCause}, followed by what the chat can still do and the learner's two steps.
 * @example
 * describeBrokenWikiWatch('EIO: i/o error, close')
 * // => 'Codebook stopped watching the update because of an error (EIO: i/o error, close). The VS Code chat was not stopped and can still publish: let it finish (the Wiki page says when it has), or stop it in the chat.'
 */
export function describeBrokenWikiWatch(thrownText: string): string {
  return `Codebook stopped watching the update because of an error (${cutChatCause(thrownText)}). The VS Code chat was not stopped and can still publish: let it finish (the Wiki page says when it has), or stop it in the chat.`
}
