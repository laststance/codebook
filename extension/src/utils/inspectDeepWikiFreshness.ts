import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import { WIKI_GIT_OUTPUT_LIMIT_BYTES, WIKI_GIT_TIMEOUT_MS } from '../constants'

import type { WikiIncludedSource } from './answerDeepWikiQuestion'
import { hashFileSha256 } from './hashFileSha256'
import { matchesWikiExclusion } from './matchesWikiExclusion'
import { sourceExclusion } from './sourceExclusion'

const runGit = promisify(execFile)

export type WikiFreshness = {
  status: 'current' | 'changed' | 'unknown'
  changedPaths: string[]
  addedPaths: string[]
  reason?: string
  /** First indexed source that could not be compared (a manifest entry without a usable path or hash, a path outside the project, a file that cannot be read); set only for `unknown`. */
  uncheckedPath?: string
}

/** Checks a reader's indexed files and additions against its generation revision, including dirty source trees. @param projectRoot - Canonical opened repository. @param includedSources - Source hashes saved during generation. @param generatedRevision - Git commit captured during generation. @param excludedPaths - Manifest exclusions for new source detection. @returns Current, changed or explicitly unknown freshness. @example await inspectDeepWikiFreshness('/repo', [{ path: 'src/a.ts', sha256: hash }], commit, []) */
export async function inspectDeepWikiFreshness(
  projectRoot: string,
  includedSources: WikiIncludedSource[],
  generatedRevision: string | undefined,
  excludedPaths: string[],
): Promise<WikiFreshness> {
  const changedPaths: string[] = []
  let uncheckedPath: string | undefined
  for (const source of includedSources) {
    if (!source.path || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
      uncheckedPath ??= source.path || '(an entry without a path)'
      continue
    }
    try {
      const canonicalFile = await realpath(join(projectRoot, source.path))
      const pathWithinProject = relative(projectRoot, canonicalFile)
      if (
        !pathWithinProject ||
        pathWithinProject === '..' ||
        pathWithinProject.startsWith(`..${sep}`)
      ) {
        uncheckedPath ??= source.path
        continue
      }
      // A source of any size is compared: the question composer's size limit is no reason to call a large lockfile or image unchecked.
      const actualHash = await hashFileSha256(canonicalFile)
      if (actualHash !== source.sha256.toLowerCase())
        changedPaths.push(source.path)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        changedPaths.push(source.path)
      else uncheckedPath ??= source.path
    }
  }
  let addedPaths: string[] = []
  let additionCheckComplete = false
  if (generatedRevision && /^[a-f0-9]{40,64}$/i.test(generatedRevision)) {
    try {
      const options = {
        cwd: projectRoot,
        timeout: WIKI_GIT_TIMEOUT_MS,
        maxBuffer: WIKI_GIT_OUTPUT_LIMIT_BYTES,
      }
      const { stdout: repositoryTopLevel } = await runGit(
        'git',
        ['rev-parse', '--show-toplevel'],
        options,
      )
      if ((await realpath(repositoryTopLevel.trim())) !== projectRoot)
        throw new Error('The Wiki root is not the Git repository root.')
      const [committed, untracked] = await Promise.all([
        runGit(
          'git',
          [
            'diff',
            '--name-only',
            '--diff-filter=A',
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
      addedPaths = [
        ...new Set([
          ...committed.stdout.split('\0'),
          ...untracked.stdout.split('\0'),
        ]),
      ]
        .filter(
          (path) =>
            path &&
            !indexedPaths.has(path) &&
            !sourceExclusion(path) &&
            !excludedPaths.some((exclusion) =>
              matchesWikiExclusion(path, exclusion),
            ),
        )
        .sort()
      additionCheckComplete = true
    } catch {
      additionCheckComplete = false
    }
  }
  if (changedPaths.length || addedPaths.length)
    return { status: 'changed', changedPaths, addedPaths }
  if (uncheckedPath !== undefined)
    return {
      status: 'unknown',
      changedPaths,
      addedPaths,
      reason: `An indexed source could not be checked: ${uncheckedPath}.`,
      uncheckedPath,
    }
  if (!additionCheckComplete)
    return {
      status: 'unknown',
      changedPaths,
      addedPaths,
      reason:
        'Added source files could not be checked against the generated revision.',
    }
  return { status: 'current', changedPaths, addedPaths }
}
