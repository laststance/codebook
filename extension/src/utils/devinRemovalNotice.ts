import type { CursorSkillRemovalStatus } from '../cursorSkillDeployment'
import {
  DevinMcpUnrecordedRemovalError,
  type DevinMcpRemovalResult,
} from '../devinMcpConfig'
import {
  devinStorageWaitSentence,
  type DevinStorageStep,
} from '../devinWindowSentences'

/** How the removal of Codebook's entry in Devin Desktop's MCP config ended ({@link removeManagedDevinMcpEntry}), or the refusal it threw; `isEntryRemoved` marks a refusal after the config already lost the entry. */
type DevinEntryRemoval =
  DevinMcpRemovalResult | { refusal: string; isEntryRemoved?: boolean }

/** What the steps of one Devin Desktop removal have ended with so far; only a step that ended is in it, so a notice shown while a later step waits never names a change that has not happened. */
export type DevinRemovalProgress = {
  skill?: CursorSkillRemovalStatus
  entry?: DevinEntryRemoval
}

/**
 * Turns what {@link removeManagedDevinMcpEntry} threw into the refusal {@link devinRemovalNotice} words, keeping the fact that the entry was already out of the config; called by the removal command of {@link activate}.
 * @param error - The thrown value.
 * @param describe - Words the thrown value as a sentence.
 * @returns The refusal, with `isEntryRemoved` after an {@link DevinMcpUnrecordedRemovalError}.
 * @example
 * devinEntryRemovalOf(new Error('x'), (error) => String(error)) // => { refusal: 'Error: x', isEntryRemoved: false }
 */
export function devinEntryRemovalOf(
  error: unknown,
  describe: (error: unknown) => string,
): { refusal: string; isEntryRemoved: boolean } {
  return {
    refusal: describe(error),
    isEntryRemoved: error instanceof DevinMcpUnrecordedRemovalError,
  }
}

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

/**
 * Words what became of the MCP entry: its sentence, then the sentence of a record or kept copy Codebook could not delete after the entry went; called by {@link devinRemovalNotice} and {@link devinRemovalPendingNotice}, so the warning a removal shows while a later step waits names that leftover too.
 * @param entryRemoval - How the entry's removal ended.
 * @returns The entry's sentence, and the cleanup sentence when there is one.
 * @example
 * entrySentences({ status: 'not-managed', path: '/home/user/.config/devin/mcp_config.json' })
 * // => ["/home/user/.config/devin/mcp_config.json holds no codebook entry of Codebook's, so it is unchanged."]
 */
function entrySentences(entryRemoval: DevinMcpRemovalResult): string[] {
  // A record Codebook could not delete after the entry went is named after the entry.
  const cleanupFailure =
    'cleanupFailure' in entryRemoval && entryRemoval.cleanupFailure
      ? [entryRemoval.cleanupFailure]
      : []
  return [
    ENTRY_SENTENCES[entryRemoval.status](entryRemoval.path),
    ...cleanupFailure,
  ]
}

/** Why a reload follows a removed entry: Devin Local keeps the MCP servers it started when the window loaded. */
const RELOAD_SENTENCE =
  "Reload this window so Devin Local stops Codebook's MCP server."

/** How the learner gets the setup back after a removal. */
const RESTORE_SENTENCE =
  'Codebook: Set Up AI Chat installs the skill and the entry again.'

/** How the learner gets the setup back when an edited entry stays: setup refuses an entry of its own until it is renamed or deleted. */
const RESTORE_AFTER_EDITED_ENTRY_SENTENCE =
  'Rename or delete that remaining codebook entry before you run Codebook: Set Up AI Chat, which refuses an entry it did not write.'

