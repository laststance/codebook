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

/** The Output line of the activation refresh when both setup records stand but the config holds no `codebook` entry of Codebook's (for example the learner deleted only mcp_config.json): the window reconnects nothing. */
export const DEVIN_ENTRY_MISSING_LINE =
  "Codebook found no codebook entry of its own in Devin Desktop's MCP config, so this window did not reconnect Devin Local. Run Codebook: Set Up AI Chat again."

/** What a Devin Desktop setup answers when the server it checked stopped, was replaced or no longer serves the workspace before the setup could finish. */
export const DEVIN_SETUP_SERVER_CHANGED_SENTENCE =
  'Codebook server stopped or changed workspace while Devin Desktop setup was finishing, so the setup did not complete. Run Codebook: Set Up AI Chat again.'

/** What a Devin Desktop setup answers when the window's workspace folder changed while the setup saved its final value: the setup did not complete for the folder now open. */
export const DEVIN_SETUP_FOLDER_CHANGED_SENTENCE =
  'The workspace folder changed while Devin Desktop setup was finishing, so the setup did not complete for this folder. Run Codebook: Set Up AI Chat again.'

/** What a Devin Desktop setup answers when its final check finds that the connection descriptor does not name the server the setup checked: a restart of the same server would reuse that descriptor, so the learner is asked to stop it first. */
export const DEVIN_SETUP_DESCRIPTOR_REPLACED_SENTENCE =
  'The Devin Desktop setup changed while this setup ran; run Codebook: Stop Agent Server, then Codebook: Set Up AI Chat again.'

/** What the server answers (HTTP 403) to a Devin Desktop bridge request while this window's AI chat mark is off, for example after a failed setup took it back; read by Devin's MCP log, not by the learner. */
export const DEVIN_BRIDGE_NOT_SET_UP_SENTENCE =
  'Codebook AI chat for Devin Desktop is not set up in this window. Run Codebook: Set Up AI Chat, then reload the window.'

/** What a failed Devin Desktop setup adds to its sentence when its rollback could not take back everything it saved: the reasons are in the Output. */
export const DEVIN_SETUP_ROLLBACK_INCOMPLETE_SENTENCE =
  "Codebook could not take back everything the setup saved; see Codebook's Output for details."

/**
 * What the Devin Desktop setup answers when the installation id of Codebook's MCP receipt cannot be read (for example the file was restored with a mode other than private), because the bridge would refuse the window and the offered reload could not connect.
 * @param receiptPath - The `devin-mcp/receipt.json` in Codebook's global storage.
 * @returns One sentence that names the file to repair.
 * @example devinReceiptUnreadableSentence('/storage/devin-mcp/receipt.json') // => 'Codebook could not read the installation id in /storage/devin-mcp/receipt.json, …'
 */
export const devinReceiptUnreadableSentence = (receiptPath: string): string =>
  `Codebook could not read the installation id in ${receiptPath}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`

/**
 * What the Devin Desktop setup answers when one of Codebook's records cannot be used because others can read it or this user may not (a backup restored with another mode): the bridge would refuse the window and the offered reload could not connect.
 * @param receiptPath - The `receipt.json` of the skill or of the MCP entry, as the check names it.
 * @returns One sentence that names the file to repair.
 * @example devinReceiptPermissionSentence('/storage/devin-skill/receipt.json') // => 'Codebook could not use its record at /storage/devin-skill/receipt.json, …'
 */
export const devinReceiptPermissionSentence = (receiptPath: string): string =>
  `Codebook could not use its record at ${receiptPath}, so Devin Local could not connect. Make that file readable only by you (mode 600), then run Codebook: Set Up AI Chat again.`

/** What the Devin Desktop setup answers when one of its records was removed, replaced or changed while the setup ran. */
export const DEVIN_SETUP_CHANGED_MEANWHILE_SENTENCE =
  'The Devin Desktop setup changed while this setup ran; run Codebook: Set Up AI Chat again.'

/** What the Devin Desktop setup answers when its records could not be read at all (no verified permission problem, so no mode repair is offered). */
export const DEVIN_SETUP_RECORDS_UNREADABLE_SENTENCE =
  'Codebook could not read its setup records just now; run Codebook: Set Up AI Chat again.'

/** The title of the command that removes Codebook's Devin Desktop setup, as the sentences that ask to run it again name it. */
export const REMOVE_DEVIN_SETUP_COMMAND = 'Codebook: Remove Devin Desktop Setup'

