import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPackage } from '../utils/buildPackage.mjs';
import { BUILD_PACKAGES, COMPILED_DIRECTORIES } from '../utils/packageConstants.mjs';
import { withPackageOutput } from '../utils/withPackageOutput.mjs';
import { resolvePackageDestination } from '../utils/resolvePackageDestination.mjs';
import { cleanPackageOutputs } from '../utils/cleanPackageOutputs.mjs';
import { runPackageCommand } from '../utils/runPackageCommand.mjs';
import { inspectBundle } from '../utils/inspectBundle.mjs';

/** Gives publication failures an owned directory and previous artifact whose bytes must survive. @example const fixture = await outputFixture(context) */
async function outputFixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'codebook-output-')); context.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'existing.vsix'); await writeFile(output, 'previous good artifact'); return { directory, output };
}

/** Supplies real Git/source identity for build-boundary failures without touching the working checkout. @example const repository = await sourceFixture(context) */
async function sourceFixture(context) {
  const { directory, output } = await outputFixture(context), repository = join(directory, 'repository');
  for (const name of BUILD_PACKAGES) {
    const root = join(repository, name);
    for (const part of ['src', 'fixture', 'scripts', 'patches']) await mkdir(join(root, part), { recursive: true });
    for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'README.md']) await writeFile(join(root, file), 'fixture\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: name.replaceAll('/', '-'), version: '0.2.1' }));
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Node16', moduleResolution: 'Node16', strict: true, noEmit: true, types: [] }, include: ['src'] }));
    await writeFile(join(root, 'src/main.ts'), 'export const source = 1;');
  }
  await writeFile(join(repository, '.gitignore'), '**/dist/\n**/build/\n');
  await runPackageCommand('git', ['init', '--quiet'], repository); await runPackageCommand('git', ['add', '.'], repository);
  await runPackageCommand('git', ['-c', 'user.name=Codebook Test', '-c', 'user.email=codebook-test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], repository);
  return { directory, output, repository };
}

test('failed VSIX preparation preserves the previous artifact and removes only owned scratch files', async context => {
  // Arrange
  const fixture = await outputFixture(context);
  // Act / Assert
  await assert.rejects(withPackageOutput(fixture.output, async ({ candidate }) => { await writeFile(candidate, 'partial output'); throw new Error('Invalid archive'); }), /Invalid archive/);
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact'); assert.deepEqual(await readdir(fixture.directory), ['existing.vsix']);
});

test('a rejected final rename leaves the previous VSIX byte-for-byte intact', async context => {
  // Arrange
  const fixture = await outputFixture(context); let renames = 0;
  // Act / Assert
  await assert.rejects(withPackageOutput(fixture.output, async ({ candidate }) => { await writeFile(candidate, 'validated candidate'); return { checked: true }; }, async () => { renames++; throw new Error('Rename denied'); }), /Rename denied/);
  assert.equal(renames, 1); assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact'); assert.deepEqual(await readdir(fixture.directory), ['existing.vsix']);
});

test('successful publication replaces only the requested VSIX and returns its validation receipt', async context => {
  // Arrange
  const fixture = await outputFixture(context); await writeFile(join(fixture.directory, 'unrelated.txt'), 'keep');
  // Act
  const receipt = await withPackageOutput(fixture.output, async ({ candidate }) => { await writeFile(candidate, 'validated candidate'); return { checked: true }; });
  // Assert
  assert.deepEqual(receipt, { checked: true }); assert.equal(await readFile(fixture.output, 'utf8'), 'validated candidate');
  assert.equal(await readFile(join(fixture.directory, 'unrelated.txt'), 'utf8'), 'keep'); assert.deepEqual((await readdir(fixture.directory)).sort(), ['existing.vsix', 'unrelated.txt']);
});

test('an output symlink cannot redirect package publication or overwrite its target', async context => {
  // Arrange
  const fixture = await sourceFixture(context), alias = join(fixture.directory, 'alias.vsix'); await symlink(fixture.output, alias);
  // Act / Assert
  await assert.rejects(resolvePackageDestination(fixture.repository, alias), /regular file/); assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact');
});

test('build output destinations are rejected through both literal paths and directory aliases before cleaning', async context => {
  // Arrange
  const fixture = await sourceFixture(context), compiled = join(fixture.repository, 'extension/dist'); await mkdir(compiled); await writeFile(join(compiled, 'keep.vsix'), 'previous');
  const alias = join(fixture.directory, 'output-alias'); await symlink(compiled, alias);
  // Act / Assert
  await assert.rejects(resolvePackageDestination(fixture.repository, join(compiled, 'keep.vsix')), /overlaps/);
  await assert.rejects(resolvePackageDestination(fixture.repository, join(alias, 'next.vsix')), /overlaps/);
  assert.equal(await readFile(join(compiled, 'keep.vsix'), 'utf8'), 'previous');
});

test('a compilation failure stops packaging without replacing the previous VSIX', async context => {
  // Arrange
  const fixture = await sourceFixture(context); let commands = 0;
  // Act / Assert
  await assert.rejects(buildPackage(fixture.repository, fixture.output, async () => { commands++; throw new Error('Compilation failed'); }), /Compilation failed/);
  assert.equal(commands, 1); assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact');
  assert.deepEqual((await readdir(fixture.directory)).sort(), ['existing.vsix', 'repository']);
});

test('source changes during compilation invalidate the artifact instead of labeling it with an earlier snapshot', async context => {
  // Arrange
  const fixture = await sourceFixture(context);
  // Act / Assert
  await assert.rejects(buildPackage(fixture.repository, fixture.output, async () => { await writeFile(join(fixture.repository, 'extension/src/main.ts'), 'export const source = 2;'); }), /Source inputs changed during compilation/);
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact'); assert.deepEqual((await readdir(fixture.directory)).sort(), ['existing.vsix', 'repository']);
});

test('clean packaging prevents a stale declaration from making absent source compile successfully', async context => {
  // Arrange: first prove the incremental compiler accepts the obsolete declaration.
  const fixture = await sourceFixture(context), extension = join(fixture.repository, 'extension');
  await mkdir(join(extension, 'dist')); await writeFile(join(extension, 'dist/obsolete.d.ts'), 'export declare const obsolete: string;');
  await writeFile(join(extension, 'src/main.ts'), "import { obsolete } from '../dist/obsolete.js'; console.log(obsolete);");
  const compiler = fileURLToPath(new URL('../../node_modules/typescript/lib/tsc.js', import.meta.url));
  await runPackageCommand(process.execPath, [compiler, '--project', join(extension, 'tsconfig.json')], fixture.repository);
  // Act
  await cleanPackageOutputs(fixture.repository);
  // Assert: the real compiler now detects the missing module, with the previous artifact untouched.
  await assert.rejects(runPackageCommand(process.execPath, [compiler, '--project', join(extension, 'tsconfig.json')], fixture.repository), error => error.stdout.includes('Cannot find module'));
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact');
});

test('cleanup refuses a redirected output directory before deleting any other compiler outputs', async context => {
  // Arrange
  const fixture = await sourceFixture(context), foreign = join(fixture.directory, 'foreign'); await mkdir(foreign); await writeFile(join(foreign, 'keep.txt'), 'unrelated');
  await mkdir(join(fixture.repository, 'extension/dist')); await writeFile(join(fixture.repository, 'extension/dist/keep.js'), 'previous');
  await symlink(foreign, join(fixture.repository, 'experiments/cycle-0001/dist'));
  // Act / Assert
  await assert.rejects(cleanPackageOutputs(fixture.repository), /not an owned directory/);
  assert.equal(await readFile(join(foreign, 'keep.txt'), 'utf8'), 'unrelated'); assert.equal(await readFile(join(fixture.repository, 'extension/dist/keep.js'), 'utf8'), 'previous');
});

test('dependency inspection rejects a non-native emitted import before staging a package', async context => {
  // Arrange
  const fixture = await sourceFixture(context), metafile = { inputs: {}, outputs: { bundle: { imports: [{ path: 'bufferutil', external: true }] } } };
  // Act / Assert
  await assert.rejects(inspectBundle(metafile, fixture.repository, new Map()), /unresolved non-native import/);
});

test('a bundled dependency without its license text prevents package staging', async context => {
  // Arrange
  const fixture = await sourceFixture(context), dependency = join(fixture.repository, 'extension/node_modules/example'); await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }));
  const input = join(dependency, 'index.js'), content = Buffer.from('module.exports = 1;'); await writeFile(input, content);
  const metafile = { inputs: { 'extension/node_modules/example/index.js': { bytes: content.length } }, outputs: { bundle: { imports: [] } } };
  // Act / Assert
  await assert.rejects(inspectBundle(metafile, fixture.repository, new Map([[await realpath(input), content]])), /Dependency notice missing/);
});