/**
 * Words the notice a learner reads when **Codebook: Remove Devin Desktop Setup** has removed or kept the skill: what became of the skill and of Codebook's entry in Devin Desktop's MCP config, and whether a reload is needed; called by the removal command of {@link activate}.
 * @param skillRemoval - How the removal ended for the skill ({@link CursorSkillRemovalStatus}).
 * @param entryRemoval - How the removal ended for the MCP entry, with the config's path, or the sentence its refusal threw.
 * @returns
 * - After a refusal of the entry: a warning that leads with the refusal, says what became of the skill and how to finish
 * - When neither a skill nor an entry of Codebook's was found: one information sentence that nothing changed
 * - After an edited entry that stays: an information notice that tells the learner to rename or delete that entry before setup runs again
 * - Otherwise: an information notice, which names a record Codebook could not delete and asks for a reload only after an entry or a file was removed
 * @example
 * devinRemovalNotice('removed', { status: 'removed', path: '/home/user/.config/devin/mcp_config.json' })
 * // => { severity: 'information', reload: true, text: "Codebook removed its Devin Desktop skill. Codebook removed its codebook entry from /home/user/.config/devin/mcp_config.json and kept the file's other entries. Reload this window so Devin Local stops Codebook's MCP server. Codebook: Set Up AI Chat installs the skill and the entry again." }
 */
export function devinRemovalNotice(
  skillRemoval: CursorSkillRemovalStatus,
  entryRemoval: DevinEntryRemoval,
): { severity: 'information' | 'warning'; text: string; reload: boolean } {
  // The entry is out but its record is not written: the refusal says so, and the loaded bridge still needs the reload.
  if ('refusal' in entryRemoval && entryRemoval.isEntryRemoved)
    return {
      severity: 'warning',
      text: `${entryRemoval.refusal} ${SKILL_SENTENCES[skillRemoval]} ${RELOAD_SENTENCE}`,
      reload: true,
    }
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
  // A record Codebook could not delete after the entry went does not change that the reload is needed.
  const reload =
    entryRemoval.status === 'removed' || entryRemoval.status === 'file-removed'
  const sentences = [
    SKILL_SENTENCES[skillRemoval],
    ...entrySentences(entryRemoval),
    ...(reload ? [RELOAD_SENTENCE] : []),
    // An edited entry stays, and setup would refuse it, so the way back starts with that entry.
    entryRemoval.status === 'changed'
      ? RESTORE_AFTER_EDITED_ENTRY_SENTENCE
      : RESTORE_SENTENCE,
  ]
  return { severity: 'information', text: sentences.join(' '), reload }
}

/**
 * Words the warning a learner reads when **Codebook: Remove Devin Desktop Setup** answers while one of its steps still waits on storage: what the steps that ended did (with a record or kept copy the entry step could not delete), then the step that waits; called by the removal command of {@link activate} once that step outlasted {@link DEVIN_SETUP_ROLLBACK_BUDGET_MS}, before {@link devinRemovalNotice} words the removal's end.
 * @param progress - What the steps that ended answered.
 * @param step - The step that waits on storage.
 * @returns A warning without a reload: the removal's own notice offers one once its steps ended.
 * @example
 * devinRemovalPendingNotice({ skill: 'removed' }, 'MCP entry')
 * // => { severity: 'warning', reload: false, text: "Codebook removed its Devin Desktop skill. Codebook's removal of the Devin Desktop setup is still waiting on storage (MCP entry) after 10 seconds; it finishes when storage answers and then shows its result. Until then Codebook: Set Up AI Chat and Codebook: Remove Devin Desktop Setup refuse in this window." }
 */
export function devinRemovalPendingNotice(
  progress: DevinRemovalProgress,
  step: DevinStorageStep,
): { severity: 'warning'; text: string; reload: false } {
  const { skill, entry } = progress
  const sentences = [
    // Only a step that ended is named; the skill step comes first.
    ...(skill === undefined ? [] : [SKILL_SENTENCES[skill]]),
    // An entry that was refused stays as it is, and the refusal says why; a removed entry's leftover record or copy is named after it.
    ...(entry === undefined
      ? []
      : 'refusal' in entry
        ? [entry.refusal]
        : entrySentences(entry)),
    devinStorageWaitSentence('removal', step),
  ]
  return { severity: 'warning', text: sentences.join(' '), reload: false }
}
