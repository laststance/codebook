import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cdp } from '../runtimeSupport/cdp';
import type * as vscode from 'vscode';
import { bindOwnedNodeTestDebugSession } from '../utils/bindOwnedNodeTestDebugSession';
import { launchNodeTest, type NodeTestOutputEvent } from '../utils/launchNodeTest';
import { verifyNodeTestInspectorOwnership } from '../utils/verifyNodeTestInspectorOwnership';

test('an owned Node test announces its own loopback debugger and releases the paused process', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-owned-node-test-'));
  const program = join(workspace, 'runner.cjs');
  await writeFile(program, "const inspector = require('node:inspector'); const port = Number(process.argv.find(value => value.startsWith('--inspect-brk='))?.split('=')[1]); inspector.open(port, '127.0.0.1'); setInterval(() => {}, 1000);\n");
  const events: string[] = [];
  const launch = { workspace, program, sourceFile: program, testFile: program, stops: [], args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'] };
  const owned = await launchNodeTest(launch, process.execPath, type => events.push(type));
  let inspector: Cdp | undefined;
  let boundDebugger: Awaited<ReturnType<typeof bindOwnedNodeTestDebugSession>> | undefined;
  try {
    // Act
    const endpoint = await owned.inspectorEndpoint(AbortSignal.timeout(10_000));
    inspector = await Cdp.connect(endpoint, () => undefined);
    const identity = await verifyNodeTestInspectorOwnership(inspector, workspace, owned.processGroup!, AbortSignal.timeout(10_000), () => undefined);
    const debuggerUrl = new URL(endpoint);
    const session = { id: 'owned-session', configuration: { name: 'codebook node test observed-run', type: 'pwa-node', request: 'attach' },
      customRequest: async () => ({ host: debuggerUrl.hostname, port: Number(debuggerUrl.port), path: debuggerUrl.pathname }) } as unknown as vscode.DebugSession;
    boundDebugger = await bindOwnedNodeTestDebugSession(session, 'observed-run', workspace, owned.processGroup!, AbortSignal.timeout(10_000), sessionId => assert.equal(sessionId, 'owned-session'));
    // Assert
    assert.match(endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/[a-f\d-]{36}$/i);
    assert.ok(owned.pid && owned.pid > 0);
    assert.equal(identity.pid, owned.pid);
    assert.equal(boundDebugger.identity.pid, owned.pid);
    await assert.rejects(bindOwnedNodeTestDebugSession(session, 'another-run', workspace, owned.processGroup!, AbortSignal.timeout(10_000), () => undefined), /does not belong/);
    await assert.rejects(bindOwnedNodeTestDebugSession(session, 'observed-run', workspace, owned.processGroup! + 1, AbortSignal.timeout(10_000), () => undefined), /different process group/);
    await assert.rejects(bindOwnedNodeTestDebugSession(session, 'observed-run', workspace, owned.processGroup!, AbortSignal.timeout(10_000), () => { throw new Error('Session terminated'); }), /Session terminated/);
    await assert.rejects(verifyNodeTestInspectorOwnership(inspector, workspace, owned.processGroup! + 1, AbortSignal.timeout(10_000), () => undefined), /different process group/);
    assert.deepEqual(events, ['node-test.started']);
  } finally {
    boundDebugger?.cdp.close();
    inspector?.close();
    await owned.close();
    await rm(workspace, { recursive: true, force: true });
  }
  assert.deepEqual(events, ['node-test.started', 'node-test.closed']);
});

test('a Node test that exits before inspection reports the failure and still cleans up', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-exiting-node-test-'));
  const program = join(workspace, 'runner.cjs');
  await writeFile(program, 'process.exit(7)\n');
  const launch = { workspace, program, sourceFile: program, testFile: program, stops: [], args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'] };
  const owned = await launchNodeTest(launch, process.execPath, () => undefined);
  try {
    // Act / Assert
    await assert.rejects(owned.inspectorEndpoint(AbortSignal.timeout(10_000)), /exited before debugger attachment/);
  } finally {
    await owned.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a Node test reports its final exit and output after a long log', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-result-'));
  const program = join(workspace, 'runner.cjs');
  await writeFile(program, "process.stdout.write('x'.repeat(40000)); process.stdout.write('\\n9 tests passed\\n'); process.exitCode = 0;\n");
  const launch = { workspace, program, sourceFile: program, testFile: program, stops: [], args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'] };
  const outputEvents: NodeTestOutputEvent[] = [];
  const owned = await launchNodeTest(launch, process.execPath, () => undefined, event => { outputEvents.push(event); });
  try {
    // Act
    const result = await owned.result(AbortSignal.timeout(10_000));
    // Assert
    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.ok(Buffer.byteLength(result.output) <= 32_768);
    assert.match(result.output, /9 tests passed\n$/);
    assert.ok(outputEvents.length > 1);
    assert.ok(outputEvents.every(event => event.channel === 'stdout' && event.text.length <= 4_096));
    assert.deepEqual(outputEvents.map(event => event.sequence), outputEvents.map((_, index) => index + 1));
    assert.ok(outputEvents.every((event, index) => event.elapsedMs >= (outputEvents[index - 1]?.elapsedMs ?? 0)));
    assert.match(outputEvents.map(event => event.text).join(''), /9 tests passed\n$/);
  } finally {
    await owned.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a Node test reports stdout and stderr separately with valid Unicode text', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-channels-'));
  const program = join(workspace, 'runner.cjs');
  await writeFile(program, "process.stdout.write('準備完了\\n'); process.stderr.write('failed assertion\\n'); process.exitCode = 1;\n");
  const launch = { workspace, program, sourceFile: program, testFile: program, stops: [], args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'] };
  const outputEvents: NodeTestOutputEvent[] = [];
  const owned = await launchNodeTest(launch, process.execPath, () => undefined, event => { outputEvents.push(event); });
  try {
    // Act
    const result = await owned.result(AbortSignal.timeout(10_000));
    // Assert
    assert.equal(result.exitCode, 1);
    assert.equal(outputEvents.filter(event => event.channel === 'stdout').map(event => event.text).join(''), '準備完了\n');
    assert.equal(outputEvents.filter(event => event.channel === 'stderr').map(event => event.text).join(''), 'failed assertion\n');
  } finally {
    await owned.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('a failed Node output observer refuses capture and releases its process', async () => {
  // Arrange
  const workspace = await mkdtemp(join(tmpdir(), 'codebook-node-output-failure-'));
  const program = join(workspace, 'runner.cjs');
  await writeFile(program, "process.stdout.write('test output'); setInterval(() => {}, 1000);\n");
  const launch = { workspace, program, sourceFile: program, testFile: program, stops: [], args: ['run', 'src/test.test.ts', '--inspect-brk', '--no-file-parallelism'] };
  const owned = await launchNodeTest(launch, process.execPath, () => undefined, () => { throw new Error('recording unavailable'); });
  try {
    // Act / Assert
    await assert.rejects(owned.inspectorEndpoint(AbortSignal.timeout(10_000)), /Node test output capture failed: Error: recording unavailable/);
  } finally {
    await owned.close();
    await rm(workspace, { recursive: true, force: true });
  }
});
