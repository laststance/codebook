/** What a journal record names in place of a saved-session folder's path. */
export const SAVED_PROFILE_PLACEHOLDER = '<saved-session>'

/**
 * Replaces every spelling of a saved-session folder in a text, so no journal record, error or Output line names where the learner's saved session lives.
 *
 * Why it exists: the folder's path holds the repository hash and the user's home, and Chrome's command line carries it as `--user-data-dir`. Called by {@link HostBrowser} for each journal record and error text of a run that opened a saved profile.
 * The folder is replaced as a whole (a path with a space stays one piece); a `--user-data-dir=` value that is left is cut to its switch, so a spelling the caller did not know (a `/private` prefix on macOS) does not survive either.
 * @param text - The text to clean.
 * @param folders - The folder's spellings: the lease's path and its real path.
 * @returns The text with the folder replaced by {@link SAVED_PROFILE_PLACEHOLDER}.
 * @example
 * hideSavedProfilePath('chrome --user-data-dir=/Users/a b/x/sign-in-profiles/9f2 --headless=new', ['/Users/a b/x/sign-in-profiles/9f2'])
 * // => 'chrome --user-data-dir=<saved-session> --headless=new'
 */
export function hideSavedProfilePath(
  text: string,
  folders: readonly string[],
): string {
  // Longest first, so a folder that contains another spelling is replaced whole.
  const ordered = folders
    .filter((folder) => folder.length > 0)
    .toSorted((a, b) => b.length - a.length)
  let hidden = text
  for (const folder of ordered)
    hidden = hidden.split(folder).join(SAVED_PROFILE_PLACEHOLDER)
  return hidden.replace(
    /(--?user-data-dir=)(?!<saved-session>)[^\s"']+/g,
    `$1${SAVED_PROFILE_PLACEHOLDER}`,
  )
}
