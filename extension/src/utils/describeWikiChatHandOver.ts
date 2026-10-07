import { NEW_CHAT_COMMAND } from './handWikiRequestToChat'

/** Where a request goes that gets a chat of its own; the confirmation says it before the press and the watch's notification after it ({@link describeWikiChatWatch}), in these words. */
export const NEW_CHAT_PLACE = 'in a new chat'

/** What becomes of the chat the new chat takes the place of, said of "the chat you have open" before the press and of "the chat you had open" after it. */
export const OPEN_CHAT_KEEPS_ITS_PLACE = 'keeps its place in the chat list'

/** Where a request goes in an editor without New Chat; the confirmation and the watch's notification say it in these words. */
export const OPEN_CHAT_PLACE = 'in the chat that is open'

/** What the confirmation says where the editor has New Chat: the request gets a chat of its own. */
const NEW_CHAT_HAND_OVER = `Copilot Chat receives the update request for this project ${NEW_CHAT_PLACE}; the chat you have open ${OPEN_CHAT_KEEPS_ITS_PLACE}. A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.`

/** What the confirmation says where the editor has no New Chat: the request goes into the open chat like a typed message. */
const OPEN_CHAT_HAND_OVER = `Copilot Chat receives the update request for this project ${OPEN_CHAT_PLACE}, like a message you typed: it waits behind a request in progress, a request that waits for your confirmation is cancelled, and a draft in the chat’s input is replaced by the request.`

/**
 * Says, before the learner confirms a VS Code Wiki update, where its request will go and what that does to the chat they have open; called by the extension for the detail of the confirmation the browser's update button asks for.
 *
 * Why: the hand-over starts a new chat ({@link handWikiRequestToChat}), so the chat the learner had open leaves the view, and the request replaces a draft in an empty chat's input. A learner who confirms should know both, and in an editor without New Chat that the request acts on the open chat like a message they typed.
 *
 * @param editorCommands - The ids of the commands the editor has (`vscode.commands.getCommands`).
 * @returns The sentences for an editor with New Chat when its command is among them; otherwise those for the open chat.
 * @example
 * describeWikiChatHandOver(['workbench.action.chat.open', 'workbench.action.chat.newChat'])
 * // => 'Copilot Chat receives the update request for this project in a new chat; the chat you have open keeps its place in the chat list. A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.'
 */
export function describeWikiChatHandOver(
  editorCommands: readonly string[],
): string {
  return editorCommands.includes(NEW_CHAT_COMMAND)
    ? NEW_CHAT_HAND_OVER
    : OPEN_CHAT_HAND_OVER
}
