import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { readHostInstallation } from '../cycle-0001/dist/utils/readHostInstallation.js';
import { waitUntil } from '../cycle-0001/dist/utils/waitUntil.js';
import { awaitResponse } from '../cycle-0001/dist/utils/awaitResponse.js';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repo = resolve(packageRoot, '../..');
const runId = randomUUID();
const directory = join(repo, 'artifacts/cycle-0003', `native-cursor-${new Date().toISOString().replaceAll(':', '-')}`);
const workspace = join(directory, 'workspace');
await mkdir(workspace, { recursive: true });
const fixture = `<!doctype html><html lang="en" data-probe="${runId}"><meta charset="utf-8"><title>codebook scoped probe</title><style>body{font:20px system-ui;background:#edf4ef;padding:48px;color:#18312c}main{padding:32px;background:white;border-radius:18px}</style><main><h1>Scoped browser probe</h1><p>Owned fixture: ${runId}</p><p>This page verifies the native command boundary only.</p></main></html>`;
const server = createServer((request, response) => {
  if (request.url !== `/runs/${runId}`) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); response.end(fixture);
});
let child;
let exit;
const abort = new AbortController();
const teardown = {};
try {
  const installation = await readHostInstallation('cursor');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/runs/${runId}`;
  await writeFile(join(workspace, 'probe.json'), JSON.stringify({ runId, directory, url }));
  const runtime = await mkdtemp('/tmp/codebook-scope-');
  const args = ['--new-window', '--skip-welcome', '--skip-release-notes', '--skip-onboarding', '--disable-workspace-trust', '--user-data-dir', join(runtime, 'profile'), '--extensions-dir', join(runtime, 'extensions'), '--extensionDevelopmentPath', packageRoot, workspace];
  const vendorRoot = join(dirname(dirname(installation.binaryPath)), 'Resources/app');
  const sourceHashes = {};
  for (const name of ['out/main.js', 'out/vs/workbench/workbench.desktop.main.js', 'extensions/cursor-browser-automation/dist/extension.js']) sourceHashes[name] = createHash('sha256').update(await readFile(join(vendorRoot, name))).digest('hex');
  const probeHashes = {};
  for (const name of ['extension.cjs', 'runner.mjs', 'package.json']) probeHashes[name] = createHash('sha256').update(await readFile(join(packageRoot, name))).digest('hex');
  await writeFile(join(directory, 'environment.json'), JSON.stringify({ runId, host: installation.host, binary: installation.binaryPath, args, editorRemoteDebugging: false, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), probeHashes, vendorSourceHashes: sourceHashes }, null, 2));
  const output = openSync(join(directory, 'editor.log'), 'w');
  child = spawn(installation.binaryPath, args, { env: { ...process.env, VSCODE_CLI: '1' }, stdio: ['ignore', output, output] });
  closeSync(output);
  exit = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  child.once('error', error => abort.abort(error));
  child.once('exit', () => abort.abort(new Error('Owned Cursor exited before probe completion')));
  const result = await waitUntil(async () => { try { return JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')); } catch { return undefined; } }, 'native command probe result', 120_000, abort.signal);
  assert.equal(result.outcome, 'observed');
  assert.equal(result.cleanupVerified, true);
  console.log(JSON.stringify({ directory, result }, null, 2));
} catch (error) { process.exitCode = 1; teardown.error = String(error); console.error(error); }
finally {
  server.closeAllConnections(); server.close();
  child?.kill();
  try { if (exit) await awaitResponse(exit, 'owned Cursor exit'); teardown.ownedProcessExited = Boolean(child?.pid); }
  catch (error) { teardown.exitError = String(error); process.exitCode = 1; }
  await writeFile(join(directory, 'teardown.json'), JSON.stringify(teardown, null, 2));
  console.log(`Evidence: ${directory}`);
}
