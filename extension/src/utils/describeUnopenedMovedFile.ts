/**
 * Words the refusal for a file that could not be opened while Codebook removed the second name it had given it; called by the recoveries of the Cursor skill ({@link deployCursorSkill}, {@link removeManagedCursorSkill}) and of the Cursor MCP catalog ({@link refreshCursorMcpCatalog}, {@link removeOwnedCursorMcpCatalog}) when {@link dropSecondNameOfOneFile} answers `unopened`.
 * Nothing is known of the two names then, so nothing was removed and the recovery record stays: the same command settles both names once the file opens. The sentence names both paths, because the file a program holds can stand under either.
 * @param subject - What the file is, as the sentence begins: "The Cursor skill", for example.
 * @param ownPath - The file's own path.
 * @param secondPath - The name Codebook had given the file (a displaced, a staged or a retained name).
 * @param commandToRunAgain - The command the learner ran, which the sentence names as the one to run again.
 * @returns The sentence.
 * @example
 * describeUnopenedMovedFile('The Cursor skill', '/home/user/.cursor/skills/codebook/SKILL.md', '/home/user/.cursor/skills/codebook/.codebook-displaced-1.tmp', 'Codebook: Set Up AI Chat')
 * // => 'The Cursor skill could not be opened, so Codebook left /home/user/.cursor/skills/codebook/SKILL.md and the name it had given the file, /home/user/.cursor/skills/codebook/.codebook-displaced-1.tmp, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.'
 */
export function describeUnopenedMovedFile(
  subject: string,
  ownPath: string,
  secondPath: string,
  commandToRunAgain: string,
): string {
  return `${subject} could not be opened, so Codebook left ${ownPath} and the name it had given the file, ${secondPath}, as they are. A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run ${commandToRunAgain} again.`
}
