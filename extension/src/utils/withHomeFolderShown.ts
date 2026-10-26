import { posix, win32 } from 'node:path'

/** What may follow a home folder that ends there: a separator, the text's end, a space or quote or closing bracket, or a sentence's closing mark. */
const HOME_FOLDER_END = String.raw`(?=[\\/]|[\s'"\x60)\]}>,;:!?]|\.(?:\s|$)|$)`

/**
 * Shows the home folder as `~` in a text, so a sentence copied into an issue does not name the learner's account.
 *
 * Why: the attention sentence names paths below the home folder; replacing a home that is empty or a file-system root would corrupt every `/` of the text, and a plain substring match would turn `/Users/adam` into `~m` for the home `/Users/ada` and miss a Windows spelling of the same folder.
 * Trigger: Copy details in {@link registerLlmWikiCommands}.
 *
 * @param text - The sentence to copy.
 * @param homeDirectory - The learner's home folder; tests pass their own.
 * @param platform - The system whose paths these are; tests pass their own. On Windows the match ignores case and takes `/` or `\` for either separator.
 * @returns The text with every occurrence of the home folder as a whole path part replaced by `~`; the text itself when the home is empty or a root (`/`, `C:\`).
 * @example
 * withHomeFolderShown('Edited /Users/ada/repo/a.html', '/Users/ada') // => 'Edited ~/repo/a.html'
 * withHomeFolderShown('Edited /Users/adam/a.html', '/Users/ada')     // => 'Edited /Users/adam/a.html'
 * withHomeFolderShown('Edited c:/users/ADA/a.html', 'C:\\Users\\ada', 'win32') // => 'Edited ~/a.html'
 * withHomeFolderShown('Edited /repo/a.html', '/')                    // => 'Edited /repo/a.html'
 */
export function withHomeFolderShown(
  text: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const isWindows = platform === 'win32'
  // A root is its own parent; replacing it would rewrite every separator.
  if (
    homeDirectory === '' ||
    (isWindows ? win32 : posix).dirname(homeDirectory) === homeDirectory
  )
    return text
  const homeWithoutTrailingSeparator = homeDirectory.replace(/[\\/]+$/, '')
  const homePattern = homeWithoutTrailingSeparator
    .split(isWindows ? /[\\/]+/ : '/')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join(isWindows ? String.raw`[\\/]+` : '/')
  return text.replace(
    new RegExp(`${homePattern}${HOME_FOLDER_END}`, isWindows ? 'gi' : 'g'),
    '~',
  )
}
