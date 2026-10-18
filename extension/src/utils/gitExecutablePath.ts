import { posix, win32 } from 'node:path'

import {
  environmentVariable,
  type ProcessEnvironment,
} from './environmentVariable'
import { isProgramFile } from './isProgramFile'

/** What {@link gitExecutablePath} looks with; each is the real one unless a test names its own. */
export type GitLookupInputs = {
  /** The system whose rules apply: `process.platform` in the product. */
  platform?: NodeJS.Platform
  /** Where `PATH` (and on Windows `PATHEXT`) are read: `process.env` in the product. */
  environment?: ProcessEnvironment
  /** Says whether a path is a program file this user may start: {@link isProgramFile} in the product. */
  isProgramFile?: (path: string) => Promise<boolean>
}

/** The program extensions Windows tries when `PATHEXT` is not set. */
const DEFAULT_WINDOWS_PROGRAM_EXTENSIONS = '.COM;.EXE;.BAT;.CMD'

/** The extensions of a program Node.js starts without a shell on Windows; a batch file (`.bat`, `.cmd`) needs one and is never taken. */
const EXTENSIONS_STARTED_WITHOUT_SHELL = new Set(['.com', '.exe'])

/** A Windows folder named from a drive's root (`C:\…`) or on a network share (`\\server\share\…`); a folder rooted on the current drive (`\bin`) or a relative one is none. */
const WINDOWS_ABSOLUTE_FOLDER = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/

/** The Git found with the product's own inputs; kept once found, so a later call starts no search. */
let gitFound: string | undefined

/**
 * Lists the folders of `PATH` that a search may look in: only absolute ones; called by {@link gitExecutablePath}.
 * An empty entry means the current folder on macOS and Linux, and a relative entry is read from the current folder, which for Codebook's Git commands is the learner's opened project; neither is ever looked in.
 * @param pathText - The value of `PATH`.
 * @param platform - The system whose separators and rules apply.
 * @returns The absolute folders, in `PATH`'s order, a Windows entry's quotes removed.
 * @example
 * searchedFolders('.:/usr/local/bin::/usr/bin', 'linux') // => ['/usr/local/bin', '/usr/bin']
 */
function searchedFolders(
  pathText: string,
  platform: NodeJS.Platform,
): string[] {
  if (platform !== 'win32')
    return pathText
      .split(':')
      .filter((entry) => entry !== '' && posix.isAbsolute(entry))
  return (
    pathText
      .split(';')
      // Windows allows a folder in quotes in PATH.
      .map((entry) => entry.replace(/^"(.*)"$/, '$1'))
      .filter((entry) => WINDOWS_ABSOLUTE_FOLDER.test(entry))
  )
}

/**
 * Names the files a folder of `PATH` may hold Git as; called by {@link gitExecutablePath} for each searched folder.
 * @param folder - An absolute folder.
 * @param platform - The system whose rules apply.
 * @param programExtensions - On Windows, the value of `PATHEXT`.
 * @returns `<folder>/git` on macOS and Linux; on Windows `<folder>\git<ext>` for each extension of `PATHEXT` in its order that Node.js starts without a shell.
 * @example
 * candidatesIn('C:\\Program Files\\Git\\cmd', 'win32', '.COM;.EXE;.BAT') // => ['C:\\Program Files\\Git\\cmd\\git.com', 'C:\\Program Files\\Git\\cmd\\git.exe']
 */
function candidatesIn(
  folder: string,
  platform: NodeJS.Platform,
  programExtensions: string,
): string[] {
  if (platform !== 'win32') return [posix.join(folder, 'git')]
  return programExtensions
    .split(';')
    .map((extension) => extension.toLowerCase())
    .filter((extension) => EXTENSIONS_STARTED_WITHOUT_SHELL.has(extension))
    .map((extension) => win32.join(folder, `git${extension}`))
}

/**
 * Builds the answer for a Git that no folder of `PATH` holds, the same error Node.js gives when it cannot start `git`, so every caller answers as it did for a missing Git; called by {@link gitExecutablePath}.
 * @returns An error with code `ENOENT` and the message `spawn git ENOENT`.
 * @example
 * missingGit().message // => 'spawn git ENOENT'
 */
function missingGit(): Error {
  return Object.assign(new Error('spawn git ENOENT'), {
    code: 'ENOENT',
    errno: -2,
    syscall: 'spawn git',
    path: 'git',
  })
}

/**
 * Lists every path Git may lie at, in `PATH`'s order, from the absolute folders of `PATH` alone; called by {@link gitExecutablePath}, which asks for each in turn whether it is a program file.
 * @param platform - The system whose rules apply.
 * @param environment - Where `PATH` and, on Windows, `PATHEXT` are read.
 * @returns The candidates of each searched folder ({@link searchedFolders}, {@link candidatesIn}); empty when `PATH` holds no absolute folder.
 * @example
 * gitCandidates('linux', { PATH: '.:/usr/local/bin:/usr/bin' }) // => ['/usr/local/bin/git', '/usr/bin/git']
 */
function gitCandidates(
  platform: NodeJS.Platform,
  environment: ProcessEnvironment,
): string[] {
  const pathText = environmentVariable(environment, 'PATH', platform) ?? ''
  const programExtensions =
    environmentVariable(environment, 'PATHEXT', platform) ??
    DEFAULT_WINDOWS_PROGRAM_EXTENSIONS
  return searchedFolders(pathText, platform).flatMap((folder) =>
    candidatesIn(folder, platform, programExtensions),
  )
}

/**
 * Finds Git by an absolute path from a search of `PATH` alone, never in the learner's project nor in the process's current folder, so a repository that carries a program named git can never be started in Git's place; called by {@link inspectDeepWikiFreshness} and {@link RepositorySourceService} before every Git command they run in the opened project.
 * Why: a bare name is looked up in the spawn's current folder before `PATH` on Windows (libuv's `search_path`), and Codebook runs Git with the opened project as that folder, so a `git.exe` or `git.com` at a cloned repository's root would run with the learner's rights. macOS and Linux do not look there for a bare name, but take the same absolute path for one rule. Only absolute `PATH` folders are searched (an empty or relative entry is read from the current folder); on Windows each `PATHEXT` extension that Node.js starts without a shell is tried in its order.
 * A Git found with the product's own inputs is kept for the process, so it is searched for once.
 * @param inputs - The platform, the environment and the program check of {@link GitLookupInputs}; the real ones when left out.
 * @returns The absolute path of the first Git in `PATH`'s order.
 * @throws When no searched folder holds Git: the error Node.js gives for a program it cannot start (`ENOENT`, `spawn git ENOENT`), so every caller answers "no Git" as before.
 * @example
 * await gitExecutablePath() // => '/usr/bin/git'
 * await gitExecutablePath({ platform: 'win32', environment: { Path: 'C:\\Program Files\\Git\\cmd', PATHEXT: '.COM;.EXE' } }) // => 'C:\\Program Files\\Git\\cmd\\git.exe'
 */
export async function gitExecutablePath(
  inputs?: GitLookupInputs,
): Promise<string> {
  // The product's own lookup is made once; a test's inputs are looked up each time.
  if (inputs === undefined && gitFound !== undefined) return gitFound
  const isProgram = inputs?.isProgramFile ?? isProgramFile
  const candidates = gitCandidates(
    inputs?.platform ?? process.platform,
    inputs?.environment ?? process.env,
  )
  // One candidate at a time, in PATH's order: the first program file is Git.
  for (const candidate of candidates)
    if (await isProgram(candidate)) {
      if (inputs === undefined) gitFound = candidate
      return candidate
    }
  throw missingGit()
}
