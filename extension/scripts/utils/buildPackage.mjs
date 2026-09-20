import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as bundle, version as esbuildVersion } from 'esbuild';
import { readBuildIdentity } from './readBuildIdentity.mjs';
import { cleanPackageOutputs } from './cleanPackageOutputs.mjs';
import { resolvePackageDestination } from './resolvePackageDestination.mjs';
import { inspectBundle } from './inspectBundle.mjs';
import { readVsixEntries } from './readVsixEntries.mjs';
import { REQUIRED_DEMO_FILES, REQUIRED_PACKAGE_FILES, verifyPackageContent } from './verifyPackageContent.mjs';
import { loadBuiltExtension } from './loadBuiltExtension.mjs';
import { withPackageOutput } from './withPackageOutput.mjs';
import { runPackageCommand } from './runPackageCommand.mjs';
import { PACKAGE_MANIFEST_PATH } from './packageConstants.mjs';

/** Clean-builds and validates one self-contained private VSIX before replacing the requested output. @example await buildPackage(repository, '/tmp/codebook.vsix') */
export async function buildPackage(repository, output, runCommand = runPackageCommand) {
  const started = performance.now(), extensionRoot = join(repository, 'extension');
  const destination = await resolvePackageDestination(repository, output), before = await readBuildIdentity(repository);
  return withPackageOutput(destination, async ({ candidate, stage }) => {
    // Source snapshot -> clean compilation -> closed stage -> real archive -> isolated load -> atomic publication.
    await cleanPackageOutputs(repository);
    await runCommand('pnpm', ['--dir', extensionRoot, 'build'], repository);
    assert.deepEqual(await readBuildIdentity(repository), before, 'Source inputs changed during compilation. Retry from a stable checkout.');
    const compiled = await import(pathToFileURL(join(extensionRoot, 'dist/constants.js')).href);
    assert.deepEqual([...compiled.DEMO_ASSET_PATHS].sort(), [...REQUIRED_DEMO_FILES].sort(), 'Runtime and package asset contracts differ.');
    const developmentManifest = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8'));
    assert.equal(compiled.EXTENSION_VERSION, developmentManifest.version, 'Runtime and package versions differ.');
    const build = JSON.parse(await readFile(join(extensionRoot, 'dist/build.json'), 'utf8'));
    assert.deepEqual(build, { ...before, extensionVersion: compiled.EXTENSION_VERSION, apiVersion: compiled.API_VERSION }, 'Compiled metadata does not match package inputs.');
    const capturedInputs = new Map();
    const result = await bundle({ absWorkingDir: repository, entryPoints: ['extension/dist/extension.js'], outfile: join(stage, 'dist/extension.js'), bundle: true,
      platform: 'node', target: 'node24', format: 'cjs', external: ['vscode'], metafile: true, write: false, logLevel: 'silent',
      plugins: [{ name: 'capture-bundle-inputs', setup(builder) { builder.onLoad({ filter: /\.(?:[cm]?js|json)$/, namespace: 'file' }, async ({ path }) => {
        const canonical = await realpath(path), contents = await readFile(canonical); capturedInputs.set(canonical, contents);
        return { contents, loader: path.endsWith('.json') ? 'json' : 'js' };
      }); } }],
      define: { 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' } });
    assert.equal(result.warnings.length, 0, `Bundler warnings: ${JSON.stringify(result.warnings)}`);
    const inventory = await inspectBundle(result.metafile, repository, capturedInputs), files = new Map();
    const installedManifest = { ...developmentManifest };
    for (const key of ['scripts', 'dependencies', 'devDependencies', 'optionalDependencies', 'packageManager']) delete installedManifest[key];
    files.set('package.json', Buffer.from(`${JSON.stringify(installedManifest, null, 2)}\n`));
    files.set('dist/extension.js', Buffer.from(result.outputFiles[0].contents));
    files.set('THIRD_PARTY_NOTICES.md', Buffer.from(`# Bundled dependency notices\n\n${inventory.dependencies.map(dependency => `- ${dependency.name}@${dependency.version} (${dependency.license}): ${dependency.notices.map(notice => `[${notice.sourcePath}](${notice.file})`).join(', ')}`).join('\n')}\n\nThe MCP SDK includes the patch identified in dist/build.json. Codebook remains private software; dependency licenses apply to their respective code.\n`));
    for (const file of REQUIRED_PACKAGE_FILES.filter(file => !files.has(file))) {
      const source = join(extensionRoot, file === 'readme.md' ? 'README.md' : file);
      if (!(await lstat(source)).isFile()) throw new Error(`Package source must be a regular file: ${file}`);
      files.set(file, await readFile(source));
    }
    for (const [file, content] of inventory.noticeFiles) files.set(file, content);
    const manifest = { schemaVersion: 1, extension: { name: installedManifest.name, publisher: installedManifest.publisher, version: installedManifest.version, apiVersion: compiled.API_VERSION }, build,
      tools: { node: process.versions.node, pnpm: developmentManifest.packageManager, esbuild: esbuildVersion, vsce: developmentManifest.devDependencies['@vscode/vsce'] },
      inputs: inventory.inputs, dependencies: inventory.dependencies, externals: inventory.externals,
      files: Object.fromEntries([...files].sort(([left], [right]) => left.localeCompare(right)).map(([file, content]) => [file, { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') }])) };
    files.set(PACKAGE_MANIFEST_PATH, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    for (const [file, content] of files) { const path = join(stage, file); await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); }
    const requireTool = createRequire(import.meta.url), vsce = join(dirname(requireTool.resolve('@vscode/vsce/package.json')), 'vsce');
    await runCommand(process.execPath, [vsce, 'package', '--out', candidate, '--no-dependencies', '--skip-license', '--no-rewrite-relative-links', '--no-gitHubIssueLinking', '--no-gitLabIssueLinking'], stage);
    const entries = await readVsixEntries(candidate), checked = await verifyPackageContent(entries, files);
    const loaded = await loadBuiltExtension(entries);
    assert.deepEqual(await readBuildIdentity(repository), before, 'Source inputs changed during packaging. Retry from a stable checkout.');
    const archiveBytes = await readFile(candidate);
    return { output: destination, sha256: createHash('sha256').update(archiveBytes).digest('hex'), bytes: archiveBytes.length,
      ...checked, ...loaded, dependencies: inventory.dependencies.map(value => `${value.name}@${value.version}`), durationMs: Math.round(performance.now() - started) };
  });
}
