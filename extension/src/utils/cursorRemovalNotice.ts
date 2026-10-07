import type { CursorCatalogCleanup } from './refreshCursorMcpCatalog'

/**
 * Words the notice a learner reads when "Codebook: Remove Managed Cursor Skill" ended without a refusal: what became of the skill, and what became of the Cursor MCP config and why; called by the removal command of {@link activate}.
 * @param wasSkillAlreadyRemoved - Whether an earlier removal had taken the skill away, so that this one only went on to the config (it could not retire the config then).
 * @param catalogCleanup - What the catalog's removal answered: `removed` for the empty config Codebook created, anything else for a config that is not that file (it existed before, or was changed).
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
  const config =
    catalogCleanup === 'removed'
      ? '; Codebook-owned empty MCP catalog config retired.'
      : '. Existing or changed Cursor MCP config preserved.'
  return `${skill}${config} Codebook: Restore Managed Cursor Skill can reinstall the bundled version.`
}
