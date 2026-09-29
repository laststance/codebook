import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { NodeTestConfiguration } from '../nodeTestConfigSchemas';
import { REPOSITORY_RUN_TIMEOUT_MS } from '../constants';

export type PreparedNodeTestStop = { file: string; source: NodeTestConfiguration['source']; inspections: NodeTestConfiguration['inspections'] };
export type PreparedNodeTestLaunch = { workspace: string; testFile: string; sourceFile: string; stops: PreparedNodeTestStop[]; program: string; args: string[] };

/** Seals one repository-local Vitest command and checked source before a Node debugger can acquire it. Called during Node test preparation, before process input. @param workspace - Opened repository root. @param configuration - Validated test intent. @example await prepareNodeTestLaunch('/repo', config) // => { program: '/repo/node_modules/vitest/vitest.mjs', args: ['run', 'src/a.test.ts', '--inspect-brk', '--no-file-parallelism', '--testTimeout=600000'] } */
export async function prepareNodeTestLaunch(workspace: string, configuration: NodeTestConfiguration): Promise<PreparedNodeTestLaunch> {
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
  const [testFile, sourceFile, program, ...additionalSourceFiles] = await Promise.all([
    resolveOwnedFile(configuration.testFile),
    resolveOwnedFile(configuration.source.path),
    resolveOwnedFile('node_modules/vitest/vitest.mjs'),
    ...(configuration.additionalStops ?? []).map(stop => resolveOwnedFile(stop.path)),
  ]);
  const stops = declaredStops.map((stop, index) => ({ ...stop, file: index === 0 ? sourceFile! : additionalSourceFiles[index - 1]! }));
  const [testBytes, ...sourceBytes] = await Promise.all([readFile(testFile!), ...stops.map(stop => readFile(stop.file))]);
  for (const [index, stop] of stops.entries()) {
    if (createHash('sha256').update(sourceBytes[index]!).digest('hex') !== stop.source.hash)
      throw new Error(`Node test source changed; declared stop ${index + 1} requires a current source before running the test.`);
  }
  const testHash = createHash('sha256').update(testBytes).digest('hex');
  if (testHash !== configuration.testHash) throw new Error('Node test file changed; review the current test before running it.');
  // Native inspection pauses the test clock; the owned run deadline still bounds execution.
  const args = ['run', configuration.testFile, '--inspect-brk', '--no-file-parallelism', `--testTimeout=${REPOSITORY_RUN_TIMEOUT_MS}`];
  if (configuration.testName) args.push('--testNamePattern', configuration.testName);
  return { workspace: root, testFile: testFile!, sourceFile: sourceFile!, stops, program: program!, args };
}