test('input modification after the bundler read is rejected instead of recording a mismatched hash', async context => {
  // Arrange
  const fixture = await sourceFixture(context), input = join(fixture.repository, 'extension/dist/main.js'); await mkdir(join(fixture.repository, 'extension/dist'));
  await writeFile(input, 'new bytes'); const previous = Buffer.from('old bytes');
  const metafile = { inputs: { 'extension/dist/main.js': { bytes: previous.length } }, outputs: { bundle: { imports: [] } } };
  // Act / Assert
  await assert.rejects(inspectBundle(metafile, fixture.repository, new Map([[await realpath(input), previous]])), /Bundle input changed/);
});

test('every known compilation directory is removed while sources and output artifacts survive', async context => {
  // Arrange
  const fixture = await sourceFixture(context);
  for (const path of COMPILED_DIRECTORIES) { await mkdir(join(fixture.repository, path)); await writeFile(join(fixture.repository, path, 'obsolete.js'), 'stale'); }
  // Act
  await cleanPackageOutputs(fixture.repository);
  // Assert
  for (const path of COMPILED_DIRECTORIES) await assert.rejects(readdir(join(fixture.repository, path)), { code: 'ENOENT' });
  assert.equal(await readFile(join(fixture.repository, 'extension/src/main.ts'), 'utf8'), 'export const source = 1;');
  assert.equal(await readFile(fixture.output, 'utf8'), 'previous good artifact');
});
