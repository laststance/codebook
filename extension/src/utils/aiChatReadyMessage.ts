import {
  DEVIN_ENTRY_REFRESHED_DISABLED_SENTENCE,
  DEVIN_ENTRY_REFRESHED_SENTENCE,
} from '../constants'

/** The editors whose **Codebook: Set Up AI Chat** ends with its own next step. */
type AiChatHost = 'vscode' | 'cursor' | 'devin'

/** What each editor's learner reads when setup has finished. */
const READY_MESSAGES: Record<AiChatHost, string> = {
  vscode:
    'Codebook AI chat is ready for this workspace. Open a new chat in a Local session and choose /codebook. A Copilot CLI session cannot reach Codebook: if the agent says that no Codebook tool is connected, turn off chat.defaultToCopilotHarness and chat.editor.preferCopilotHarness in Settings and start a Local chat.',
  cursor:
    'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.',
  devin:
    "Codebook skill and MCP server saved for Devin Local. Reload this window so Devin Local loads Codebook's MCP server, then type /devin:codebook in a Local session.",
}

/** What the Devin Desktop learner reads instead of the reload promise when Devin's Customize keeps Codebook's entry turned off: a reload alone loads no server for it. */
const DEVIN_ENTRY_TURNED_OFF_MESSAGE =
  "Codebook skill and MCP server saved for Devin Local, but the codebook server is turned off in Devin's Customize. Turn it on there, reload this window, then type /devin:codebook in a Local session."

/**
 * Words what the learner reads when **Codebook: Set Up AI Chat** has finished, so the next step names the chat session that can reach Codebook's tools; called by the setup command in {@link activate}.
 * VS Code can open a chat request in a Copilot CLI session (its `chat.defaultToCopilotHarness` and `chat.editor.preferCopilotHarness` settings), whose own MCP client cannot reach Codebook's server; the agent then says that no Codebook tool is connected. Devin Desktop's Devin Local reads its MCP config only when a window loads, and offers the skill under its source-qualified name `/devin:codebook`.
 * @param host - The editor the setup ran in: Cursor registers Codebook under Customize > MCPs, and Devin Desktop needs a reload.
 * @param options - `devinEntryDisabled`: the Devin entry kept `"disabled": true`, so the notice sends the learner to Devin's Customize instead of promising that the reload loads the server; read only for `devin`.
 * @returns The sentence for the editor's information message.
 * @example
 * aiChatReadyMessage('devin', { devinEntryDisabled: true }) // => "Codebook skill and MCP server saved for Devin Local, but the codebook server is turned off in Devin's Customize. Turn it on there, reload this window, then type /devin:codebook in a Local session."
 * aiChatReadyMessage('cursor') // => 'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.'
 */
export function aiChatReadyMessage(
  host: AiChatHost,
  options: { devinEntryDisabled?: boolean } = {},
): string {
  // A turned-off Devin entry is never loaded by the reload, so the learner turns it on first.
  if (host === 'devin' && options.devinEntryDisabled)
    return DEVIN_ENTRY_TURNED_OFF_MESSAGE
  return READY_MESSAGES[host]
}

/**
 * Words what a Devin Desktop learner reads after activation brought Codebook's MCP entry to this installation, so a turned-off entry sends them to Devin's Customize instead of promising that the reload starts the server; called by the activation refresh in {@link activate}.
 * @param entryDisabled - The entry kept `"disabled": true` in Devin's MCP config.
 * @returns The notice text; the reload sentence when the entry is on.
 * @example
 * devinEntryRefreshedMessage(true) // => "Codebook updated its MCP server entry for Devin Local to this installation, but the codebook server is turned off in Devin's Customize. Turn it on there, then reload this window so Devin Local starts the updated server."
 */
export function devinEntryRefreshedMessage(entryDisabled: boolean): string {
  // A turned-off entry is never loaded by the reload, so the learner turns it on first.
  return entryDisabled
    ? DEVIN_ENTRY_REFRESHED_DISABLED_SENTENCE
    : DEVIN_ENTRY_REFRESHED_SENTENCE
}
