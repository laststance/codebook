import { thrownMessage } from './thrownMessage'

/**
 * Words the warning a learner reads after "Codebook: Remove Managed Cursor Skill" removed the skill and could not retire Codebook's empty Cursor MCP config; called by the removal command of {@link activate} when {@link removeOwnedCursorMcpCatalog} refuses.
 * The refusal's own sentence comes first: since Cycle 0046 it says what Codebook observed and what the learner does next. After it the notice says what is true of this removal, and no more: the skill is removed, the config stays, and no file was deleted that Codebook could not verify as its own.
 * @param refusal - What the catalog's removal threw.
 * @returns The notice's text; a refusal without a full stop at its end (a file system error) gets one.
 * @example
 * cursorCatalogCleanupNotice(new Error('Cursor MCP directory is not a regular directory; Codebook left its settings unchanged.'))
 * // => 'Cursor MCP directory is not a regular directory; Codebook left its settings unchanged. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file.'
 */
export function cursorCatalogCleanupNotice(refusal: unknown): string {
  const sentence = thrownMessage(refusal)
  return `${sentence}${sentence.endsWith('.') ? '' : '.'} The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file.`
}
