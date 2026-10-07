/**
 * Says what the learner does about a recovery record of the Cursor setup that Codebook keeps because it can neither finish nor undo the step itself; the end of every refusal that leaves such a record, in {@link deployCursorSkill}, {@link removeManagedCursorSkill} and the Cursor MCP catalog ({@link refreshCursorMcpCatalog}), and the words the README quotes.
 * @param recordPath - The record in Codebook's storage (`pending.json` of a setup, `removal.json` of a removal, `pending-removal.json` of the catalog).
 * @returns The sentence, with a space before it.
 * @example startOverBy('/private/cursor-skill/pending.json') // => ' To start over, delete /private/cursor-skill/pending.json, then run Codebook: Set Up AI Chat again.'
 */
export function startOverBy(recordPath: string): string {
  return ` To start over, delete ${recordPath}, then run Codebook: Set Up AI Chat again.`
}
