import { connect } from 'node:net'

import type {
  createOwnedNodeServerRun,
  NodeServerRunDependencies,
} from '../../ownedNodeServerRun'
import { assertNodeServerPortFree } from '../../utils/assertNodeServerPortFree'
import { findPortOccupant } from '../../utils/findPortOccupant'
import { forgetNodeServerProcess } from '../../utils/forgetNodeServerProcess'
import { isProcessGroupGone } from '../../utils/isProcessGroupGone'
import { launchNodeServer } from '../../utils/launchNodeServer'
import { readConnectionServerPid } from '../../utils/readConnectionServerPid'
import { readListeningPortsOfProcess } from '../../utils/readListeningPortsOfProcess'
import { readProcessCwd } from '../../utils/readProcessCwd'
import { readProcessStart } from '../../utils/readProcessStart'
import { rememberNodeServerProcess } from '../../utils/rememberNodeServerProcess'
import { resolveNodeServerLaunch } from '../../utils/resolveNodeServerLaunch'
import { resolveNodeServerStops } from '../../utils/resolveNodeServerStops'
import { sendDeclaredRequest } from '../../utils/sendDeclaredRequest'
import { signalProcessGroup } from '../../utils/signalProcessGroup'
import { REAL_DEADLINE_TIMERS } from '../../utils/slotDeadline'
import { verifyListenerOwnership } from '../../utils/verifyListenerOwnership'
import { waitForServerReadiness } from '../../utils/waitForServerReadiness'

import { createCdpNodeServerDebugger } from './cdpNodeServerDebugger'

/** Says whether something accepts connections on a loopback port now. */
export async function accepts(port: number): Promise<boolean> {
  const socket = connect({ host: '127.0.0.1', port })
  return new Promise((resolve) => {
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Every dependency of a real node-server run: the product's real launcher, readiness, listener, request and orphan-record utilities (part U) and the CDP debugger stand-in, with orphan records kept in an in-memory store.
 * Real-process tests pass the result to {@link createOwnedNodeServerRun}; the fixture-server and pinned-clone tests differ only in the node they run.
 * @param node - The node executable and its version the server runs under.
 * @param giveUpMs - Ends the readiness wait early for a not-listening test, which would otherwise wait the real 30 s of running time.
 * @param orphanStore - Where the orphan records of started processes are kept.
 * @returns The dependencies for {@link createOwnedNodeServerRun}.
 * @example createOwnedNodeServerRun({ ..., dependencies: realNodeServerDependencies({ executable: process.execPath, version: process.versions.node }, 20_000, new Map()) })
 */
export function realNodeServerDependencies(
  node: NodeServerRunDependencies['node'],
  giveUpMs: number,
  orphanStore: Map<string, unknown>,
): NodeServerRunDependencies {
  const store = {
    get: (key: string) => orphanStore.get(key),
    update: async (key: string, value: unknown): Promise<void> => {
      orphanStore.set(key, value)
    },
  }
  return {
    clock: { now: () => performance.now(), set: REAL_DEADLINE_TIMERS.set },
    node,
    createDebugger: createCdpNodeServerDebugger,
    resolveLaunch: resolveNodeServerLaunch,
    resolveStops: resolveNodeServerStops,
    assertPortFree: ({ port: declared, signal }): Promise<void> =>
      assertNodeServerPortFree({ port: declared, signal, findPortOccupant }),
    launch: launchNodeServer,
    signalGroup: signalProcessGroup,
    isGroupGone: isProcessGroupGone,
    readProcessStart: (pid) => readProcessStart(pid),
    readProcessCwd: (pid) => readProcessCwd(pid),
    findPortOccupant,
    waitForReadiness: (input) => {
      const startedAt = performance.now()
      return waitForServerReadiness({
        ...input,
        hasTimeLeft: () =>
          input.hasTimeLeft() && performance.now() - startedAt < giveUpMs,
      })
    },
    verifyListener: verifyListenerOwnership,
    readListeningPorts: (pid) => readListeningPortsOfProcess(pid),
    readConnectionServerPid: (input) => readConnectionServerPid(input),
    sendRequest: sendDeclaredRequest,
    rememberProcess: (record): Promise<void> =>
      rememberNodeServerProcess(store, record),
    forgetProcess: (runId): Promise<void> =>
      forgetNodeServerProcess(store, runId),
  }
}

/** Waits until the run's view satisfies a condition, by listening to its changes. */
export function untilView(
  run: ReturnType<typeof createOwnedNodeServerRun>,
  condition: (view: ReturnType<typeof run.view>) => boolean,
): Promise<ReturnType<typeof run.view>> {
  if (condition(run.view())) return Promise.resolve(run.view())
  return new Promise((resolve) => {
    const subscription = run.onDidChange(() => {
      if (!condition(run.view())) return
      subscription.dispose()
      resolve(run.view())
    })
  })
}
