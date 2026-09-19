import { spawn, execFileSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readHostInstallation } from '../../cycle-0001/dist/utils/readHostInstallation.js';
import { selectHost } from '../../cycle-0001/dist/utils/selectHost.js';
import { sha256 } from '../../cycle-0001/dist/utils/sha256.js';

// One foreground launcher owns one isolated editor/profile; the bootstrap owns its app and Chrome lifetimes.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), workspace = resolve(packageRoot, '../..');
const installation = await readHostInstallation(selectHost(process.env.CODEBOOK_HOST));
const directory = join(workspace, 'artifacts/cycle-0010/native', installation.host.id, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
const profile = await mkdtemp('/tmp/codebook-repository-');
await mkdir(directory, { recursive: true, mode: 0o700 }); await mkdir(join(profile, 'User'), { recursive: true, mode: 0o700 });
await writeFile(join(profile, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'debug.openDebug': 'neverOpen', 'workbench.enableExperiments': false, 'workbench.editor.restoreViewState': true }), { mode: 0o600 });
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
const inventory = execFileSync('rg', ['--files', 'experiments/cycle-0010/src', 'experiments/cycle-0001/src'], { cwd: workspace, encoding: 'utf8' }).trim().split('\n').sort();
const sources = await Promise.all(inventory.map(async path => ({ path, hash: sha256(await readFile(join(workspace, path))) })));
const config = { directory, target: join(workspace, 'artifacts/cycle-0010/target/laststance.io'), node: process.execPath, revision, sourceFingerprint: sha256(JSON.stringify(sources)), host: { ...installation.host, browserBackend: 'managed', chrome: { binary: chrome, version: execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim() } } };
await writeFile(join(directory, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
await writeFile(join(directory, 'sources.json'), JSON.stringify(sources, null, 2), { mode: 0o600 });
await writeFile(join(directory, 'command.json'), JSON.stringify({ sequence: 0, action: 'inspect' }), { mode: 0o600 });
const arguments_ = ['--new-window', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', ...(installation.host.id === 'cursor' ? ['--skip-onboarding'] : []), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir', profile, '--extensions-dir', join(directory, 'extensions'), '--extensionDevelopmentPath', packageRoot, '--extensionTestsPath', join(packageRoot, 'dist/nativeBootstrap.js'), workspace];
const output = openSync(join(directory, 'native.log'), 'w', 0o600);
const child = spawn(installation.binaryPath, arguments_, { env: { ...process.env, VSCODE_CLI: '1', CODEBOOK_REAL_REPOSITORY_SESSION: directory }, stdio: ['ignore', output, output] }); closeSync(output);
// Observe startup failure before metadata I/O yields; attach rejection handling immediately as well.
const exited = new Promise((resolveExit, reject) => { child.once('exit', resolveExit); child.once('error', reject); });
void exited.catch(() => undefined);
await writeFile(join(directory, 'launch.json'), JSON.stringify({ ...config, profile, pid: child.pid, executable: installation.binaryPath, arguments: arguments_, cliVersion: installation.cliVersion }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ directory, profile, pid: child.pid, host: config.host }));
const exitCode = await exited;
await writeFile(join(directory, 'exit.json'), JSON.stringify({ exitCode })); console.log(JSON.stringify({ directory, exitCode })); process.exitCode = exitCode ?? 1;
