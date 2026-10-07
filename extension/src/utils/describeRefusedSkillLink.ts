/** What every refused link of the Cursor skill setup ends with: what the folder must allow, and the command to run again. A file system without hard links (exFAT, FAT, some network shares) refuses every such link. */
export const ALLOW_LINKS_THEN_SET_UP_AGAIN =
  'Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again.'

/**
 * Words the refusal of the hard link that puts Codebook's new Cursor skill in place; called by {@link deployCursorSkill} when the file system refuses that link, and by the README's test, which compares the README's quotation with it.
 * @param targetPath - The managed skill path.
 * @param code - The file system's code for the refused link (`EPERM` on Linux and `ENOTSUP` on macOS for a file system without hard links, for example).
 * @param keptPreviousSkillPath - Where Codebook's previous skill stands when an update had moved it away before the link; left out when nothing was moved.
 * @returns
 * - Nothing was moved: the sentence that no existing file was changed
 * - The previous skill was moved away: the sentence that names where it is kept and how to go on using it
 * Each ends with {@link ALLOW_LINKS_THEN_SET_UP_AGAIN}.
 * @example
 * describeRefusedSkillLink('/home/user/.cursor/skills/codebook/SKILL.md', 'EPERM')
 * // => "Cursor skill could not be installed: the file system refused to put Codebook's new file in place as /home/user/.cursor/skills/codebook/SKILL.md (EPERM). No existing file was changed. Check that this folder allows new files and hard links, then run Codebook: Set Up AI Chat again."
 */
export function describeRefusedSkillLink(
  targetPath: string,
  code: string,
  keptPreviousSkillPath?: string,
): string {
  const refused = `Cursor skill could not be installed: the file system refused to put Codebook's new file in place as ${targetPath} (${code}).`
  const state =
    keptPreviousSkillPath === undefined
      ? 'No existing file was changed.'
      : `Codebook's previous skill is kept as ${keptPreviousSkillPath}; move it back to ${targetPath} to go on using it.`
  return `${refused} ${state} ${ALLOW_LINKS_THEN_SET_UP_AGAIN}`
}
