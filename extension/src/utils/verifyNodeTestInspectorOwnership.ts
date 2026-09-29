import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Cdp } from '../runtimeSupport/cdp';

const inspectorIdentitySchema = z.strictObject({ pid: z.number().int().positive(), cwd: z.string().min(1) });

/** Binds a Vitest worker Inspector to the owned test group and opened checkout before debugger control. Called after its loopback announcement. @param inspector - Connected Inspector protocol. @param workspace - Canonical opened checkout. @param processGroup - Owned detached launch group. @param signal - Preparation cancellation. @param assertRunning - Current process ownership check. @example await verifyNodeTestInspectorOwnership(cdp, root, launch.processGroup!, signal, assertRunning) */
export async function verifyNodeTestInspectorOwnership(inspector: Pick<Cdp, 'request'>, workspace: string, processGroup: number, signal: AbortSignal, assertRunning: () => void) {
  signal.throwIfAborted(); assertRunning();
  if (!Number.isSafeInteger(processGroup) || processGroup <= 0) throw new Error('Owned Node test process group is unavailable.');
  const response = await inspector.request('Runtime.evaluate', { expression: '({pid:process.pid,cwd:process.cwd()})', returnByValue: true });
  signal.throwIfAborted(); assertRunning();
  if (response.exceptionDetails) throw new Error('Node test Inspector identity evaluation failed.');
  const identity = inspectorIdentitySchema.parse(response.result.value);
  const [actualWorkspace, expectedWorkspace] = await Promise.all([realpath(identity.cwd), realpath(workspace)]);
  if (actualWorkspace !== expectedWorkspace) throw new Error('Node test Inspector belongs to a different repository.');
  const { stdout } = await promisify(execFile)('ps', ['-o', 'pgid=', '-p', String(identity.pid)], { signal, timeout: 5_000 });
  if (!/^\s*\d+\s*$/.test(stdout) || Number(stdout.trim()) !== processGroup) throw new Error('Node test Inspector belongs to a different process group.');
  signal.throwIfAborted(); assertRunning();
  return { pid: identity.pid, processGroup, workspace: actualWorkspace };
}
