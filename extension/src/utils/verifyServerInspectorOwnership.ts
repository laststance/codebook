import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { Cdp } from '../runtimeSupport/cdp'
import { ACTIVE_TIMEOUT_MS } from '../constants'

const workerIdentitySchema = z.strictObject({
  pid: z.number().int().positive(),
  cwd: z.string().min(1),
  worker: z.literal('1'),
})

/** Verifies the inspector selected by {@link launchDevelopmentServer} before native runtime control; an announcement alone grants no ownership. @example await verifyServerInspectorOwnership(cdp, target, app.pid, signal, assertRunning) */
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
  signal.throwIfAborted()
  assertRunning()
  return { pid: identity.pid, processGroup, workspace: actualWorkspace }
}
