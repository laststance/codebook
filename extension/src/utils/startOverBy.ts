/** The command a refusal of the Cursor setup names as the one to run again unless its caller ran another: every setup, reconnect and refresh. */
export const SET_UP_AI_CHAT_COMMAND = 'Codebook: Set Up AI Chat'

/**
 * Says what the learner does about a recovery record of the Cursor setup that Codebook keeps because it can neither finish nor undo the step itself; the end of every refusal that leaves such a record, in {@link deployCursorSkill}, {@link removeManagedCursorSkill} and the Cursor MCP catalog ({@link refreshCursorMcpCatalog}), and the words the README quotes.
 * @param recordPath - The record in Codebook's storage (`pending.json` of a setup, `removal.json` of a removal, `pending-removal.json` of the catalog).
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again; {@link SET_UP_AI_CHAT_COMMAND} unless the caller says otherwise (the removal command hands its own name to the catalog, so that its warning names one next step).
 * @returns The sentence, with a space before it.
 * @example
 * startOverBy('/private/cursor-skill/pending.json')
 * // => ' To start over, delete /private/cursor-skill/pending.json, then run Codebook: Set Up AI Chat again.'
 * startOverBy('/private/cursor-mcp-catalog/receipt.json', 'Codebook: Remove Managed Cursor Skill')
 * // => ' To start over, delete /private/cursor-mcp-catalog/receipt.json, then run Codebook: Remove Managed Cursor Skill again.'
 */
export function startOverBy(
  recordPath: string,
  commandToRunAgain: string = SET_UP_AI_CHAT_COMMAND,
): string {
  return ` To start over, delete ${recordPath}, then run ${commandToRunAgain} again.`
}
