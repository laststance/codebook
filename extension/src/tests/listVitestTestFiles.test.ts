import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listVitestTestFiles } from '../utils/listVitestTestFiles';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';

/**
 * Writes a stand-in Vitest CLI that records how it was started, then behaves as the given script body.
 *
 * @param body - JavaScript run after recording; `output` holds the `--json=` path Vitest was given.
 * @returns The stand-in program path and a reader for its recorded start.
 * @example
 * ```ts
 * const vitest = await stubVitest('writeFileSync(output, "[]")'); await vitest.started() // => { argv: ['list', ...], cwd: '/repo', env: {...} }
 * ```
 */
async function stubVitest(body: string) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-vitest-stub-'));
  const program = join(directory, 'vitest.mjs');
  await writeFile(program, `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
writeFileSync(${JSON.stringify(join(directory, 'started.json'))}, JSON.stringify({ argv, cwd: process.cwd(), env: process.env }));
const output = argv.find(argument => argument.startsWith('--json='))?.slice('--json='.length);
${body}
`);
  return { directory, program, started: async () => JSON.parse(await readFile(join(directory, 'started.json'), 'utf8')) as { argv: string[]; cwd: string; env: Record<string, string> } };
}

test('listing runs the owned Vitest in the repository with the run environment and returns the files it would select', async () => {
  // Arrange
  const vitest = await stubVitest(`writeFileSync(output, JSON.stringify([{ file: '/repo/src/a.test.ts' }, { file: '/repo/src/a.test.ts', projectName: 'browser' }]));`);
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-vitest-workspace-'));
  process.env.CODEBOOK_LIST_TEST_SECRET = 'must-not-reach-vitest';
  try {
    // Act
    const files = await listVitestTestFiles({ node: process.execPath, program: vitest.program, workspace, filter: 'src/a.test.ts',
      excludes: ['/repo/copy/src/a.test.ts'], signal: new AbortController().signal });
    // Assert
    assert.deepEqual(files, [{ file: '/repo/src/a.test.ts' }, { file: '/repo/src/a.test.ts', projectName: 'browser' }]);
    const started = await vitest.started();
    const output = started.argv[2]!.slice('--json='.length);
    assert.deepEqual(started.argv, ['list', '--filesOnly', `--json=${output}`, 'src/a.test.ts', '--exclude=/repo/copy/src/a.test.ts']);
    assert.equal(started.cwd, await realpath(workspace));
    assert.equal(started.env.CI, 'true');
    assert.equal(started.env.NODE_ENV, 'test');
    assert.equal(started.env.CODEBOOK_LIST_TEST_SECRET, undefined, 'unrelated credentials stay out of the Vitest process');
    await assert.rejects(stat(dirname(output)), { code: 'ENOENT' }, 'the private listing folder is removed');
  } finally {
    delete process.env.CODEBOOK_LIST_TEST_SECRET;
    await rm(vitest.directory, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a Vitest listing that fails reports its exit code and bounded error text', async () => {
  // Arrange
  const vitest = await stubVitest(`process.stderr.write('Config error: ' + 'x'.repeat(10_000)); process.exit(3);`);
  try {
    // Act
    const listing = listVitestTestFiles({ node: process.execPath, program: vitest.program, workspace: vitest.directory, filter: 'src/a.test.ts',
      excludes: [], signal: new AbortController().signal });
    // Assert
    await assert.rejects(listing, (error: Error) => /exit code 3/.test(error.message) && /Config error/.test(error.message) && error.message.length < 2_300);
  } finally { await rm(vitest.directory, { recursive: true, force: true }); }
});

test('a Vitest listing that does not write a list of files is refused', async () => {
  // Arrange
  const vitest = await stubVitest(`writeFileSync(output, JSON.stringify({ files: 'src/a.test.ts' }));`);
  try {
    // Act
    const listing = listVitestTestFiles({ node: process.execPath, program: vitest.program, workspace: vitest.directory, filter: 'src/a.test.ts',
      excludes: [], signal: new AbortController().signal });
    // Assert
    await assert.rejects(listing, /Vitest wrote an unreadable test file list/);
  } finally { await rm(vitest.directory, { recursive: true, force: true }); }
});

test('cancelling the run stops a Vitest listing that is still working', async () => {
  // Arrange
  const vitest = await stubVitest(`setTimeout(() => writeFileSync(output, '[]'), 30_000);`);
  const cancellation = new AbortController();
  try {
    // Act
    const listing = listVitestTestFiles({ node: process.execPath, program: vitest.program, workspace: vitest.directory, filter: 'src/a.test.ts',
      excludes: [], signal: cancellation.signal });
    setTimeout(() => cancellation.abort(new Error('run cancelled')), 200);
    const startedAt = performance.now();
    // Assert
    await assert.rejects(listing, /run cancelled/);
    assert.ok(performance.now() - startedAt < 5_000, 'the listing ends with the run instead of its own deadline');
  } finally { await rm(vitest.directory, { recursive: true, force: true }); }
});

test('a Vitest listing that outlives its deadline is stopped and reported', async () => {
  // Arrange
  const vitest = await stubVitest(`setTimeout(() => writeFileSync(output, '[]'), 30_000);`);
  try {
    // Act
    const listing = listVitestTestFiles({ node: process.execPath, program: vitest.program, workspace: vitest.directory, filter: 'src/a.test.ts',
      excludes: [], signal: new AbortController().signal, timeoutMs: 300 });
    // Assert
    await assert.rejects(listing, /did not list its test files within 300 ms/);
  } finally { await rm(vitest.directory, { recursive: true, force: true }); }
});

test('cancelling a listing releases a SIGTERM-resistant launcher and its helper before rejecting', async () => {
  // Arrange
  const vitest = await stubVitest(`
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
const helper = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
helper.stdout.once('data', () => writeFileSync('ready.json', JSON.stringify({ launcher: process.pid, helper: helper.pid })));
setInterval(() => {}, 1000);
`);
  const cancellation = new AbortController();
  let processes: { launcher: number; helper: number } | undefined;
  try {
    // Act
    const listing = listVitestTestFiles({ node: process.execPath, program: vitest.program, workspace: vitest.directory, filter: 'src/a.test.ts',
      excludes: [], signal: cancellation.signal });
    const rejected = assert.rejects(listing, /run cancelled/);
    processes = await waitUntil(async () => readFile(join(vitest.directory, 'ready.json'), 'utf8').then(text => JSON.parse(text) as { launcher: number; helper: number }, () => undefined), 'listing helper readiness', 5_000);
    cancellation.abort(new Error('run cancelled'));
    await rejected;
    // Assert
    for (const pid of [processes.launcher, processes.helper]) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'rejection must mean the owned process ended');
    const output = (await vitest.started()).argv[2]!.slice('--json='.length);
    await assert.rejects(stat(dirname(output)), { code: 'ENOENT' });
  } finally {
    // A failing negative control still releases only its own synthetic processes.
    cancellation.abort(new Error('run cancelled'));
    if (processes) for (const pid of [processes.helper, processes.launcher]) try { process.kill(pid, 'SIGKILL'); } catch {}
    await rm(vitest.directory, { recursive: true, force: true });
  }
});