/** A step of a Devin Desktop take-back or removal that waits on storage, as the sentences of a command that answered while the step still waited name it. */
export type DevinStorageStep =
  'skill' | 'MCP entry' | 'saved setup' | 'descriptor'

/** What a Devin Desktop window still runs after its command answered because storage did not: the take-back of a failed setup, or a removal; the window refuses a new setup and removal meanwhile. */
export type DevinBackgroundWorkKind = 'take-back' | 'removal'

/** How the sentences below name each kind of work: as a subject, as the work going on, and what it does once storage answers. */
const BACKGROUND_WORK: Record<
  DevinBackgroundWorkKind,
  { subject: string; doing: string; ending: string }
> = {
  'take-back': {
    subject: "Codebook's take-back of this Devin Desktop setup",
    doing: 'taking back an earlier Devin Desktop setup',
    ending: "it finishes when storage answers, and Codebook's Output says when",
  },
  removal: {
    subject: "Codebook's removal of the Devin Desktop setup",
    doing: 'removing the Devin Desktop setup',
    ending: 'it finishes when storage answers and then shows its result',
  },
}

/**
 * What a Devin Desktop command answers, and the Output line it writes, once a step of its take-back or removal has waited 10 seconds on storage ({@link DEVIN_SETUP_ROLLBACK_BUDGET_MS}): the step goes on under the setup lock, and the window refuses setup and removal until it ends.
 * @param kind - The work still going on.
 * @param step - The step that waits on storage.
 * @returns One sentence that names the step, then one that names the refusal.
 * @example devinStorageWaitSentence('take-back', 'MCP entry') // => "Codebook's take-back of this Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers, and Codebook's Output says when. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window."
 */
export const devinStorageWaitSentence = (
  kind: DevinBackgroundWorkKind,
  step: DevinStorageStep,
): string =>
  `${BACKGROUND_WORK[kind].subject} is still waiting on storage (${step}) after 10 seconds; ${BACKGROUND_WORK[kind].ending}. Until then Codebook: Set Up AI Chat and ${REMOVE_DEVIN_SETUP_COMMAND} refuse in this window.`

/**
 * What a Devin Desktop setup or removal answers at once while this window still runs a take-back or removal whose command answered because storage did not.
 * @param kind - The work still going on.
 * @param command - The title of the command that refused, which the learner runs again.
 * @returns One sentence that says what still runs, then how to go on.
 * @example devinBackgroundWorkSentence('take-back', 'Codebook: Set Up AI Chat') // => 'Codebook is still taking back an earlier Devin Desktop setup because storage does not answer. Run Codebook: Set Up AI Chat again once it finishes, or reload the window.'
 */
export const devinBackgroundWorkSentence = (
  kind: DevinBackgroundWorkKind,
  command: string,
): string =>
  `Codebook is still ${BACKGROUND_WORK[kind].doing} because storage does not answer. Run ${command} again once it finishes, or reload the window.`

/**
 * The Output line once a take-back or removal that answered its command early has ended, so the window takes setup and removal again.
 * @param kind - The work that ended.
 * @returns One line.
 * @example devinBackgroundWorkEndedLine('removal') // => 'Codebook is done removing the Devin Desktop setup now that storage answered.'
 */
export const devinBackgroundWorkEndedLine = (
  kind: DevinBackgroundWorkKind,
): string =>
  `Codebook is done ${BACKGROUND_WORK[kind].doing} now that storage answered.`

/**
 * The Output line of a take-back or removal that answered its command early and then failed, since the command can no longer show the failure.
 * @param kind - The work that failed.
 * @param reason - The failure's sentence.
 * @returns One line.
 * @example devinLateFailureLine('removal', 'Injected skill removal failure') // => "Codebook's removal of the Devin Desktop setup ended after storage answered: Injected skill removal failure"
 */
export const devinLateFailureLine = (
  kind: DevinBackgroundWorkKind,
  reason: string,
): string =>
  `${BACKGROUND_WORK[kind].subject} ended after storage answered: ${reason}`

/** The Output line when a Devin Desktop setup or removal ended but its setup lock was not released within 3 seconds ({@link DEVIN_SETUP_LOCK_RELEASE_MS}): the command answers, and this window's next setup or removal waits for the release. */
export const DEVIN_SETUP_LOCK_RELEASE_STALLED_LINE =
  "Codebook's Devin Desktop setup lock is still being released because storage does not answer; this window's next setup or removal waits for it."
