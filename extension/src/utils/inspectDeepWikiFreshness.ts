import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'

import {
  WIKI_GIT_OUTPUT_LIMIT_BYTES,
  WIKI_GIT_TIMEOUT_MS,
  WIKI_SOURCE_LIMIT_BYTES,
} from '../constants'

import type { WikiIncludedSource } from './answerDeepWikiQuestion'
import { matchesWikiExclusion } from './matchesWikiExclusion'
import { sourceExclusion } from './sourceExclusion'

const runGit = promisify(execFile)

export type WikiFreshness = {
  status: 'current' | 'changed' | 'unknown'
  changedPaths: string[]
  addedPaths: string[]
  reason?: string
}

/** Checks a reader's indexed files and additions against its generation revision, including dirty source trees. @param projectRoot - Canonical opened repository. @param includedSources - Source hashes saved during generation. @param generatedRevision - Git commit captured during generation. @param excludedPaths - Manifest exclusions for new source detection. @returns Current, changed or explicitly unknown freshness. @example await inspectDeepWikiFreshness('/repo', [{ path: 'src/a.ts', sha256: hash }], commit, []) */
export async function inspectDeepWikiFreshness(
  projectRoot: string,
  includedSources: WikiIncludedSource[],
  generatedRevision: string | undefined,
  excludedPaths: string[],
): Promise<WikiFreshness> {
  const changedPaths: string[] = []
  let unreadable = false
  for (const source of includedSources) {
    if (!source.path || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
      unreadable = true
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
        unreadable = true
        continue
      }
      if ((await stat(canonicalFile)).size > WIKI_SOURCE_LIMIT_BYTES) {
        unreadable = true
        continue
      }
      const actualHash = createHash('sha256')
        .update(await readFile(canonicalFile))
        .digest('hex')
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
      else unreadable = true
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
  if (unreadable || !additionCheckComplete)
    return {
      status: 'unknown',
      changedPaths,
      addedPaths,
      reason: unreadable
        ? 'Some indexed source could not be checked.'
        : 'Added source files could not be checked against the generated revision.',
    }
  return { status: 'current', changedPaths, addedPaths }
}
