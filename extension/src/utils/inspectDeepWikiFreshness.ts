import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import {
  WIKI_FRESHNESS_HASH_CONCURRENCY,
  WIKI_GIT_OUTPUT_LIMIT_BYTES,
  WIKI_GIT_TIMEOUT_MS,
} from '../constants'

import type { WikiIncludedSource } from './answerDeepWikiQuestion'
import { hashFileSha256 } from './hashFileSha256'
import { isWikiSourceCandidate } from './isWikiSourceCandidate'
import { mapWithConcurrencyLimit } from './mapWithConcurrencyLimit'

const runGit = promisify(execFile)

/** Why a freshness check could not decide: an indexed source it could not compare, a manifest without a usable Git revision, or a Git check that did not run to its end. */
export type WikiFreshnessUnknownCause =
  | 'unchecked-source'
  | 'no-revision'
  | 'git-missing'
  | 'git-timeout'
  | 'git-output-limit'
  | 'git-failed'

export type WikiFreshness = {
  status: 'current' | 'changed' | 'unknown'
  changedPaths: string[]
  addedPaths: string[]
  reason?: string
  /** First indexed source that could not be compared (a manifest entry without a usable path or hash, a path outside the project, a file that cannot be read or is not a regular file); set only for `unknown`. */
  uncheckedPath?: string
  /** What kept the check from deciding, so the caller can name a remedy that fits; set only for `unknown`. */
  unknownCause?: WikiFreshnessUnknownCause
  /** Set when the project has no Git repository: files added since the generation could not be looked for, and `current` covers the indexed sources only. */
  addedFilesUnchecked?: true
}

/** The causes that stop the look for added files, as opposed to an indexed source that could not be compared. */
type AdditionCheckFailure = Exclude<
  WikiFreshnessUnknownCause,
  'unchecked-source'
>

/** What looking for source files added since the generation gave: the uncovered ones, no repository to ask, or the cause that stopped Git. */
type AdditionCheck =
  | { kind: 'checked'; addedPaths: string[] }
  | { kind: 'no-repository' }
  | { kind: 'unverified'; cause: AdditionCheckFailure }

/** The sentence each cause of an undecided check is reported with. */
const UNKNOWN_REASONS: Record<AdditionCheckFailure, string> = {
  'no-revision':
    'Added source files could not be checked against the generated revision.',
  'git-missing':
    'Git is not installed, so added source files could not be checked.',
  'git-timeout':
    'Git did not answer in time, so added source files could not be checked.',
  'git-output-limit':
    'Git listed more files than Codebook reads, so added source files could not be checked.',
  'git-failed': 'Git could not list the added source files.',
}

/**
 * Names the failure of a Git command that never ran to its end by the error's code; called by {@link gitFailureCause} first.
 * @param error - What the Git command threw.
 * @returns
 * - `git-missing` when the binary was not found (`ENOENT`)
 * - `git-output-limit` when Git listed more than the output bound
 * - `undefined` for an error without a code and for any other code
 * @example
 * causeOfGitErrorCode({ code: 'ENOENT' }) // => 'git-missing'
 * causeOfGitErrorCode({ code: 128 })      // => undefined
 */
function causeOfGitErrorCode(
  error: object,
):
  | Extract<AdditionCheckFailure, 'git-missing' | 'git-output-limit'>
  | undefined {
  const code = 'code' in error ? error.code : undefined
  if (code === 'ENOENT') return 'git-missing'
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'git-output-limit'
  return undefined
}

/**
 * Says whether Git's own words name a folder that is in no repository; called by {@link causeOfEndedGit}.
 * @param error - What the Git command threw.
 * @returns Whether the error carries Git's error output and that output says "not a git repository".
 * @example
 * saysNotARepository({ stderr: 'fatal: not a git repository (or any of the parent directories): .git' }) // => true
 * saysNotARepository({ stderr: 'fatal: bad object 0f9e8d7c' })                                           // => false
 */
