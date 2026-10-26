/**
 * Writes a file path in the form two spellings of the same file share, so a watcher event is matched against the path Codebook computed even when the editor spells the drive letter or the case differently.
 *
 * Why: VS Code's `Uri.fsPath` lowercases the drive letter on Windows, and Windows and macOS disks are case-insensitive by default, so an exact string comparison drops real events.
 * Trigger: the LLM Wiki view's file watcher compares each event with its four watched files ({@link createLlmWikiView}).
 *
 * @param path - An absolute file path.
 * @param platform - The system whose paths these are; tests pass their own.
 * @returns Windows: lower case with `/` as separator; macOS: lower case; every other system: the path as it is.
 * @example
 * comparableFilePath('C:\\Repo\\.codebook\\wiki.update-run.json', 'win32') // => 'c:/repo/.codebook/wiki.update-run.json'
 * comparableFilePath('/Repo/a.json', 'linux')                              // => '/Repo/a.json'
 */
export function comparableFilePath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') return path.toLowerCase().replaceAll('\\', '/')
  if (platform === 'darwin') return path.toLowerCase()
  return path
}
