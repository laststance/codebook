import type { CursorSkillRemovalStatus } from '../cursorSkillDeployment'
import type { DevinMcpRemovalResult } from '../devinMcpConfig'

/** How the removal of Codebook's entry in Devin Desktop's MCP config ended ({@link removeManagedDevinMcpEntry}), or the refusal it threw. */
type DevinEntryRemoval = DevinMcpRemovalResult | { refusal: string }

/** What the notice says of the skill, for each way its removal can end. */
const SKILL_SENTENCES: Record<CursorSkillRemovalStatus, string> = {
  removed: 'Codebook removed its Devin Desktop skill.',
  'already-removed': "Codebook's Devin Desktop skill was already removed.",
  'not-installed': 'No Codebook-owned Devin Desktop skill was found.',
}

/** What the notice says of the MCP config at `path`, after what it says of the skill, for each way the entry's removal can end. */
const ENTRY_SENTENCES: Record<
  DevinMcpRemovalResult['status'],
  (path: string) => string
> = {
  removed: (path) =>
    `Codebook removed its codebook entry from ${path} and kept the file's other entries.`,
  'file-removed': (path) =>
    `Codebook removed ${path}, which it had created and which held nothing else.`,
  'not-managed': (path) =>
    `${path} holds no codebook entry of Codebook's, so it is unchanged.`,
  changed: (path) =>
    `The codebook entry in ${path} was edited after setup, so Codebook left it in place; remove it by hand if you no longer want it.`,
  superseded: (path) =>
    `The codebook entry in ${path} belongs to a newer setup, so Codebook left it in place.`,
}

/** Why a reload follows a removed entry: Devin Local keeps the MCP servers it started when the window loaded. */
const RELOAD_SENTENCE =
  "Reload this window so Devin Local stops Codebook's MCP server."

/** How the learner gets the setup back after a removal. */
const RESTORE_SENTENCE =
  'Codebook: Set Up AI Chat installs the skill and the entry again.'

/**
 * Words the notice a learner reads when **Codebook: Remove Devin Desktop Setup** has removed or kept the skill: what became of the skill and of Codebook's entry in Devin Desktop's MCP config, and whether a reload is needed; called by the removal command of {@link activate}.
 * @param skillRemoval - How the removal ended for the skill ({@link CursorSkillRemovalStatus}).
 * @param entryRemoval - How the removal ended for the MCP entry, with the config's path, or the sentence its refusal threw.
 * @returns
 * - After a refusal of the entry: a warning that leads with the refusal, says what became of the skill and how to finish
 * - When neither a skill nor an entry of Codebook's was found: one information sentence that nothing changed
 * - Otherwise: an information notice, which names a record Codebook could not delete and asks for a reload only after an entry or a file was removed
 * @example
 * devinRemovalNotice('removed', { status: 'removed', path: '/home/user/.config/devin/mcp_config.json' })
 * // => { severity: 'information', reload: true, text: "Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from /home/user/.config/devin/mcp_config.json and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again." }
 */
export function devinRemovalNotice(
  skillRemoval: CursorSkillRemovalStatus,
  entryRemoval: DevinEntryRemoval,
): { severity: 'information' | 'warning'; text: string; reload: boolean } {
  // A refused entry stays as it is; the warning says so first and names the command that finishes the removal.
  if ('refusal' in entryRemoval)
    return {
      severity: 'warning',
      text: `${entryRemoval.refusal} ${SKILL_SENTENCES[skillRemoval]} When the cause above is resolved, run Codebook: Remove Devin Desktop Setup again: it goes on with the entry.`,
      reload: false,
    }
  // Nothing of Codebook's anywhere: the notice says so in one sentence and changes nothing.
  if (skillRemoval === 'not-installed' && entryRemoval.status === 'not-managed')
    return {
      severity: 'information',
      text: `Nothing to remove: no Codebook-owned Devin Desktop skill was found and ${entryRemoval.path} holds no codebook entry of Codebook's. No file was changed.`,
      reload: false,
    }
  const reload =
    entryRemoval.status === 'removed' || entryRemoval.status === 'file-removed'
  // A record Codebook could not delete after the entry went is named after the entry; the reload is still needed.
  const cleanupFailure =
    'cleanupFailure' in entryRemoval && entryRemoval.cleanupFailure
      ? [entryRemoval.cleanupFailure]
      : []
  const sentences = [
    SKILL_SENTENCES[skillRemoval],
    ENTRY_SENTENCES[entryRemoval.status](entryRemoval.path),
    ...cleanupFailure,
    ...(reload ? [RELOAD_SENTENCE] : []),
    RESTORE_SENTENCE,
  ]
  return { severity: 'information', text: sentences.join(' '), reload }
}
