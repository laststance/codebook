import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

import { z } from 'zod'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import type { Cdp } from '../runtimeSupport/cdp'

import { psProgramPath } from './psProgramPath'

const workerIdentitySchema = z.strictObject({
  pid: z.number().int().positive(),
  cwd: z.string().min(1),
  worker: z.literal('1'),
})
const threadIdentitySchema = z
  .strictObject({
    isMainThread: z.boolean(),
    threadId: z.number().int().nonnegative(),
  })
  .refine((identity) => identity.isMainThread === (identity.threadId === 0), {
    message: 'Server inspector thread identity is inconsistent',
  })
/** The answer of {@link THREAD_IDENTITY_PROBE} on a Node.js that offers the inspector no loader of a built-in module: its release, as `process.version` prints it. */
const unreadableThreadSchema = z.strictObject({
  nodeVersion: z.string().regex(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/),
})

/**
 * The evaluation that asks a server inspector which JavaScript thread it is, from `node:worker_threads`. The module is loaded by `process.getBuiltinModule` (Node.js 20.16 and 22.3 on), else by the `require` that Node.js adds to the console scope of an evaluation with `includeCommandLineAPI`: an evaluation runs in the global scope, where a dev server's own code has no `require`. A Node.js that offers neither is answered with its release, which the refusal names.
 */
const THREAD_IDENTITY_PROBE =
  '(() => { const threads = typeof process.getBuiltinModule === "function" ? process.getBuiltinModule("node:worker_threads") : (typeof require === "function" ? require("node:worker_threads") : undefined); return threads === undefined ? {nodeVersion:process.version} : {isMainThread:threads.isMainThread,threadId:threads.threadId}; })()'

/**
 * Verifies process and thread ownership when {@link launchDevelopmentServer} supplies a native inspector.
 * {@link ConfiguredBrowserRun.selectServer} excludes its background threads before granting control.
 * @param inspector - The proxy for this specific JavaScript target.
 * @param workspace - The opened repository whose canonical path must match the target's cwd.
 * @param processGroup - The process group acquired by the owned development-server launch.
 * @param signal - Revokes verification when that launch is abandoned.
 * @param assertRunning - Rechecks launch ownership around asynchronous replies.
 * @returns Owned PID, process group and canonical repository, plus Node's thread identity; threadId is not a DAP thread id.
 * @throws When a reply is malformed, the process/repository is foreign, the launch is no longer owned, no `ps` lies at an absolute path of {@link psProgramPath}, or the target's Node.js offers the inspector no loader of `node:worker_threads` (the refusal names its release; {@link THREAD_IDENTITY_PROBE}).
 * @example await verifyServerInspectorOwnership(cdp, target, app.pid, signal, assertRunning)
 */
export async function verifyServerInspectorOwnership(
  inspector: Pick<Cdp, 'request'>,
  workspace: string,
  processGroup: number,
  signal: AbortSignal,
  assertRunning: () => void,
) {
  signal.throwIfAborted()
  assertRunning()
  if (!Number.isSafeInteger(processGroup) || processGroup <= 0)
    throw new Error('Owned server process group is unavailable')
  const response = await inspector.request('Runtime.evaluate', {
    expression:
      '({pid:process.pid,cwd:process.cwd(),worker:process.env.NEXT_PRIVATE_WORKER})',
    returnByValue: true,
  })
  signal.throwIfAborted()
  assertRunning()
  if (response.exceptionDetails)
    throw new Error('Server inspector identity evaluation failed')
  const identity = workerIdentitySchema.parse(response.result.value)
  const [actualWorkspace, expectedWorkspace] = await Promise.all([
    realpath(identity.cwd),
    realpath(workspace),
  ])
  if (actualWorkspace !== expectedWorkspace)
    throw new Error('Server inspector belongs to a different repository')
  // Process arguments are separate and the inspector-supplied PID must first pass integer validation.
  // ps is started by its absolute path: one of the search path could be the opened repository's own.
  const { stdout } = await promisify(execFile)(
    await psProgramPath('The process group check of the server inspector'),
    ['-o', 'pgid=', '-p', String(identity.pid)],
    { signal, timeout: ACTIVE_TIMEOUT_MS },
  )
  if (!/^\s*\d+\s*$/.test(stdout) || Number(stdout.trim()) !== processGroup)
    throw new Error('Server inspector belongs to a different process group')
  // Workers inherit the launch marker and share the PID; identify the JavaScript target separately.
  // The console scope's require is the loader on a Node.js before process.getBuiltinModule.
  const threadResponse = await inspector.request('Runtime.evaluate', {
    expression: THREAD_IDENTITY_PROBE,
    includeCommandLineAPI: true,
    returnByValue: true,
  })
  signal.throwIfAborted()
  assertRunning()
  if (threadResponse.exceptionDetails)
    throw new Error('Server inspector thread evaluation failed')
  const unreadable = unreadableThreadSchema.safeParse(
    threadResponse.result.value,
  )
  // A Node.js that could load no module names its release, so the refusal says which one it is.
  if (unreadable.success)
    throw new Error(
      `Server inspector cannot name its thread on Node.js ${unreadable.data.nodeVersion}: neither process.getBuiltinModule nor require is offered to the inspector`,
    )
  const thread = threadIdentitySchema.parse(threadResponse.result.value)
  signal.throwIfAborted()
  assertRunning()
  return {
    pid: identity.pid,
    processGroup,
    workspace: actualWorkspace,
    ...thread,
  }
}
