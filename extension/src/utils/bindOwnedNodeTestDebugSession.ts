import type * as vscode from 'vscode'
import { z } from 'zod'

import { Cdp } from '../runtimeSupport/cdp'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'

import { verifyNodeTestInspectorOwnership } from './verifyNodeTestInspectorOwnership'

const proxySchema = z.strictObject({
  host: z.enum(['127.0.0.1', 'localhost', '::1']),
  port: z.number().int().min(1).max(65_535),
  path: z.string().startsWith('/').max(512),
})

/** Binds a tracked native JavaScript debug session to this run's live Vitest worker before accepting its DAP state. Called after the owned attach starts and its session is observed. @param session - Tracker-observed root or descendant session. @param runId - Current Codebook run identity. @param workingDirectory - Canonical folder the owned Vitest was started in (its Vitest root). @param processGroup - Owned Vitest launch group. @param signal - Run cancellation. @param assertActive - Rejects a terminated or foreign session. @example const bound = await bindOwnedNodeTestDebugSession(session, runId, launch.vitestRoot, group, signal, assertActive); bound.cdp.close() */
export async function bindOwnedNodeTestDebugSession(
  session: vscode.DebugSession,
  runId: string,
  workingDirectory: string,
  processGroup: number,
  signal: AbortSignal,
  assertActive: (sessionId: string) => void,
): Promise<{
  session: vscode.DebugSession
  cdp: Cdp
  identity: Awaited<ReturnType<typeof verifyNodeTestInspectorOwnership>>
}> {
  const rootName = `codebook node test ${runId}`
  let ownedRoot = false
  for (
    let ancestor: vscode.DebugSession | undefined = session;
    ancestor;
    ancestor = ancestor.parentSession
  ) {
    if (
      ancestor.configuration.name === rootName &&
      ancestor.configuration.type === 'pwa-node' &&
      ancestor.configuration.request === 'attach'
    )
      ownedRoot = true
  }
  if (!ownedRoot)
    throw new Error('Node test debugger session does not belong to this run.')
  signal.throwIfAborted()
  assertActive(session.id)
  const proxy = proxySchema.parse(
    await awaitResponse(
      session.customRequest('requestCDPProxy'),
      'owned Node test debugger proxy',
      signal,
    ),
  )
  signal.throwIfAborted()
  assertActive(session.id)
  const host = proxy.host === '::1' ? '[::1]' : proxy.host
  const cdp = await Cdp.connect(
    `ws://${host}:${proxy.port}${proxy.path}`,
    () => undefined,
  )
  try {
    const identity = await verifyNodeTestInspectorOwnership(
      cdp,
      workingDirectory,
      processGroup,
      signal,
      () => assertActive(session.id),
    )
    return { session, cdp, identity }
  } catch (error) {
    cdp.close()
    throw error
  }
}
