/**
 * Words the refusal of the hard link that puts a file back at its own path after Codebook had moved it away and found it changed; handed to {@link dropSecondNameOfMovedFile} by the recoveries of the Cursor skill ({@link deployCursorSkill}, {@link removeManagedCursorSkill}) and of the Cursor MCP catalog ({@link removeOwnedCursorMcpCatalog}).
 * A file system without hard links refuses that link at every try, so the sentence names where the file is kept and the one step that needs no link: moving it back by hand.
 * @param subject - What the file is, as the sentence begins: "The Cursor skill", for example.
 * @param ownPath - The path the file was moved away from.
 * @param code - The file system's code for the refused link (`EPERM` on Linux and `ENOTSUP` on macOS for a file system without hard links, for example).
 * @param keptPath - The name the move gave the file, where it still stands.
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @returns The sentence.
 * @example
 * describeRefusedLinkBack('The Cursor skill', '/home/user/.cursor/skills/codebook/SKILL.md', 'EPERM', '/home/user/.cursor/skills/codebook/.codebook-displaced-1.tmp', 'Codebook: Set Up AI Chat')
 * // => 'The Cursor skill changed while Codebook had moved it away, and the file system refused to put it back as /home/user/.cursor/skills/codebook/SKILL.md (EPERM). The file is kept as /home/user/.cursor/skills/codebook/.codebook-displaced-1.tmp; move it back to /home/user/.cursor/skills/codebook/SKILL.md, then run Codebook: Set Up AI Chat again.'
 */
export function describeRefusedLinkBack(
  subject: string,
  ownPath: string,
  code: string,
  keptPath: string,
  commandToRunAgain: string,
): string {
  return `${subject} changed while Codebook had moved it away, and the file system refused to put it back as ${ownPath} (${code}). The file is kept as ${keptPath}; move it back to ${ownPath}, then run ${commandToRunAgain} again.`
}
