/** What Set Up AI Chat, the activation refresh and the removal answer in a Devin Desktop window that runs in a remote (WSL, SSH, a container): Devin's skill and MCP config folders and the bridge Devin starts are those of the remote machine, which no check has covered (Cycle 0143). */
export const DEVIN_REMOTE_UNSUPPORTED_SENTENCE =
  'Devin Desktop setup in a remote window is not supported yet.'

/** The Output line of the activation refresh when the Node named by `codebook.nodeExecutable` cannot be used; fixed text, so no raw text of the failure reaches the Output. */
export const DEVIN_REFRESH_NODE_FAILURE_LINE =
  'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not refresh its Devin Desktop MCP entry.'

/** What a Devin Desktop window with chat setup says after its agent server started again once it was stopped: the bridge Devin Local started at the window load connected to the stopped server. */
export const DEVIN_SERVER_RESTARTED_SENTENCE =
  'Codebook restarted its agent server. Reload this window so Devin Local connects to the new server.'

/** The folder of Codebook's global storage whose lock serializes every Devin Desktop setup and removal of the user's windows. */
export const DEVIN_SETUP_STORAGE_DIRECTORY = 'devin-setup'

/** What Set Up AI Chat answers in Devin Desktop when the Node named by `codebook.nodeExecutable` cannot be used; fixed text, so the executable's own output never reaches a notice or the Output. */
export const DEVIN_SETUP_NODE_FAILURE_SENTENCE =
  'Codebook could not use the Node.js named by codebook.nodeExecutable, so it did not set up Devin Desktop. Check that setting, then run Codebook: Set Up AI Chat again.'

/** What a Devin Desktop setup or removal answers once it has waited about ten seconds for another Devin Desktop window that is still changing the setup (another window is another extension host process); never the learning-storage sentence of the lock. */
export const DEVIN_SETUP_LOCK_HELD_SENTENCE =
  'Another Codebook window is changing the Devin Desktop setup. Try again in a moment.'

/** What the Devin Desktop setup answers when this window's connection descriptor cannot be read as a JSON object; fixed text, because the descriptor holds the bearer token and a parser's own message quotes part of the file. */
export const DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE =
  "Codebook could not read this window's connection descriptor. Run Codebook: Stop Agent Server and Codebook: Start Agent Server, then try again."
