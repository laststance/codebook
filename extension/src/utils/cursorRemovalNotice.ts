import type { CursorCatalogCleanup } from './refreshCursorMcpCatalog'

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
 * @param wasSkillAlreadyRemoved - Whether an earlier removal had taken the skill away, so that this one only went on to the config (it could not retire the config then).
 * @param catalogCleanup - What became of the config ({@link CursorCatalogCleanup}); the notice calls a config preserved only where one stands at the path.
 * @returns The notice's text.
 * @example
 * cursorRemovalNotice(true, 'removed')
 * // => 'The managed Cursor skill was already removed; Codebook-owned empty MCP catalog config retired. Codebook: Restore Managed Cursor Skill can reinstall the bundled version.'
 */
export function cursorRemovalNotice(
  wasSkillAlreadyRemoved: boolean,
  catalogCleanup: CursorCatalogCleanup,
): string {
  const skill = wasSkillAlreadyRemoved
    ? 'The managed Cursor skill was already removed'
    : 'Managed Cursor skill removed'
  return `${skill}${CONFIG_CLAUSES[catalogCleanup]} Codebook: Restore Managed Cursor Skill can reinstall the bundled version.`
}
