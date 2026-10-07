/**
 * Words the refusal for a file of the Cursor setup that exists and that this user could not open at that moment ({@link unopenedFileCode}); called by the skill's reader ({@link deployCursorSkill}, {@link verifyManagedCursorSkill}, {@link removeManagedCursorSkill}) and by the catalog's reads ({@link refreshCursorMcpCatalog}, {@link removeOwnedCursorMcpCatalog}).
 * Nothing is known of such a file, so the command stops there and decides nothing about it; once the file opens, the same command goes on.
 * @param subject - What the file is, as the sentence begins: "The Cursor MCP config", for example.
 * @param path - The file that could not be opened.
 * @param code - The system's code for the refused open (`EACCES`, `EPERM` or `EBUSY`).
 * @param commandToRunAgain - The command the learner ran (a reconnect names the setup), which the sentence names as the one to run again.
 * @returns The sentence.
 * @example
 * describeUnopenedFile('The Cursor MCP config', '/home/user/.cursor/mcp.json', 'EBUSY', 'Codebook: Set Up AI Chat')
 * // => 'The Cursor MCP config could not be opened: /home/user/.cursor/mcp.json (EBUSY). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run Codebook: Set Up AI Chat again.'
 */
export function describeUnopenedFile(
  subject: string,
  path: string,
  code: string,
  commandToRunAgain: string,
): string {
  return `${subject} could not be opened: ${path} (${code}). A program may hold the file for itself, or this user may not read it. Close the program that holds it, or allow this user to read it, then run ${commandToRunAgain} again.`
}
