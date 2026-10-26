import { NEW_CHAT_COMMAND } from './handWikiRequestToChat'
import type { WikiRunKind } from './wikiUpdateRun'

/** Where a request goes that gets a chat of its own, as the confirmation says it before the press. */
const NEW_CHAT_PLACE = 'in a new chat'

/** What becomes of the chat the new chat takes the place of, said of "the chat you have open". */
const OPEN_CHAT_KEEPS_ITS_PLACE = 'keeps its place in the chat list'

/** The case in which New Chat finds no chat to renew, as the confirmation says it before the press: a Chat view that opens for the first time in a window may still be restoring its last chat when New Chat runs, New Chat then does nothing, and the request goes into the chat the view restores. No command tells an extension whether the view has its chat yet, so the confirmation names the case. */
const RESTORED_CHAT_CASE_BEFORE =
  'If the Chat view has not been opened in this window yet, the request may go into the chat it restores.'

/** Where a request goes in an editor without New Chat, as the confirmation says it. */
const OPEN_CHAT_PLACE = 'in the chat that is open'

/** The request as each run kind's confirmation names it, so a generation's request is never called an update request (Cycle 0055, D5). */
const REQUEST_NAMES: Record<WikiRunKind, string> = {
  update: 'the update request',
  generate: 'the generate request',
}

/**
 * Words where the editor has New Chat: the request gets a chat of its own; called by {@link describeWikiChatHandOver}.
 * @param requestName - The request as the run's kind names it ({@link REQUEST_NAMES}).
 * @returns The sentences of the hand-over to a new chat.
 * @example newChatHandOver('the update request') // => 'Copilot Chat receives the update request for this project in a new chat; …'
 */
const newChatHandOver = (requestName: string): string =>
  `Copilot Chat receives ${requestName} for this project ${NEW_CHAT_PLACE}; the chat you have open ${OPEN_CHAT_KEEPS_ITS_PLACE}. ${RESTORED_CHAT_CASE_BEFORE} A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.`

/**
 * Words where the editor has no New Chat: the request goes into the open chat like a typed message; called by {@link describeWikiChatHandOver}.
 * @param requestName - The request as the run's kind names it ({@link REQUEST_NAMES}).
 * @returns The sentence of the hand-over to the open chat.
 * @example openChatHandOver('the update request') // => 'Copilot Chat receives the update request for this project in the chat that is open, like a message you typed: …'
 */
const openChatHandOver = (requestName: string): string =>
  `Copilot Chat receives ${requestName} for this project ${OPEN_CHAT_PLACE}, like a message you typed: it waits behind a request in progress, a request that waits for your confirmation is cancelled, and a draft in the chat’s input is replaced by the request.`

/**
 * Says, before the learner confirms a VS Code Wiki update, where its request will go and what that does to the chat they have open; called by the extension for the detail of the confirmation the browser's update button asks for.
 *
 * Why: the hand-over starts a new chat ({@link handWikiRequestToChat}), so the chat the learner had open leaves the view, and the request replaces a draft in an empty chat's input. Where the Chat view opens only for this request, the new chat may not come about ({@link RESTORED_CHAT_CASE_BEFORE}); the confirmation says so, so that it is true in that state too. A learner who confirms should know both, and in an editor without New Chat that the request acts on the open chat like a message they typed.
 *
 * @param editorCommands - The ids of the commands the editor has (`vscode.commands.getCommands`).
 * @param runKind - Whether the confirmation is a generation's or an update's; the request is named by it.
 * @returns The sentences for an editor with New Chat when its command is among them; otherwise those for the open chat.
 * @example
 * describeWikiChatHandOver(['workbench.action.chat.open', 'workbench.action.chat.newChat'])
 * // => 'Copilot Chat receives the update request for this project in a new chat; the chat you have open keeps its place in the chat list. If the Chat view has not been opened in this window yet, the request may go into the chat it restores. A draft you typed into an empty chat is replaced by the request; a draft in a chat with messages stays with that chat.'
 */
export function describeWikiChatHandOver(
  editorCommands: readonly string[],
  runKind: WikiRunKind = 'update',
): string {
  const requestName = REQUEST_NAMES[runKind]
  return editorCommands.includes(NEW_CHAT_COMMAND)
    ? newChatHandOver(requestName)
    : openChatHandOver(requestName)
}
