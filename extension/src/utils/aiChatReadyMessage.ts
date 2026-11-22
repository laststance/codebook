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

/**
 * Words what the learner reads when **Codebook: Set Up AI Chat** has finished, so the next step names the chat session that can reach Codebook's tools; called by the setup command in {@link activate}.
 * VS Code can open a chat request in a Copilot CLI session (its `chat.defaultToCopilotHarness` and `chat.editor.preferCopilotHarness` settings), whose own MCP client cannot reach Codebook's server; the agent then says that no Codebook tool is connected. Devin Desktop's Devin Local reads its MCP config only when a window loads, and offers the skill under its source-qualified name `/devin:codebook`.
 * @param host - The editor the setup ran in: Cursor registers Codebook under Customize > MCPs, and Devin Desktop needs a reload.
 * @returns The sentence for the editor's information message.
 * @example
 * aiChatReadyMessage('cursor') // => 'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.'
 */
export function aiChatReadyMessage(host: AiChatHost): string {
  return READY_MESSAGES[host]
}