function saysNotARepository(error: object): boolean {
  return (
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    /not a git repository/i.test(error.stderr)
  )
}

/**
 * Names the failure of a Git command whose error code tells nothing; called by {@link gitFailureCause} after {@link causeOfGitErrorCode}.
 * @param error - What the Git command threw.
 * @returns
 * - `git-timeout` when the process was killed at the time bound
 * - `no-repository` when Git says the folder is in no repository
 * - `git-failed` for anything else
 * @example
 * causeOfEndedGit({ killed: true }) // => 'git-timeout'
 * causeOfEndedGit({ code: 128 })    // => 'git-failed'
 */
function causeOfEndedGit(
  error: object,
):
  | Extract<AdditionCheckFailure, 'git-timeout' | 'git-failed'>
  | 'no-repository' {
  if ('killed' in error && error.killed === true) return 'git-timeout'
  if (saysNotARepository(error)) return 'no-repository'
  return 'git-failed'
}

/**
 * Names why a Git command failed: the binary is missing, the time or output bound was hit, the folder is in no repository, or anything else; called by {@link repositoryFailure} and {@link listingFailure}.
 * @param error - What the Git command threw.
 * @returns The cause; `git-failed` for a thrown value that is no object.
 * @example
 * gitFailureCause({ code: 'ENOENT' }) // => 'git-missing'
 * gitFailureCause('boom')             // => 'git-failed'
 */
function gitFailureCause(
  error: unknown,
): AdditionCheckFailure | 'no-repository' {
  if (typeof error !== 'object' || error === null) return 'git-failed'
  return causeOfGitErrorCode(error) ?? causeOfEndedGit(error)
}

/**
 * Turns the failure of the question "is this folder in a repository" into the check's answer; called by {@link findAddedSources} when `git rev-parse` fails.
 * @param error - What the Git command threw.
 * @returns
 * - `no-repository` when Git says so: there is nothing to ask for added files
 * - `unverified` with the cause otherwise
 * @example
 * repositoryFailure({ code: 'ENOENT' }) // => { kind: 'unverified', cause: 'git-missing' }
 */
function repositoryFailure(error: unknown): AdditionCheck {
  const cause = gitFailureCause(error)
  return cause === 'no-repository'
    ? { kind: 'no-repository' }
    : { kind: 'unverified', cause }
}

/**
 * Turns the failure of listing the added files into the check's answer; called by {@link findAddedSources} when a listing command fails or its answer cannot be read.
 * @param error - What was thrown.
 * @returns `unverified` with the cause; the repository answered a moment ago, so "no repository" now is reported as `git-failed`.
 * @example
 * listingFailure({ killed: true }) // => { kind: 'unverified', cause: 'git-timeout' }
 */
function listingFailure(error: unknown): AdditionCheck {
  const cause = gitFailureCause(error)
  // The repository answered a moment ago, so a refusal now is about the revision or the command.
  return {
    kind: 'unverified',
    cause: cause === 'no-repository' ? 'git-failed' : cause,
  }
}

/**
 * Keeps a generated revision only when it is a full commit hash; called by {@link findAddedSources} before the revision is given to Git.
 * @param generatedRevision - The revision the manifest records, if any.
 * @returns The revision when it is 40 to 64 hexadecimal digits, `undefined` otherwise (none, empty, a short hash, a branch name).
 * @example
 * fullCommitHash('0f9e8d7c6b5a49382716051a2b3c4d5e6f708192') // => '0f9e8d7c6b5a49382716051a2b3c4d5e6f708192'
 * fullCommitHash('main')                                     // => undefined
 */
function fullCommitHash(
  generatedRevision: string | undefined,
): string | undefined {
  return generatedRevision && /^[a-f0-9]{40,64}$/i.test(generatedRevision)
    ? generatedRevision
    : undefined
}

