import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

import { z } from 'zod'

import type { Cdp } from '../runtimeSupport/cdp'

import { psProgramPath } from './psProgramPath'

const inspectorIdentitySchema = z.strictObject({
  pid: z.number().int().positive(),
  cwd: z.string().min(1),
})

/** Binds a Vitest worker Inspector to the owned test group and the folder the owned Vitest was started in before debugger control. Called after its loopback announcement. @param inspector - Connected Inspector protocol. @param workingDirectory - Canonical folder the owned Vitest was started in: the test's Vitest root, which is the opened checkout in root mode (a worker inherits it as its `process.cwd()`). @param processGroup - Owned detached launch group. @param signal - Preparation cancellation. @param assertRunning - Current process ownership check. @example await verifyNodeTestInspectorOwnership(cdp, launch.vitestRoot, launch.processGroup!, signal, assertRunning) */
export async function verifyNodeTestInspectorOwnership(
  inspector: Pick<Cdp, 'request'>,
  workingDirectory: string,
  processGroup: number,
  signal: AbortSignal,
  assertRunning: () => void,
) {
  signal.throwIfAborted()
  assertRunning()
  if (!Number.isSafeInteger(processGroup) || processGroup <= 0)
    throw new Error('Owned Node test process group is unavailable.')
  const response = await inspector.request('Runtime.evaluate', {
    expression: '({pid:process.pid,cwd:process.cwd()})',
    returnByValue: true,
  })
  signal.throwIfAborted()
  assertRunning()
  if (response.exceptionDetails)
    throw new Error('Node test Inspector identity evaluation failed.')
  const identity = inspectorIdentitySchema.parse(response.result.value)
  const [actualDirectory, expectedDirectory] = await Promise.all([
    realpath(identity.cwd),
    realpath(workingDirectory),
  ])
  if (actualDirectory !== expectedDirectory)
    throw new Error('Node test Inspector belongs to a different repository.')
  // ps is started by its absolute path: one of the search path could be the opened repository's own.
  const { stdout } = await promisify(execFile)(
    await psProgramPath('The process group check of the Node test Inspector'),
    ['-o', 'pgid=', '-p', String(identity.pid)],
    { signal, timeout: 5_000 },
  )
  if (!/^\s*\d+\s*$/.test(stdout) || Number(stdout.trim()) !== processGroup)
    throw new Error('Node test Inspector belongs to a different process group.')
  signal.throwIfAborted()
  assertRunning()
  // `workspace` names the worker's real working directory, the Vitest root it was started in.
  return { pid: identity.pid, processGroup, workspace: actualDirectory }
}
