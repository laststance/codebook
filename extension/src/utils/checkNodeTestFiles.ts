import { readFile, realpath } from 'node:fs/promises'

import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'
import { sha256 } from '../runtimeSupport/utils/sha256'

import { resolveOwnedRepositoryFile } from './resolveOwnedRepositoryFile'

/** One declared stop with the real file it cites. */
export type CheckedNodeTestStop = {
  file: string
  source: NodeTestConfiguration['source']
  inspections: NodeTestConfiguration['inspections']
}

/** The real files a node-test configuration names, each checked against the hash it declares. */
export type CheckedNodeTestFiles = {
  root: string
  testFile: string
  stops: CheckedNodeTestStop[]
}

/**
 * Resolves one declared path or refuses it with the Error contract's sentence.
 * @param root - The repository's real root.
 * @param field - The configuration field that names the path.
 * @param path - The declared path.
 * @returns The real file.
 * @throws An `INVALID_CONFIGURATION` {@link StudyError} for a path that is no regular file inside the repository, a missing one included.
 * @example await ownedFile('/repo', 'testFile', 'app/lib/data.test.ts') // => '/repo/app/lib/data.test.ts'
 */
async function ownedFile(
  root: string,
  field: string,
  path: string,
): Promise<string> {
  const file = await resolveOwnedRepositoryFile(root, path)
  if (!file)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `node-test preparation refused: ${field} ${path} is not a file in the opened repository. Use a tracked path from codebook_sources.`,
    )
  return file
}

/**
 * Checks, before a test run's history exists, every file a node-test configuration names: each path is a regular file inside the opened repository, each declared stop's source still has the hash the article cites, and the test file still has its declared hash; called by the study environment for {@link StudyService}'s preparation, so a refusal ends the run with its typed `error`, creates no history and frees the run's slot, and by {@link prepareNodeTestLaunch}, which checks again right before Vitest is asked anything.
 * Each refusal names the field, the path and both hashes and ends with its fix (the Error contract of plan version 7).
 * @param workspace - The opened repository's root.
 * @param configuration - The validated node-test configuration of a new run.
 * @returns The repository's real root, the real test file and every declared stop with its real file, in declaration order.
 * @throws An `INVALID_CONFIGURATION` {@link StudyError} for a path that is not a file and for a changed test file; a `SOURCE_CHANGED` one for a declared stop whose source changed.
 * @example
 * await checkNodeTestFiles('/repo', configuration)
 * // => { root: '/repo', testFile: '/repo/app/lib/data.test.ts', stops: [{ file: '/repo/app/lib/data.ts', source, inspections }] }
 */
export async function checkNodeTestFiles(
  workspace: string,
  configuration: NodeTestConfiguration,
): Promise<CheckedNodeTestFiles> {
  const root = await realpath(workspace)
  const declared = [
    {
      field: 'source.path',
      source: configuration.source,
      inspections: configuration.inspections,
    },
    ...(configuration.additionalStops ?? []).map((stop, index) => ({
      field: `additionalStops[${index}].path`,
      source: {
        path: stop.path,
        hash: stop.hash,
        line: stop.line,
        column: stop.column,
      },
      inspections: stop.inspections,
    })),
  ]
  const [testFile, ...stopFiles] = await Promise.all([
    ownedFile(root, 'testFile', configuration.testFile),
    ...declared.map((stop) => ownedFile(root, stop.field, stop.source.path)),
  ])
  const stops = declared.map((stop, index) => ({
    file: stopFiles[index]!,
    source: stop.source,
    inspections: stop.inspections,
  }))
  // Each stop's source first: a changed source is fixed in the article, a changed test in the start alone.
  for (const [index, stop] of stops.entries()) {
    const current = sha256(await readFile(stop.file))
    if (current !== stop.source.hash)
      throw new StudyError(
        'SOURCE_CHANGED',
        `node-test preparation refused: declared stop ${index + 1} cites ${stop.source.path} with SHA-256 ${stop.source.hash}, but the file now has ${current}. Read it with codebook_source, publish the article with the current source, then start with a new key.`,
      )
  }
  const testHash = sha256(await readFile(testFile))
  if (testHash !== configuration.testHash)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `node-test preparation refused: testHash ${configuration.testHash} does not match ${configuration.testFile}, which now has SHA-256 ${testHash}. Read the test file with codebook_source and start with its current hash and a new key.`,
    )
  return { root, testFile, stops }
}