/**
 * Picks, from the paths Git listed, the source files the Wiki neither indexes nor excludes; called by {@link findAddedSources} with the answers of both listing commands.
 * @param committedListing - Git's NUL-separated answer for the files committed since the generated revision.
 * @param untrackedListing - Git's NUL-separated answer for the untracked files.
 * @param projectRoot - Canonical opened folder, which the listed paths are relative to.
 * @param includedSources - The sources the Wiki indexes.
 * @param excludedPaths - Manifest exclusions.
 * @param outputDirectory - Resolved Wiki output folder, whose own files are no added source; `undefined` when the caller named none.
 * @returns The uncovered paths, each once, sorted.
 * @example
 * uncoveredAddedPaths('src/new.ts\0', '', '/repo', [], [], '/repo/.codebook/wiki') // => ['src/new.ts']
 */
function uncoveredAddedPaths(
  committedListing: string,
  untrackedListing: string,
  projectRoot: string,
  includedSources: WikiIncludedSource[],
  excludedPaths: string[],
  outputDirectory: string | undefined,
): string[] {
  const indexedPaths = new Set(includedSources.map((source) => source.path))
  const outputPath =
    outputDirectory === undefined
      ? ''
      : relative(projectRoot, outputDirectory).split(sep).join('/')
  return [
    ...new Set([
      ...committedListing.split('\0'),
      ...untrackedListing.split('\0'),
    ]),
  ]
    .filter(
      (path) =>
        path &&
        !indexedPaths.has(path) &&
        isWikiSourceCandidate(path, outputPath, excludedPaths),
    )
    .sort()
}

/**
 * Looks for source files added since the generated revision that the Wiki neither indexes nor excludes, inside the opened folder only; called by {@link inspectDeepWikiFreshness} beside the comparison of the indexed sources.
 * @param projectRoot - Canonical opened folder; it may be a subfolder of a Git repository.
 * @param includedSources - The sources the Wiki indexes.
 * @param generatedRevision - Git commit captured during generation.
 * @param excludedPaths - Manifest exclusions.
 * @param outputDirectory - Resolved Wiki output folder.
 * @returns
 * - `checked` with the uncovered added paths, sorted
 * - `no-repository` when the folder is in no Git repository
 * - `unverified` with the cause when Git is missing, did not finish, or the manifest has no full commit hash
 * @example
 * await findAddedSources('/repo', [], commit, [], '/repo/.codebook/wiki') // => { kind: 'checked', addedPaths: ['src/new.ts'] }
 */
async function findAddedSources(
  projectRoot: string,
  includedSources: WikiIncludedSource[],
  generatedRevision: string | undefined,
  excludedPaths: string[],
  outputDirectory: string | undefined,
): Promise<AdditionCheck> {
  const options = {
    cwd: projectRoot,
    timeout: WIKI_GIT_TIMEOUT_MS,
    maxBuffer: WIKI_GIT_OUTPUT_LIMIT_BYTES,
    // Git's own words decide "no repository", so they must not be translated.
    env: { ...process.env, LC_ALL: 'C' },
  }
  try {
    await runGit('git', ['rev-parse', '--show-toplevel'], options)
  } catch (error) {
    return repositoryFailure(error)
  }
  const revision = fullCommitHash(generatedRevision)
  if (!revision) return { kind: 'unverified', cause: 'no-revision' }
  try {
    // Both commands run in the opened folder and answer paths relative to it, so a subfolder of a monorepo is checked against its own files.
    const [committed, untracked] = await Promise.all([
      runGit(
        'git',
        [
          'diff',
          '--name-only',
          '--diff-filter=A',
          '--relative',
          '-z',
          revision,
          '--',
        ],
        options,
      ),
      runGit(
        'git',
        ['ls-files', '--others', '--exclude-standard', '-z'],
        options,
      ),
    ])
    return {
      kind: 'checked',
      addedPaths: uncoveredAddedPaths(
        committed.stdout,
        untracked.stdout,
        projectRoot,
        includedSources,
        excludedPaths,
        outputDirectory,
      ),
    }
  } catch (error) {
    return listingFailure(error)
  }
}

