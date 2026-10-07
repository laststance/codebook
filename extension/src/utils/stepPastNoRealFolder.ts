import type { Stats } from 'node:fs'

/** How a link is taken out of the way at a folder above the skill folder (`~/.cursor`, `~/.cursor/skills`): the folder it points to holds the learner's other settings and skills, so the sentence names the way that keeps them in Cursor first. A setup makes the folder itself where only the link is removed. */
export const PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK =
  "Put the folder it points to in the link's place, or remove the link"

/** How a link is taken out of the way at the skill folder itself (`~/.cursor/skills/codebook`): the folder it points to may be a skill of the learner's own, which a setup would refuse in the link's place, so the sentence names only the two ways after which the path is free. */
export const REMOVE_LINK_OR_RENAME_IT =
  'Remove the link or give it another name'

/**
 * Says what stands at a path of the Cursor setup that must be a real folder and is none, and what the learner does about it; the end of every such refusal of {@link deployCursorSkill}, {@link verifyManagedCursorSkill}, {@link removeManagedCursorSkill} and the Cursor MCP catalog ({@link refreshCursorMcpCatalog}), which name the path before it.
 * Codebook goes through no link and replaces nothing that is not a folder: both are the learner's, so each sentence says that they stay and how the path is freed, never to delete them.
 * @param status - What stands at the path, looked at without following a link; `undefined` for a path that holds nothing.
 * @param linkStep - How a link is taken out of the way there: {@link PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK} or {@link REMOVE_LINK_OR_RENAME_IT}.
 * @param commandToRunAgain - The command the learner ran (a reconnect names the setup), which the sentence names as the one to run again.
 * @returns
 * - Nothing at the path: that nothing stands there, and the command (a setup makes the folder, a removal has nothing left to remove below it)
 * - A link: that Codebook leaves what it points to as it is, the link's step and the command
 * - A file or anything else that is no folder: that it is the learner's to keep, to rename or move it, and the command
 * - A real folder: `undefined`, nothing is refused
 * @example
 * stepPastNoRealFolder(await lstat('/home/user/.cursor/skills'), PUT_FOLDER_IN_PLACE_OR_REMOVE_LINK, 'Codebook: Set Up AI Chat')
 * // => "That path is a link, and Codebook leaves what it points to as it is. Put the folder it points to in the link's place, or remove the link, then run Codebook: Set Up AI Chat again."
 * stepPastNoRealFolder(undefined, REMOVE_LINK_OR_RENAME_IT, 'Codebook: Remove Managed Cursor Skill')
 * // => 'Nothing stands at that path. Run Codebook: Remove Managed Cursor Skill again.'
 */
export function stepPastNoRealFolder(
  status: Pick<Stats, 'isDirectory' | 'isSymbolicLink'> | undefined,
  linkStep: string,
  commandToRunAgain: string,
): string | undefined {
  if (!status)
    return `Nothing stands at that path. Run ${commandToRunAgain} again.`
  // A link is told first: looked at without following, it is never a folder.
  if (status.isSymbolicLink())
    return `That path is a link, and Codebook leaves what it points to as it is. ${linkStep}, then run ${commandToRunAgain} again.`
  if (!status.isDirectory())
    return `What stands at that path is not a folder; it is yours to keep. Rename it or move it elsewhere, then run ${commandToRunAgain} again.`
  return undefined
}
