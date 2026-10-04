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

/** Names why a Git command failed: the binary is missing, the time or output bound was hit, the folder is in no repository, or anything else. */
function gitFailureCause(
  error: unknown,
): AdditionCheckFailure | 'no-repository' {
  if (typeof error !== 'object' || error === null) return 'git-failed'
  const code = 'code' in error ? error.code : undefined
  if (code === 'ENOENT') return 'git-missing'
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'git-output-limit'
  if ('killed' in error && error.killed === true) return 'git-timeout'
  if (
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    /not a git repository/i.test(error.stderr)
  )
    return 'no-repository'
  return 'git-failed'
}

/** Looks for source files added since the generated revision that the Wiki neither indexes nor excludes, inside the opened folder only. */
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
    const cause = gitFailureCause(error)
    return cause === 'no-repository'
      ? { kind: 'no-repository' }
      : { kind: 'unverified', cause }
  }
  if (!generatedRevision || !/^[a-f0-9]{40,64}$/i.test(generatedRevision))
    return { kind: 'unverified', cause: 'no-revision' }
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
          generatedRevision,
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
    const indexedPaths = new Set(includedSources.map((source) => source.path))
    const outputPath =
      outputDirectory === undefined
        ? ''
        : relative(projectRoot, outputDirectory).split(sep).join('/')
    return {
      kind: 'checked',
      addedPaths: [
        ...new Set([
          ...committed.stdout.split('\0'),
          ...untracked.stdout.split('\0'),
        ]),
      ]
        .filter(
          (path) =>
            path &&
            !indexedPaths.has(path) &&
            isWikiSourceCandidate(path, outputPath, excludedPaths),
        )
        .sort(),
    }
  } catch (error) {
    const cause = gitFailureCause(error)
    // The repository answered a moment ago, so a refusal now is about the revision or the command.
    return {
      kind: 'unverified',
      cause: cause === 'no-repository' ? 'git-failed' : cause,
    }
  }
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
  /** Compares one indexed source with the file on disk. */
  const checkSource = async (
    source: WikiIncludedSource,
  ): Promise<'matches' | 'changed' | 'unchecked'> => {
    if (!source.path || !/^[a-f0-9]{64}$/i.test(source.sha256))
      return 'unchecked'
    try {
      const canonicalFile = await realpath(join(projectRoot, source.path))
      const pathWithinProject = relative(projectRoot, canonicalFile)
      if (
        !pathWithinProject ||
        pathWithinProject === '..' ||
        pathWithinProject.startsWith(`..${sep}`)
      )
        return 'unchecked'
      // A source of any size is compared: the question composer's size limit is no reason to call a large lockfile or image unchecked.
      return (await hashFile(canonicalFile)) === source.sha256.toLowerCase()
        ? 'matches'
        : 'changed'
    } catch (error) {
      return typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
        ? 'changed'
        : 'unchecked'
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
