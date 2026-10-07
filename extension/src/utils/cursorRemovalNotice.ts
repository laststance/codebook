import type { CursorSkillRemovalStatus } from '../cursorSkillDeployment'

import type { CursorCatalogCleanup } from './refreshCursorMcpCatalog'

/** What the notice says of the skill, for each way its removal can end. */
const SKILL_CLAUSES: Record<CursorSkillRemovalStatus, string> = {
  removed: 'Managed Cursor skill removed',
  'already-removed': 'The managed Cursor skill was already removed',
  'not-installed': 'No Codebook-owned Cursor skill was found',
}

/** What a learner reads who runs the removal where nothing of Codebook's is: no skill it knows as its own, and no Cursor MCP config it owns. */
const NOTHING_TO_REMOVE_NOTICE =
  'Nothing to remove: no Codebook-owned Cursor skill was found and Codebook owns no Cursor MCP config. No file was changed.'

/** What the notice says of the Cursor MCP config, after what it says of the skill, for each way the config's cleanup can end. */
const CONFIG_CLAUSES: Record<CursorCatalogCleanup, string> = {
  removed: '; Codebook-owned empty MCP catalog config retired.',
  preserved: '. Existing or changed Cursor MCP config preserved.',
  'already-retired':
    ". Codebook's empty Cursor MCP config was already retired; no config was changed.",
  'not-owned': '. Codebook owns no Cursor MCP config; none was changed.',
}

/**
 * Words the notice a learner reads when "Codebook: Remove Managed Cursor Skill" ended without a refusal: what became of the skill, and what became of the Cursor MCP config and why; called by the removal command of {@link activate}.
 * @param skillRemoval - How the removal ended for the skill ({@link CursorSkillRemovalStatus}).
 * @param catalogCleanup - What became of the config ({@link CursorCatalogCleanup}); the notice calls a config preserved only where one stands at the path.
 * @returns The notice's text; {@link NOTHING_TO_REMOVE_NOTICE} where neither a skill nor a config of Codebook's was found.
 * @example
 * cursorRemovalNotice('already-removed', 'removed')
 * // => 'The managed Cursor skill was already removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.'
 */
export function cursorRemovalNotice(
  skillRemoval: CursorSkillRemovalStatus,
  catalogCleanup: CursorCatalogCleanup,
): string {
  if (skillRemoval === 'not-installed' && catalogCleanup === 'not-owned')
    return NOTHING_TO_REMOVE_NOTICE
  return `${SKILL_CLAUSES[skillRemoval]}${CONFIG_CLAUSES[catalogCleanup]} Codebook: Restore Managed Cursor Skill can reinstall the bundled version.`
}
