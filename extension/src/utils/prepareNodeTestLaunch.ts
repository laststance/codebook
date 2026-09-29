import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas';
import { NODE_TEST_EXCLUDED_FILE_LIMIT, NODE_TEST_MINIMUM_VITEST_MAJOR, REPOSITORY_RUN_TIMEOUT_MS } from '../constants';
import { StudyError } from '../errors';
import type { ListVitestTestFilesRequest, VitestListedFile } from './listVitestTestFiles';
import { requireNodeTestTitles } from './requireNodeTestTitles';

export type PreparedNodeTestStop = { file: string; source: NodeTestConfiguration['source']; inspections: NodeTestConfiguration['inspections'] };
/** A private folder owned by one run; `file` is where Vitest writes the JSON report that proves which test ran. */
export type NodeTestReportLocation = { directory: string; file: string };
export type PreparedNodeTestLaunch = { workspace: string; testFile: string; testTitles: string[]; sourceFile: string; stops: PreparedNodeTestStop[];
  program: string; args: string[]; report: NodeTestReportLocation };
/** Asks the owned Vitest which files a run would select; see {@link listVitestTestFiles}. */
export type ListVitestTestFiles = (request: ListVitestTestFilesRequest) => Promise<VitestListedFile[]>;

const vitestPackageSchema = z.object({ version: z.string() });
/** Makes every regular-expression character in a test title literal. @example literalPattern('adds (x).') // => 'adds \\(x\\)\\.' */
const literalPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Vitest applies `--exclude` as a glob; escaping keeps the path naming only itself. @example literalGlob('/r/app/[id]/a.test.ts') // => '/r/app/\\[id\\]/a.test.ts' */
const literalGlob = (path: string) => path.replace(/[\\*?[\]{}()!+@]/g, '\\$&');

/**
 * Seals one repository-local Vitest command that runs exactly the cited test, after checking every cited source and asking Vitest which files it would run.
 *
 * Vitest's file filter is a substring match and its name filter a regular expression over the full test name, so the command excludes every
 * other file Vitest reports and anchors the literal title path. Vitest 5 joins titles with " > " and Vitest 4 with one space.
 * Called by the owned Node test run during preparation, before any test code executes.
 *
 * @param workspace - Opened repository root.
 * @param configuration - Validated test intent of a new run.
 * @param listTestFiles - Runs the owned `vitest list --filesOnly` with the run's Node and cancellation.
 * @returns The checked program, argv, stops, cited title path and the private report location the caller must remove.
 * @throws When a path, hash or Vitest version check fails, the identity is retired or missing, or Vitest cannot select the cited file alone.
 * @example
 * ```ts
 * await prepareNodeTestLaunch('/repo', config, listTestFiles)
 * // => { program: '/repo/node_modules/vitest/vitest.mjs', args: ['run', 'src/a.test.ts', '--inspect-brk', ..., '--testNamePattern=^subscription > notifies once$', '--reporter=default', '--reporter=json', '--outputFile.json=/tmp/codebook-vitest-report-x/vitest-report.json'] }
 * ```
 */
