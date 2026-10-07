import type { CursorSkillRemovalStatus } from '../cursorSkillDeployment'

import { thrownMessage } from './thrownMessage'

/** The removal command's title as the learner finds it in the command palette: {@link cursorCatalogCleanupNotice} names it as the next step, and the removal command of {@link activate} hands it to the Cursor MCP catalog ({@link captureOwnedCursorMcpCatalogGeneration}, {@link removeOwnedCursorMcpCatalog}), so that a refusal of one of the catalog's records names the same command and the warning leaves one next step. */
export const REMOVE_MANAGED_CURSOR_SKILL_COMMAND =
  'Codebook: Remove Managed Cursor Skill'

/** What the warning says of the skill, for each way its removal can end. */
const SKILL_CLAUSES: Record<CursorSkillRemovalStatus, string> = {
  removed: 'The managed Cursor skill itself was removed',
  'already-removed': 'The managed Cursor skill was already removed',
  'not-installed': 'No Codebook-owned Cursor skill was found',
}

/**
 * Words the warning a learner reads after "Codebook: Remove Managed Cursor Skill" could not retire Codebook's empty Cursor MCP config; called by the removal command of {@link activate} when {@link captureOwnedCursorMcpCatalogGeneration} or {@link removeOwnedCursorMcpCatalog} refuses.
 * The refusal's own sentence comes first: since Cycle 0046 it says what Codebook observed and what the learner does next. After it the notice says what is true of this removal, and no more: what became of the skill, that the config stays, that no file was deleted that Codebook could not verify as its own, and that the same command goes on with the config once the cause is gone.
 * @param refusal - What the catalog's first step (its generation) or its removal threw.
 * @param skillRemoval - How the removal ended for the skill ({@link CursorSkillRemovalStatus}): this removal took it away, an earlier one had, or Codebook knows no skill as its own.
 * @returns The notice's text; a refusal without a full stop at its end (a file system error) gets one.
 * @example
 * cursorCatalogCleanupNotice(new Error('Cursor MCP directory is not a regular directory; Codebook left its settings unchanged.'), 'removed')
 * // => 'Cursor MCP directory is not a regular directory; Codebook left its settings unchanged. The managed Cursor skill itself was removed; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run Codebook: Remove Managed Cursor Skill again: it goes on with the config.'
 */
export function cursorCatalogCleanupNotice(
  refusal: unknown,
  skillRemoval: CursorSkillRemovalStatus,
): string {
  const sentence = thrownMessage(refusal)
  return `${sentence}${sentence.endsWith('.') ? '' : '.'} ${SKILL_CLAUSES[skillRemoval]}; Codebook left the Cursor MCP config in place and deleted no unverified file. When the cause above is resolved, run ${REMOVE_MANAGED_CURSOR_SKILL_COMMAND} again: it goes on with the config.`
}