/**
 * Says whether a manifest entry can be compared at all; called by {@link checkSource} in {@link inspectDeepWikiFreshness} before the file is touched.
 * @param source - One indexed source of the manifest.
 * @returns Whether the entry has a path and a full SHA-256 in hexadecimal digits.
 * @example
 * isComparableSource({ path: 'src/a.ts', sha256: 'not a hash' }) // => false
 */
function isComparableSource(source: WikiIncludedSource): boolean {
  return Boolean(source.path) && /^[a-f0-9]{64}$/i.test(source.sha256)
}

/**
 * Says whether a file's canonical place lies outside the opened folder; called by {@link checkSource} in {@link inspectDeepWikiFreshness} so that a link out of the project is never hashed.
 * @param pathWithinProject - The canonical file relative to the project root.
 * @returns `true` for the root itself, its parent and anything under the parent; `false` for a path inside the project.
 * @example
 * isOutsideProject('../other/a.ts') // => true
 * isOutsideProject('src/a.ts')      // => false
 */
function isOutsideProject(pathWithinProject: string): boolean {
  return (
    !pathWithinProject ||
    pathWithinProject === '..' ||
    pathWithinProject.startsWith(`..${sep}`)
  )
}

/**
 * Names what a file's hash says about an indexed source; called by {@link checkSource} in {@link inspectDeepWikiFreshness} with the hash it has just read.
 * @param fileSha256 - The hash of the file on disk, in lower-case hexadecimal digits.
 * @param recordedSha256 - The hash the manifest records, in either case.
 * @returns `matches` when the file's hash is the recorded one, `changed` when it differs.
 * @example
 * sourceCheckOfHash('0f9e…', '0F9E…') // => 'matches'
 */
function sourceCheckOfHash(
  fileSha256: string,
  recordedSha256: string,
): 'matches' | 'changed' {
  return fileSha256 === recordedSha256.toLowerCase() ? 'matches' : 'changed'
}

/**
 * Says whether a thrown value reports a file that is gone; called by {@link sourceCheckOfFailure}.
 * @param error - What resolving or hashing the file threw.
 * @returns Whether it is an object whose `code` is `ENOENT`.
 * @example
 * isMissingFileError({ code: 'ENOENT' }) // => true
 * isMissingFileError({ code: 'EACCES' }) // => false
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

/**
 * Names what a failed read says about an indexed source; called by {@link checkSource} in {@link inspectDeepWikiFreshness} with what resolving or hashing the file threw.
 * @param error - What was thrown.
 * @returns `changed` for a file that is gone ({@link isMissingFileError}), `unchecked` for a file that is there and cannot be read.
 * @example
 * sourceCheckOfFailure({ code: 'ENOENT' }) // => 'changed'
 * sourceCheckOfFailure({ code: 'EACCES' }) // => 'unchecked'
 */
function sourceCheckOfFailure(error: unknown): 'changed' | 'unchecked' {
  return isMissingFileError(error) ? 'changed' : 'unchecked'
}

/**
 * Checks a Wiki's indexed files and the files added since its generation against the opened project, including dirty source trees.
 *
 * Why: the reader's freshness label and the result of an update both rest on it: "current" must mean that every indexed source matches and that no source file was added that the Wiki neither indexes nor excludes.
 * Trigger: the browser reader calls it for its freshness label, and the extension when an update starts and when a run ends.
 *
 * @param projectRoot - Canonical opened folder; it may be a subfolder of a Git repository.
 * @param includedSources - Source hashes saved during generation.
 * @param generatedRevision - Git commit captured during generation.
 * @param excludedPaths - Manifest exclusions for new source detection.
 * @param options.outputDirectory - Resolved Wiki output folder; files under it, under the backups the publisher keeps beside it and under its candidates are not counted as added source.
 * @param options.hashFile - Hashes one indexed source; a test passes its own to observe how many run at once.
 * @returns
 * - `changed`: indexed sources that differ or are gone (`changedPaths`, in the manifest's order) and uncovered added files (`addedPaths`, sorted)
 * - `unknown`: an indexed source could not be compared (`uncheckedPath`, the first in the manifest's order), or the Git check did not finish; `unknownCause` says which and `reason` is its sentence
 * - `current`: everything matches; in a folder without a Git repository `addedFilesUnchecked` says that added files were not looked for
 *
 * @example
 * ```ts
 * await inspectDeepWikiFreshness('/repo', [{ path: 'src/a.ts', sha256: hash }], commit, [], { outputDirectory: '/repo/docs/wiki' })
 * // => { status: 'current', changedPaths: [], addedPaths: [] }
 * ```
 */