export async function prepareNodeTestLaunch(workspace: string, configuration: NodeTestConfiguration, listTestFiles: ListVitestTestFiles): Promise<PreparedNodeTestLaunch> {
  const testTitles = requireNodeTestTitles(configuration);
  const root = await realpath(workspace);
  const resolveOwnedFile = async (path: string): Promise<string> => {
    const file = await realpath(join(root, path));
    const owned = relative(root, file);
    // Existing symlinks may be used only when they still resolve inside this exact checkout.
    if (!owned || owned === '..' || owned.startsWith(`..${sep}`) || !(await stat(file)).isFile()) throw new Error(`Node test path is not a file in the opened repository: ${path}`);
    return file;
  };
  const declaredStops = [{ source: configuration.source, inspections: configuration.inspections },
    ...(configuration.additionalStops ?? []).map(stop => ({ source: { path: stop.path, hash: stop.hash, line: stop.line, column: stop.column }, inspections: stop.inspections }))];
  const [testFile, sourceFile, program, vitestPackage, ...additionalSourceFiles] = await Promise.all([
    resolveOwnedFile(configuration.testFile),
    resolveOwnedFile(configuration.source.path),
    resolveOwnedFile('node_modules/vitest/vitest.mjs'),
    resolveOwnedFile('node_modules/vitest/package.json'),
    ...(configuration.additionalStops ?? []).map(stop => resolveOwnedFile(stop.path)),
  ]);
  const vitestPackageJson = vitestPackageSchema.safeParse(await readFile(vitestPackage!, 'utf8').then((text): unknown => JSON.parse(text)).catch(() => undefined));
  const vitestVersion = vitestPackageJson.success ? vitestPackageJson.data.version : 'an unreadable version';
  const vitestMajor = Number.parseInt(vitestVersion, 10);
  // Older Vitest lacks the verified file listing, exclusion and report behavior this exact selection relies on.
  if (!Number.isInteger(vitestMajor) || vitestMajor < NODE_TEST_MINIMUM_VITEST_MAJOR) throw new StudyError('PREREQUISITE_MISSING', `The node-test profile needs Vitest ${NODE_TEST_MINIMUM_VITEST_MAJOR} or later; this repository has ${vitestVersion}.`);
  const stops = declaredStops.map((stop, index) => ({ ...stop, file: index === 0 ? sourceFile! : additionalSourceFiles[index - 1]! }));
  const [testBytes, ...sourceBytes] = await Promise.all([readFile(testFile!), ...stops.map(stop => readFile(stop.file))]);
  for (const [index, stop] of stops.entries()) {
    if (createHash('sha256').update(sourceBytes[index]!).digest('hex') !== stop.source.hash)
      throw new Error(`Node test source changed; declared stop ${index + 1} requires a current source before running the test.`);
  }
  const testHash = createHash('sha256').update(testBytes).digest('hex');
  if (testHash !== configuration.testHash) throw new Error('Node test file changed; review the current test before running it.');
  const excludes = await excludeOtherTestFiles(root, testFile!, configuration.testFile, program!, listTestFiles);
  const separator = vitestMajor >= 5 ? ' > ' : ' ';
  // Created last so a refused preparation leaves nothing behind; the run removes it on release.
  const reportDirectory = await mkdtemp(join(tmpdir(), 'codebook-vitest-report-'));
  const report = { directory: reportDirectory, file: join(reportDirectory, 'vitest-report.json') };
  // Native inspection pauses the test clock; the owned run deadline still bounds execution.
  // Every option keeps its value in one token: Vitest's parser reads a separate value that begins with "-" as a new option, such as --config.
  const args = ['run', configuration.testFile, '--inspect-brk', '--no-file-parallelism', `--testTimeout=${REPOSITORY_RUN_TIMEOUT_MS}`,
    ...excludes.map(exclude => `--exclude=${exclude}`), `--testNamePattern=^${testTitles.map(literalPattern).join(separator)}$`,
    '--reporter=default', '--reporter=json', `--outputFile.json=${report.file}`];
  return { workspace: root, testFile: testFile!, testTitles, sourceFile: sourceFile!, stops, program: program!, args, report };
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
async function excludeOtherTestFiles(root: string, testFile: string, filter: string, program: string, listTestFiles: ListVitestTestFiles): Promise<string[]> {
  const isCited = async (entry: VitestListedFile) => entry.file === testFile || await realpath(entry.file).then(file => file === testFile, () => false);
  const partition = async (entries: VitestListedFile[]) => {
    const cited: VitestListedFile[] = [], others: VitestListedFile[] = [];
    for (const entry of entries) (await isCited(entry) ? cited : others).push(entry);
    return { cited, others };
  };
  const first = await partition(await listTestFiles({ program, workspace: root, filter, excludes: [] }));
  if (first.cited.length === 0) throw new StudyError('INVALID_CONFIGURATION', 'Vitest does not select the cited test file under this repository\'s Vitest configuration.');
  if (first.cited.length > 1) throw new StudyError('INVALID_CONFIGURATION', `The cited test file belongs to ${first.cited.length} Vitest projects, so it would run more than once.`);
  const otherFiles = [...new Set(first.others.map(entry => entry.file))];
  if (otherFiles.length > NODE_TEST_EXCLUDED_FILE_LIMIT) throw new StudyError('INVALID_CONFIGURATION',
    `Vitest's file filter also selects ${otherFiles.length} other test files; Codebook excludes at most ${NODE_TEST_EXCLUDED_FILE_LIMIT}.`);
  const excludes = otherFiles.map(literalGlob);
  if (excludes.length === 0) return excludes;
  // Exclusion globs apply per Vitest project; only Vitest can confirm the cited file now runs alone.
  const confirmed = await partition(await listTestFiles({ program, workspace: root, filter, excludes }));
  if (confirmed.cited.length !== 1 || confirmed.others.length > 0) throw new StudyError('INVALID_CONFIGURATION', 'Vitest still selects other test files after Codebook excluded them, so it cannot run only the cited file.');
  return excludes;
}
