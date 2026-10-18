import { WIKI_PUBLISH_STAGE_INFIX } from '../constants'

/** The file name of the publisher's script, which every update runs to prepare, render and publish. Only a command that runs the bundled script, `<skillDirectory>/publish-wiki.mjs`, as its program or as the script after Node.js, is a step of an update by it ({@link isUpdateCommandLine}); a command that only names the file is none. */
const PUBLISHER_SCRIPT_NAME = 'publish-wiki.mjs'

/** Something the editor reported while an update waited for the chat's first answer: a `file` document that was opened, by its path, or a command that started in a terminal, by its command line. */
export type WikiUpdateSignCandidate =
  { kind: 'document'; path: string } | { kind: 'command'; commandLine: string }

/** The places an update's own steps name: the Wiki's output folder and the folder of the bundled Codebook skill. */
export type WikiUpdatePlaces = {
  outputDirectory: string
  skillDirectory: string
}

/** How paths are compared on a platform: the separator between folder names, and the form in which two spellings of one path are equal. */
type PathRules = { separator: string; fold: (path: string) => string }

/**
 * Picks the rules by which two paths are compared; called by {@link isWikiUpdateSign} for {@link isUpdateDocument} and {@link isUpdateCommandLine}.
 *
 * Why: on Windows the editor reports a document's path with a lower-case drive letter (`c:\repo`) while the Wiki's folder is known by the spelling of the file system (`C:\repo`), and the file system does not tell case apart.
 *
 * @param platform - The platform Codebook runs on, as `process.platform` names it.
 * @returns For `win32` the backslash and lower-cased paths; otherwise the slash and paths as they are.
 * @example
 * pathRulesOf('win32').fold('C:\\Repo') // => 'c:\\repo'
 * pathRulesOf('linux').fold('/Repo')     // => '/Repo'
 */
function pathRulesOf(platform: string): PathRules {
  return platform === 'win32'
    ? { separator: '\\', fold: (path) => path.toLowerCase() }
    : { separator: '/', fold: (path) => path }
}

/**
 * Says whether a path lies in a folder or is the folder; called by {@link isUpdateDocument} for the output folder and the skill folder.
 * @param path - An absolute path, folded by the platform's rules.
 * @param folder - An absolute folder path without a trailing separator, folded the same way.
 * @param separator - The platform's separator.
 * @returns `true` for the folder itself and for everything below it; `false` for a sibling whose name only starts the same.
 * @example
 * isInside('/repo/.codebook/wiki/codebook-wiki.json', '/repo/.codebook/wiki', '/') // => true
 * isInside('/repo/.codebook/wiki-notes.md', '/repo/.codebook/wiki', '/')           // => false
 */
function isInside(path: string, folder: string, separator: string): boolean {
  return path === folder || path.startsWith(folder + separator)
}

/** A word of a command line as a POSIX shell splits it, or a run of the characters that end a command (`;`, `&`, `|`): a word joins quoted parts (`'…'` literally, `"…"` with its escapes), escaped characters and plain characters until a space or such an operator. */
const POSIX_WORD = /(?:'[^']*'|"(?:\\.|[^"\\])*"|\\.|[^\s'"\\;&|])+|[;&|]+/g
/** The same for the shells of Windows, where a backslash is a character of a path and no escape. */
const WINDOWS_WORD = /(?:'[^']*'|"[^"]*"|[^\s'";&|])+|[;&|]+/g
/** The quoted parts and the escaped characters of one word of a POSIX shell, as {@link unquotedWord} reads them. */
const POSIX_QUOTING = /'([^']*)'|"((?:\\.|[^"\\])*)"|\\(.)/g
/** The quoted parts of one word of the shells of Windows. */
const WINDOWS_QUOTING = /'([^']*)'|"([^"]*)"/g
/** An operator between two commands. */
const COMMAND_OPERATOR = /^[;&|]+$/
/** A program that is Node.js, however it is named: `node`, `node.exe`, or either with its folder. */
const NODE_PROGRAM = /(?:^|[\\/])node(?:\.exe)?$/i
/** An option of Node.js that runs no script: it checks the script's syntax, evaluates or prints code of its own, or shows the help or the version (`-c`, `--check`, `-e`, `--eval`, `-p`, `--print`, `-h`, `--help`, `-v`, `--version`), also with its value after `=` or in a cluster of short options (`-pe`). */
const NODE_OPTION_THAT_RUNS_NO_SCRIPT =
  /^(?:-[A-Za-z]*[cehpv][A-Za-z]*|--(?:check|eval|print|help|version)(?:=.*)?)$/