export async function inspectDeepWikiFreshness(
  projectRoot: string,
  includedSources: WikiIncludedSource[],
  generatedRevision: string | undefined,
  excludedPaths: string[],
  options: {
    outputDirectory?: string
    hashFile?: (filePath: string) => Promise<string>
  } = {},
): Promise<WikiFreshness> {
  const hashFile = options.hashFile ?? hashFileSha256
  /**
   * Compares one indexed source with the file on disk; run for every indexed source by {@link mapWithConcurrencyLimit}.
   * @param source - One indexed source of the manifest.
   * @returns
   * - `matches` or `changed` by the file's hash; a file that is gone is `changed`
   * - `unchecked` for an entry without a usable path or hash, a file outside the project, and a file that cannot be read
   * @example
   * await checkSource({ path: 'src/a.ts', sha256: hash }) // => 'matches'
   */
  const checkSource = async (
    source: WikiIncludedSource,
  ): Promise<'matches' | 'changed' | 'unchecked'> => {
    if (!isComparableSource(source)) return 'unchecked'
    try {
      const canonicalFile = await realpath(join(projectRoot, source.path))
      if (isOutsideProject(relative(projectRoot, canonicalFile)))
        return 'unchecked'
      // A source of any size is compared: the question composer's size limit is no reason to call a large lockfile or image unchecked.
      return sourceCheckOfHash(await hashFile(canonicalFile), source.sha256)
    } catch (error) {
      return sourceCheckOfFailure(error)
    }
  }
  const [sourceChecks, additions] = await Promise.all([
    mapWithConcurrencyLimit(
      includedSources,
      WIKI_FRESHNESS_HASH_CONCURRENCY,
      checkSource,
    ),
    findAddedSources(
      projectRoot,
      includedSources,
      generatedRevision,
      excludedPaths,
      options.outputDirectory,
    ),
  ])
  // The results are in the manifest's order, whatever order the files were read in.
  const changedPaths = includedSources
    .filter((_, index) => sourceChecks[index] === 'changed')
    .map((source) => source.path)
  const firstUnchecked = includedSources.find(
    (_, index) => sourceChecks[index] === 'unchecked',
  )
  const addedPaths = additions.kind === 'checked' ? additions.addedPaths : []
  if (changedPaths.length || addedPaths.length)
    return { status: 'changed', changedPaths, addedPaths }
  if (firstUnchecked) {
    const uncheckedPath = firstUnchecked.path || '(an entry without a path)'
    return {
      status: 'unknown',
      changedPaths,
      addedPaths,
      reason: `An indexed source could not be checked: ${uncheckedPath}.`,
      uncheckedPath,
      unknownCause: 'unchecked-source',
    }
  }
  if (additions.kind === 'unverified')
    return {
      status: 'unknown',
      changedPaths,
      addedPaths,
      reason: UNKNOWN_REASONS[additions.cause],
      unknownCause: additions.cause,
    }
  return {
    status: 'current',
    changedPaths,
    addedPaths,
    ...(additions.kind === 'no-repository'
      ? { addedFilesUnchecked: true }
      : {}),
  }
}
