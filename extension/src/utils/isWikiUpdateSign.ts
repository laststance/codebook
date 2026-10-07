import { WIKI_PUBLISH_STAGE_INFIX } from '../constants'

/** The publisher's script, which every update runs to prepare, render and publish; a command line that names it is a step of an update. */
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
 * Picks the rules by which two paths are compared; called by {@link isUpdateDocument}.
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

/**
 * Says whether a command line is a step of an update; called by {@link isWikiUpdateSign} for a command a terminal started.
 * @param commandLine - The command line as the terminal's shell integration reports it.
 * @param places - The Wiki's output folder and the bundled skill's folder.
 * @returns `true` when it names the publisher's script or the output folder's absolute path.
 * @example
 * isUpdateCommandLine('node /ext/skills/codebook/publish-wiki.mjs --prepare --project /repo --output /repo/.codebook/wiki', places) // => true
 * isUpdateCommandLine('pnpm test', places)                                                                                           // => false
 */
function isUpdateCommandLine(
  commandLine: string,
  places: WikiUpdatePlaces,
): boolean {
  return (
    commandLine.includes(PUBLISHER_SCRIPT_NAME) ||
    commandLine.includes(places.outputDirectory)
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
 * - A command line that names the publisher's script or the output folder: `true`
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
  return candidate.kind === 'command'
    ? isUpdateCommandLine(candidate.commandLine, places)
    : isUpdateDocument(candidate.path, places, pathRulesOf(platform))
}