/**
 * Reads one word of a command line as its shell passes it on: without its quotes, and on POSIX with an escaped character as that character; called by {@link commandsOf}.
 * @param word - The word as the command line writes it.
 * @param platform - The platform whose shells the command line is read for.
 * @returns The word's text.
 * @example
 * unquotedWord('"/ext/skills/codebook/publish-wiki.mjs"', 'linux') // => '/ext/skills/codebook/publish-wiki.mjs'
 * unquotedWord('a\\ b', 'linux')                                   // => 'a b'
 */
function unquotedWord(word: string, platform: string): string {
  if (platform === 'win32')
    return word.replace(
      WINDOWS_QUOTING,
      (_part, single?: string, double?: string) => single ?? double ?? '',
    )
  return word.replace(
    POSIX_QUOTING,
    (_part, single?: string, double?: string, escaped?: string) =>
      single ?? double?.replace(/\\(["\\$`])/g, '$1') ?? escaped ?? '',
  )
}

/**
 * Splits a command line into its commands and each command into the words its shell passes on, by the boundaries of its arguments; called by {@link isUpdateCommandLine}.
 * Why: a path that merely stands inside another argument, in quoted text or at the start of a longer path (`/repo/.codebook/wiki-backup`) is no argument of its own.
 * @param commandLine - The command line as the terminal's shell integration reports it.
 * @param platform - The platform whose shells the command line is read for.
 * @returns The commands between the operators `;`, `&` and `|` (and `&&`, `||`), each as its words.
 * @example
 * commandsOf('cd /repo && node "/ext/publish-wiki.mjs" --output .codebook/wiki', 'linux')
 * // => [['cd', '/repo'], ['node', '/ext/publish-wiki.mjs', '--output', '.codebook/wiki']]
 */
function commandsOf(commandLine: string, platform: string): string[][] {
  const commands: string[][] = [[]]
  for (const [word] of commandLine.matchAll(
    platform === 'win32' ? WINDOWS_WORD : POSIX_WORD,
  )) {
    // An operator ends the command before it.
    if (COMMAND_OPERATOR.test(word)) commands.push([])
    else commands.at(-1)?.push(unquotedWord(word, platform))
  }
  return commands.filter((words) => words.length > 0)
}

/**
 * Picks the script a command runs: its program, or the first argument after Node.js that is no option; called by {@link isUpdateCommandLine}.
 * @param words - The command's words.
 * @returns The program, or the script when the program is Node.js; `undefined` for Node.js without a script.
 * @example
 * scriptOf(['node', '--no-warnings', '/ext/publish-wiki.mjs', '--prepare']) // => '/ext/publish-wiki.mjs'
 * scriptOf(['ls', '/repo'])                                                 // => 'ls'
 */
function scriptOf(words: string[]): string | undefined {
  const [program = ''] = words
  if (!NODE_PROGRAM.test(program)) return program
  return words.slice(1).find((word) => !word.startsWith('-'))
}

/**
 * Says whether a command is Node.js with an option before its script that runs no script ({@link NODE_OPTION_THAT_RUNS_NO_SCRIPT}); called by {@link isUpdateCommandLine}, for which such a command is no step of an update whatever it names.
 * @param words - The command's words.
 * @returns `true` for `node --check <script>` or `node -e <code> <script>`; `false` for another program, and for Node.js whose options before the script all run it.
 * @example
 * runsNoScript(['node', '--check', '/ext/publish-wiki.mjs'])        // => true
 * runsNoScript(['node', '--no-warnings', '/ext/publish-wiki.mjs'])  // => false
 */
function runsNoScript(words: string[]): boolean {
  const [program = '', ...rest] = words
  const scriptAt = rest.findIndex((word) => !word.startsWith('-'))
  // The options before the script; all words when there is none.
  const options = scriptAt === -1 ? rest : rest.slice(0, scriptAt)
  return (
    NODE_PROGRAM.test(program) &&
    options.some((option) => NODE_OPTION_THAT_RUNS_NO_SCRIPT.test(option))
  )
}

/**
 * Says whether a word of a command names a path, compared as the platform compares paths: folded, with the platform's separator and without a trailing separator; called by {@link isUpdateCommandLine}.
 * @param word - The word of the command.
 * @param path - The absolute path it is compared with.
 * @param rules - How paths are compared on this platform.
 * @returns `true` for the same path; `false` for another one, also for a longer path that only starts with it.
 * @example
 * namesPath('/repo/.codebook/wiki/', '/repo/.codebook/wiki', pathRulesOf('linux'))       // => true
 * namesPath('/repo/.codebook/wiki-backup', '/repo/.codebook/wiki', pathRulesOf('linux')) // => false
 */
function namesPath(word: string, path: string, rules: PathRules): boolean {
  const comparable = (written: string): string =>
    rules.fold(written.replace(/[\\/]+$/, '')).replaceAll('/', rules.separator)
  return comparable(word) === comparable(path)
}

/**
 * Says whether a command line is a step of an update, read by the boundaries of its arguments ({@link commandsOf}); called by {@link isWikiUpdateSign} for a command a terminal started.
 * @param commandLine - The command line as the terminal's shell integration reports it.
 * @param places - The Wiki's output folder and the bundled skill's folder.
 * @param rules - How paths are compared on this platform.
 * @param platform - The platform whose shells the command line is read for.
 * @returns `true` when one of its commands runs the bundled publisher (its path as the program, or as the script Node.js runs), or has the Wiki's output folder itself as an argument (the publisher's `--output` value, or a command that lists that folder); `false` when it names either only inside another argument, in quoted text, without its folder or in a longer path, or in a command of Node.js that runs no script ({@link runsNoScript}).
 * @example
 * isUpdateCommandLine('node /ext/skills/codebook/publish-wiki.mjs --prepare --project /repo --output /repo/.codebook/wiki', places, pathRulesOf('linux'), 'linux') // => true
 * isUpdateCommandLine('ls /repo/.codebook/wiki-backup', places, pathRulesOf('linux'), 'linux')                                                                    // => false
 */
function isUpdateCommandLine(
  commandLine: string,
  places: WikiUpdatePlaces,
  rules: PathRules,
  platform: string,
): boolean {
  const publisher =
    places.skillDirectory + rules.separator + PUBLISHER_SCRIPT_NAME
  return commandsOf(commandLine, platform).some(
    (words) =>
      !runsNoScript(words) &&
      (namesPath(scriptOf(words) ?? '', publisher, rules) ||
        words.some((word) => namesPath(word, places.outputDirectory, rules))),
  )
}

/**
 * Says whether an opened file is one an update's steps name; called by {@link isWikiUpdateSign} for a `file` document.
 * @param path - The document's absolute path.
 * @param places - The Wiki's output folder and the bundled skill's folder.
 * @param rules - How paths are compared on this platform.
 * @returns `true` for a file in the output folder, in a folder the publisher prepared beside it (`<output>.stage-…`) or in the skill's folder.
 * @example
 * isUpdateDocument('/repo/.codebook/wiki.stage-3f6c/codebook-wiki.json', places, pathRulesOf('linux')) // => true
 * isUpdateDocument('/repo/src/a.ts', places, pathRulesOf('linux'))                                    // => false
 */
function isUpdateDocument(
  path: string,
  places: WikiUpdatePlaces,
  rules: PathRules,
): boolean {
  const document = rules.fold(path)
  const output = rules.fold(places.outputDirectory)
  return (
    isInside(document, output, rules.separator) ||
    document.startsWith(output + WIKI_PUBLISH_STAGE_INFIX) ||
    isInside(document, rules.fold(places.skillDirectory), rules.separator)
  )
}

/**
 * Says whether something the editor reported belongs to the Wiki update that waits for the chat's first answer, so that the learner's own work in the window (a file they open, a command they run) is not taken for the chat's.
 *
 * Why: the editor's events are those of the whole window. Only what an update's own steps name counts: the request tells the chat to read the Wiki's manifest and the installed Codebook skill, and the skill has it prepare a folder beside the Wiki (`<output>.stage-…`) and run the publisher's script. A learner does not open a file of the generated Wiki, of a prepared folder or of the extension's skill folder, nor run the publisher, in the half minute after they pressed Update. A terminal that merely opens names nothing and does not count.
 * Trigger: the extension calls it for every opened `file` document and every command a terminal starts while {@link startWikiChatUpdate} waits.
 *
 * @param candidate - What the editor reported.
 * @param places - The Wiki's output folder and the bundled skill's folder, both absolute.
 * @param platform - The platform whose rules compare the paths; the one Codebook runs on when omitted.
 * @returns
 * - A document in the output folder, in a prepared folder beside it or in the skill's folder: `true`
 * - A command line that runs the bundled publisher or has the output folder itself as an argument, read by the boundaries of its arguments: `true`
 * - Anything else: `false`
 * @example
 * isWikiUpdateSign({ kind: 'document', path: '/repo/.codebook/wiki/codebook-wiki.json' }, places) // => true
 * isWikiUpdateSign({ kind: 'document', path: '/repo/src/a.ts' }, places)                         // => false
 * isWikiUpdateSign({ kind: 'command', commandLine: 'pnpm test' }, places)                        // => false
 */
export function isWikiUpdateSign(
  candidate: WikiUpdateSignCandidate,
  places: WikiUpdatePlaces,
  platform: string = process.platform,
): boolean {
  const rules = pathRulesOf(platform)
  return candidate.kind === 'command'
    ? isUpdateCommandLine(candidate.commandLine, places, rules, platform)
    : isUpdateDocument(candidate.path, places, rules)
}
