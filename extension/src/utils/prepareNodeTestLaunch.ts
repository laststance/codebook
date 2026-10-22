import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  NODE_TEST_EXCLUDED_FILE_LIMIT,
  REPOSITORY_RUN_TIMEOUT_MS,
} from '../constants'
import { StudyError } from '../errors'
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas'

import {
  checkNodeTestFiles,
  type CheckedNodeTestStop,
} from './checkNodeTestFiles'
import type {
  ListVitestTestFilesRequest,
  VitestListedFile,
} from './listVitestTestFiles'
import { readVitestPrerequisite } from './readVitestPrerequisite'
import { requireNodeTestTitles } from './requireNodeTestTitles'
import { resolveOwnedRepositoryFile } from './resolveOwnedRepositoryFile'

export type PreparedNodeTestStop = CheckedNodeTestStop
/** A private folder owned by one run; `file` is where Vitest writes the JSON report that proves which test ran. */
export type NodeTestReportLocation = { directory: string; file: string }
export type PreparedNodeTestLaunch = {
  workspace: string
  testFile: string
  testTitles: string[]
  sourceFile: string
  stops: PreparedNodeTestStop[]
  program: string
  args: string[]
  report: NodeTestReportLocation
}
/** Asks the owned Vitest which files a run would select; see {@link listVitestTestFiles}. */
export type ListVitestTestFiles = (
  request: ListVitestTestFilesRequest,
) => Promise<VitestListedFile[]>

/** Makes every regular-expression character in a test title literal. @example literalPattern('adds (x).') // => 'adds \\(x\\)\\.' */
const literalPattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Vitest applies `--exclude` as a glob; escaping keeps the path naming only itself. @example literalGlob('/r/app/[id]/a.test.ts') // => '/r/app/\\[id\\]/a.test.ts' */
const literalGlob = (path: string) => path.replace(/[\\*?[\]{}()!+@]/g, '\\$&')

/**
 * Seals one repository-local Vitest command that runs exactly the cited test, after checking every cited source and asking Vitest which files it would run.
 *
 * Vitest's file filter is a substring match and its name filter a regular expression over the full test name, so the command excludes every
 * other file Vitest reports and anchors the literal title path. Vitest 5 joins titles with " > " and Vitest 4 with one space.
 * Called by the owned Node test run during preparation, before any test code executes.
 * The paths and hashes are checked by {@link checkNodeTestFiles} and the root Vitest by {@link readVitestPrerequisite}, the same checks the run's preparation made before its history began; they run again here because time passes between the two.
 *
 * @param workspace - Opened repository root.
 * @param configuration - Validated test intent of a new run.
 * @param listTestFiles - Runs the owned `vitest list --filesOnly` with the run's Node and cancellation.
 * @returns The checked program, argv, stops, cited title path and the private report location the caller must remove.
 * @throws The typed refusal of {@link checkNodeTestFiles} or the root Vitest's `PREREQUISITE_MISSING`; an error when the Vitest program is not a file of the repository, the identity is retired or missing, or Vitest cannot select the cited file alone.
 * @example
 * ```ts
 * await prepareNodeTestLaunch('/repo', config, listTestFiles)
 * // => { program: '/repo/node_modules/vitest/vitest.mjs', args: ['run', 'src/a.test.ts', '--inspect-brk', ..., '--testNamePattern=^subscription > notifies once$', '--reporter=default', '--reporter=json', '--outputFile.json=/tmp/codebook-vitest-report-x/vitest-report.json'] }
 * ```
 */
