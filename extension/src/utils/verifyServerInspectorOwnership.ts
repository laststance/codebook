import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

import { z } from 'zod'

import { ACTIVE_TIMEOUT_MS } from '../constants'
import type { Cdp } from '../runtimeSupport/cdp'

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

/**
 * Verifies process and thread ownership when {@link launchDevelopmentServer} supplies a native inspector.
 * {@link ConfiguredBrowserRun.selectServer} excludes its background threads before granting control.
 * @param inspector - The proxy for this specific JavaScript target.
 * @param workspace - The opened repository whose canonical path must match the target's cwd.
 * @param processGroup - The process group acquired by the owned development-server launch.
 * @param signal - Revokes verification when that launch is abandoned.
 * @param assertRunning - Rechecks launch ownership around asynchronous replies.
 * @returns Owned PID, process group and canonical repository, plus Node's thread identity; threadId is not a DAP thread id.
 * @throws When a reply is malformed, the process/repository is foreign, or the launch is no longer owned.
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
  const { stdout } = await promisify(execFile)(
    'ps',
    ['-o', 'pgid=', '-p', String(identity.pid)],
    { signal, timeout: ACTIVE_TIMEOUT_MS },
  )
  if (!/^\s*\d+\s*$/.test(stdout) || Number(stdout.trim()) !== processGroup)
    throw new Error('Server inspector belongs to a different process group')
  // Workers inherit the launch marker and share the PID; identify the JavaScript target separately.
  const threadResponse = await inspector.request('Runtime.evaluate', {
    expression:
      '(() => { const threads = typeof process.getBuiltinModule === "function" ? process.getBuiltinModule("node:worker_threads") : (typeof require === "function" ? require("node:worker_threads") : undefined); return {isMainThread:threads?.isMainThread,threadId:threads?.threadId}; })()',
    returnByValue: true,
  })
  signal.throwIfAborted()
  assertRunning()
  if (threadResponse.exceptionDetails)
    throw new Error('Server inspector thread evaluation failed')
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
