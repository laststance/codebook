import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { NODE_TEST_HISTORY_LIMIT_BYTES, REPOSITORY_RUN_TIMEOUT_MS } from '../constants';
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint';
import { waitUntil } from '../runtimeSupport/utils/waitUntil';
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse';
import type { PreparedNodeTestLaunch } from './prepareNodeTestLaunch';

const OUTPUT_LIMIT_BYTES = 32_768;
const OUTPUT_EVENT_LIMIT_CHARS = 4_096;
const INSPECTOR_READY_TIMEOUT_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
export type NodeTestOutputEvent = { sequence: number; elapsedMs: number; channel: 'stdout' | 'stderr'; text: string };

/** Reserves a local port only while choosing one; the later Inspector identity must still be checked against the owned process group. @example const port = await availableInspectorPort() */
async function availableInspectorPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Node test inspector did not acquire a loopback port.');
  return address.port;
}

/** Starts exactly the sealed Vitest file in an owned process group before native debugger attachment. Called by the Node test runtime after source verification. @param launch - Checked in-repository program and argv. @param node - External Node executable. @param record - Bounded process event sink. @example const testRun = await launchNodeTest(launch, '/usr/bin/node', record); await testRun.inspectorEndpoint(signal) */
export async function launchNodeTest(launch: PreparedNodeTestLaunch, node: string, record: (type: string, detail?: unknown) => unknown,
  onOutput?: (event: NodeTestOutputEvent) => void | Promise<void>) {
  const started = process.hrtime.bigint();
  const port = await availableInspectorPort();
  const args = launch.args.map(argument => argument === '--inspect-brk' ? `--inspect-brk=${port}` : argument);
  if (args.filter(argument => argument === `--inspect-brk=${port}`).length !== 1) throw new Error('Node test launch has no single Inspector pause.');
  const environment: NodeJS.ProcessEnv = { CI: 'true', NODE_ENV: 'test' };
  // The owned test receives basic process settings without inheriting unrelated account credentials.
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'PNPM_HOME', 'USER', 'LOGNAME']) if (process.env[name]) environment[name] = process.env[name];
  const child = spawn(node, [launch.program, ...args], { cwd: launch.workspace, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', announcement = '', error: Error | undefined, exited = false, closing: Promise<void> | undefined, outputSequence = 0;
  let outputWrites = Promise.resolve(), pendingOutputBytes = 0;
  const exit = new Promise<void>(resolve => child.once('close', () => { exited = true; resolve(); }));
  child.once('error', cause => { error = cause; });
  for (const [channel, stream] of [['stdout', child.stdout], ['stderr', child.stderr]] as const) {
    const decoder = new StringDecoder('utf8');
    const enqueue = (text: string, deliver: (event: NodeTestOutputEvent) => void | Promise<void>) => {
      const bytes = Buffer.byteLength(text);
      // Output beyond the durable history's capacity can never be saved; fail capture instead of buffering it behind slow history writes.
      if (pendingOutputBytes + bytes > NODE_TEST_HISTORY_LIMIT_BYTES) {
        error = new Error('Node test output capture failed: output outpaced its durable history beyond the history size limit.');
        return;
      }
      pendingOutputBytes += bytes;
      const event = { sequence: ++outputSequence, elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000, channel, text };
      outputWrites = outputWrites.then(() => error ? undefined : deliver(event)).catch(cause => { error = new Error(`Node test output capture failed: ${String(cause)}`); })
        .finally(() => { pendingOutputBytes -= bytes; });
    };
    const accept = (text: string) => {
      if (!text) return;
      // Keep the initial Inspector announcement and the final bounded test result separately.
      if (Buffer.byteLength(announcement) < OUTPUT_LIMIT_BYTES) announcement = Buffer.from(announcement + text).subarray(0, OUTPUT_LIMIT_BYTES).toString('utf8');
      output = Buffer.from(output + text).subarray(-OUTPUT_LIMIT_BYTES).toString('utf8');
      if (!onOutput || error) return;
      let part = '';
      for (const character of text) {
        if (part.length + character.length > OUTPUT_EVENT_LIMIT_CHARS) {
          enqueue(part, onOutput);
          if (error) return;
          part = '';
        }
        part += character;
      }
      if (part) enqueue(part, onOutput);
    };
    stream.on('data', (chunk: Buffer) => accept(decoder.write(chunk)));
    stream.on('end', () => accept(decoder.end()));
  }
  record('node-test.started', { pid: child.pid, port, program: launch.program, args, cwd: launch.workspace, secretEnvironmentInherited: false });
  return {
    pid: child.pid,
    processGroup: child.pid,
    elapsedMs: () => Number(process.hrtime.bigint() - started) / 1_000_000,
    output: () => output,
    /** Waits for the launched test command's actual exit before sealing its output result. @example const result = await testRun.result(signal) */
    async result(signal: AbortSignal): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; output: string }> {
      // The rest of the test file runs after the final continuation, so only cancellation and the owned run deadline bound it.
      await awaitResponse(exit, 'owned Node test result', signal, REPOSITORY_RUN_TIMEOUT_MS);
      await outputWrites;
      if (error) throw error;
      return { exitCode: child.exitCode, signal: child.signalCode, output };
    },
    /** Waits for this process's complete Inspector announcement, never guessing an endpoint from a partial chunk. @example await testRun.inspectorEndpoint(signal) */
    async inspectorEndpoint(signal: AbortSignal): Promise<string> {
      return waitUntil(() => {
        if (error || exited) throw error ?? new Error(`Node test exited before debugger attachment: ${child.exitCode}`);
        const endpoint = readNodeInspectorEndpoint(announcement);
        if (!endpoint) return undefined;
        if (Number(new URL(endpoint).port) !== port) throw new Error('Node test announced a foreign Inspector port.');
        return endpoint;
      }, 'owned Node test inspector announcement', INSPECTOR_READY_TIMEOUT_MS, signal);
    },
    /** Releases the entire owned test process group, including a paused worker, after success or failure. @example await testRun.close() */
    async close(): Promise<void> {
      closing ??= (async () => {
        if (!child.pid) { await exit; await outputWrites; return; }
        try { process.kill(-child.pid, 'SIGTERM'); } catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH')) throw cause; }
        const groupGone = () => {
          try { process.kill(-child.pid!, 0); return false; }
          catch (cause) { if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH') return true; throw cause; }
        };
        const waitForRelease = async () => {
          await awaitResponse(exit, 'owned Node test exit', undefined, SHUTDOWN_TIMEOUT_MS);
          await waitUntil(groupGone, 'owned Node test process group exit', SHUTDOWN_TIMEOUT_MS);
        };
        // A test worker may outlive the launcher, so escalation covers its whole owned group.
        try { await waitForRelease(); }
        catch {
          try { process.kill(-child.pid, 'SIGKILL'); }
          catch (cause) { if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ESRCH')) throw cause; }
          await waitForRelease();
        }
        await outputWrites;
        record('node-test.closed', { pid: child.pid, exitCode: child.exitCode, signal: child.signalCode });
      })();
      await closing;
    },
  };
}