export async function prepareNodeTestLaunch(
  workspace: string,
  configuration: NodeTestConfiguration,
  listTestFiles: ListVitestTestFiles,
): Promise<PreparedNodeTestLaunch> {
  const testTitles = requireNodeTestTitles(configuration)
  const { root, testFile, stops } = await checkNodeTestFiles(
    workspace,
    configuration,
  )
  // Older Vitest lacks the verified file listing, exclusion and report behavior this exact selection relies on.
  const vitest = await readVitestPrerequisite(root)
  if (!vitest.ready) throw new StudyError('PREREQUISITE_MISSING', vitest.reason)
  const program = await resolveOwnedRepositoryFile(
    root,
    'node_modules/vitest/vitest.mjs',
  )
  if (!program)
    throw new StudyError(
      'PREREQUISITE_MISSING',
      'node-test needs the root Vitest program node_modules/vitest/vitest.mjs inside the opened repository; reinstall Vitest at the repository root, then call codebook_status again.',
    )
  const excludes = await excludeOtherTestFiles(
    root,
    testFile,
    configuration.testFile,
    program,
    listTestFiles,
  )
  const separator = vitest.major >= 5 ? ' > ' : ' '
  // Created last so a refused preparation leaves nothing behind; the run removes it on release.
  const reportDirectory = await mkdtemp(
    join(tmpdir(), 'codebook-vitest-report-'),
  )
  const report = {
    directory: reportDirectory,
    file: join(reportDirectory, 'vitest-report.json'),
  }
  // Native inspection pauses the test clock; the owned run deadline still bounds execution.
  // Every option keeps its value in one token: Vitest's parser reads a separate value that begins with "-" as a new option, such as --config.
  const args = [
    'run',
    configuration.testFile,
    '--inspect-brk',
    '--no-file-parallelism',
    `--testTimeout=${REPOSITORY_RUN_TIMEOUT_MS}`,
    ...excludes.map((exclude) => `--exclude=${exclude}`),
    `--testNamePattern=^${testTitles.map(literalPattern).join(separator)}$`,
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${report.file}`,
  ]
  return {
    workspace: root,
    testFile,
    testTitles,
    sourceFile: stops[0]!.file,
    stops,
    program,
    args,
    report,
  }
}

/**
 * Returns escaped `--exclude` globs for every other file Vitest's substring filter would add, after Vitest confirms the cited file then runs alone.
 *
 * @param root - Canonical repository root.
 * @param testFile - Canonical absolute path of the cited test file.
 * @param filter - The cited repository-relative path given to Vitest.
 * @param program - Owned Vitest CLI.
 * @param listTestFiles - The owned Vitest file listing.
 * @throws When Vitest omits the cited file, lists it for several projects, adds too many files or still selects another file after exclusion.
 * @example
 * ```ts
 * await excludeOtherTestFiles('/repo', '/repo/src/a.test.ts', 'src/a.test.ts', program, list) // => ['/repo/copy/src/a.test.ts']
 * ```
 */
async function excludeOtherTestFiles(
  root: string,
  testFile: string,
  filter: string,
  program: string,
  listTestFiles: ListVitestTestFiles,
): Promise<string[]> {
  const isCited = async (entry: VitestListedFile) =>
    entry.file === testFile ||
    (await realpath(entry.file).then(
      (file) => file === testFile,
      () => false,
    ))
  const partition = async (entries: VitestListedFile[]) => {
    const cited: VitestListedFile[] = [],
      others: VitestListedFile[] = []
    for (const entry of entries)
      ((await isCited(entry)) ? cited : others).push(entry)
    return { cited, others }
  }
  const first = await partition(
    await listTestFiles({ program, workspace: root, filter, excludes: [] }),
  )
  if (first.cited.length === 0)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      "Vitest does not select the cited test file under this repository's Vitest configuration.",
    )
  if (first.cited.length > 1)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `The cited test file belongs to ${first.cited.length} Vitest projects, so it would run more than once.`,
    )
  const otherFiles = [...new Set(first.others.map((entry) => entry.file))]
  if (otherFiles.length > NODE_TEST_EXCLUDED_FILE_LIMIT)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      `Vitest's file filter also selects ${otherFiles.length} other test files; Codebook excludes at most ${NODE_TEST_EXCLUDED_FILE_LIMIT}.`,
    )
  const excludes = otherFiles.map(literalGlob)
  if (excludes.length === 0) return excludes
  // Exclusion globs apply per Vitest project; only Vitest can confirm the cited file now runs alone.
  const confirmed = await partition(
    await listTestFiles({ program, workspace: root, filter, excludes }),
  )
  if (confirmed.cited.length !== 1 || confirmed.others.length > 0)
    throw new StudyError(
      'INVALID_CONFIGURATION',
      'Vitest still selects other test files after Codebook excluded them, so it cannot run only the cited file.',
    )
  return excludes
}
