/**
 * Words what the learner reads when **Codebook: Set Up AI Chat** has finished, so the next step names the chat session that can reach Codebook's tools; called by the setup command in {@link activate}.
 * VS Code can open a chat request in a Copilot CLI session (its `chat.defaultToCopilotHarness` and `chat.editor.preferCopilotHarness` settings), whose own MCP client cannot reach Codebook's server; the agent then says that no Codebook tool is connected.
 * @param isCursorHost - Whether the editor is Cursor, which registers Codebook under Customize > MCPs.
 * @returns The sentence for the editor's information message.
 * @example
 * aiChatReadyMessage(true) // => 'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.'
 */
export function aiChatReadyMessage(isCursorHost: boolean): string {
  if (isCursorHost)
    return 'Codebook skill and workspace setup saved. Check Cursor Customize > MCPs for Codebook before using /codebook; if absent, close and reopen this work window.'
  return 'Codebook AI chat is ready for this workspace. Open a new chat in a Local session and choose /codebook. A Copilot CLI session cannot reach Codebook: if the agent says that no Codebook tool is connected, turn off chat.defaultToCopilotHarness and chat.editor.preferCopilotHarness in Settings and start a Local chat.'
}
