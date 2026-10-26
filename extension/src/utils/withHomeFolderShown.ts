import { dirname } from 'node:path'

/**
 * Shows the home folder as `~` in a text, so a sentence copied into an issue does not name the learner's account.
 *
 * Why: the attention sentence names paths below the home folder; replacing a home that is empty or a file-system root would corrupt every `/` of the text.
 * Trigger: Copy details in {@link registerLlmWikiCommands}.
 *
 * @param text - The sentence to copy.
 * @param homeDirectory - The learner's home folder; tests pass their own.
 * @returns The text with every occurrence of the home folder replaced by `~`; the text itself when the home is empty or a root (`/`, `C:\`).
 * @example
 * withHomeFolderShown('Edited /Users/ada/repo/a.html', '/Users/ada') // => 'Edited ~/repo/a.html'
 * withHomeFolderShown('Edited /repo/a.html', '/')                    // => 'Edited /repo/a.html'
 */
export function withHomeFolderShown(
  text: string,
  homeDirectory: string,
): string {
  // A root is its own parent; replacing it would rewrite every separator.
  if (homeDirectory === '' || dirname(homeDirectory) === homeDirectory)
    return text
  return text.split(homeDirectory).join('~')
}
