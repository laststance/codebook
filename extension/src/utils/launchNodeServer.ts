import { spawn } from 'node:child_process'

import {
  NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS,
  NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES,
  NODE_SERVER_SHUTDOWN_GRACE_MS,
  NODE_TEST_ATTACH_TIMEOUT_MS,
} from '../constants'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { buildNodeServerEnvironment } from './buildNodeServerEnvironment'
import type { ProcessOutputEvent } from './captureProcessOutput'
import { isProcessGroupGone } from './isProcessGroupGone'
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint'
import { repositoryPosixPath } from './repositoryPosixPath'
import type { ResolvedNodeServerLaunch } from './resolveNodeServerLaunch'
import { signalProcessGroup } from './signalProcessGroup'
import { watchOwnedProcess } from './watchOwnedProcess'

/** The inspector option every server launch carries: a pause before the first line, on loopback, at a port node chooses and announces. */
const INSPECTOR_OPTION = '--inspect-brk=127.0.0.1:0'

/** What a node-server launch runs: the checked real paths ({@link ResolvedNodeServerLaunch}), the opened repository they lie in, and the external Node. */
export type NodeServerLaunchRequest = ResolvedNodeServerLaunch & {
  /** The opened repository's real root; the journal names paths relative to it. */
  workspace: string
  /** The external Node executable and its version. */
  node: { executable: string; version: string }
}

/** How an owned server process ended. */
export type NodeServerExit = {
  exitCode: number | null
  signal: NodeJS.Signals | null
}

/**
 * Writes a launch path as the journal names it: inside the repository as `<workspace>/<path>`.
 * @param workspace - The repository's real root.
 * @param path - A real path inside it.
 * @returns The sanitized path.
 * @example
 * journalPath('/repo', '/repo/apps/api/src/server.ts') // => '<workspace>/apps/api/src/server.ts'
 * journalPath('/repo', '/repo')                          // => '<workspace>'
 */
function journalPath(workspace: string, path: string): string {
  const inside = repositoryPosixPath(workspace, path)
  // The repository root itself reads as the bare placeholder.
  return inside === '.' ? '<workspace>' : `<workspace>/${inside}`
}

/**
 * Starts a repository's own server entry as `node --inspect-brk=127.0.0.1:0 [--import <the repository's tsx loader>] <entry>` in its package root, in a process group of its own, with the restricted environment of {@link buildNodeServerEnvironment}; Codebook never sets the port or any other variable, and never reads the server's `.env`.
 * The server stays paused before its first line until a debugger releases it; readiness and listener ownership are the run's checks.
 * Called by the node-server run after {@link resolveNodeServerLaunch} checked the real paths.
 * @param launch - The checked real paths, the repository root and the external Node ({@link NodeServerLaunchRequest}).
 * @param record - The run's journal: `node-server.started` (sanitized argv, inherited variable names, loader path, Node version, `secretEnvironmentInherited: false`) and `node-server.closed`.
 * @param onOutput - Receives each redacted, stamped output chunk at once, in arrival order.
 * @returns The owned server: its pid and process group, output, inspector endpoint, exit and close.
 * @example
 * const server = await launchNodeServer({ workspace: '/repo', packageRoot: '/repo/apps/api', entry: '/repo/apps/api/src/server.ts', loader, node: { executable: '/usr/local/bin/node', version: '26.10.0' } }, record)
 * const endpoint = await server.inspectorEndpoint(signal) // => 'ws://127.0.0.1:58209/543bb4f3-…'
 */
export async function launchNodeServer(
  launch: NodeServerLaunchRequest,
  record: (type: string, detail?: unknown) => unknown,
  onOutput?: (event: ProcessOutputEvent) => void | Promise<void>,
) {
  const startedAt = process.hrtime.bigint()
  const args = [
    INSPECTOR_OPTION,
    ...(launch.loader.kind === 'tsx' ? ['--import', launch.loader.url] : []),
    launch.entry,
  ]
  const environment = buildNodeServerEnvironment()
  const child = spawn(launch.node.executable, args, {
    cwd: launch.packageRoot,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let closing: Promise<NodeServerExit> | undefined
  const { exit, hasExited, failure, capture } = watchOwnedProcess(child, {
    startedAt,
    onOutput,
    pendingLimitBytes: NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES,
    overflowMessage:
      'Node server output capture failed: output outpaced its delivery beyond its limit.',
    failurePrefix: 'Node server output capture failed',
  })
  const exitOf = (): NodeServerExit => ({
    exitCode: child.exitCode,
    signal: child.signalCode,
  })
  record('node-server.started', {
    pid: child.pid,
    args: [
      INSPECTOR_OPTION,
      ...(launch.loader.kind === 'tsx'
        ? ['--import', journalPath(launch.workspace, launch.loader.path)]
        : []),
      journalPath(launch.workspace, launch.entry),
    ],
    cwd: journalPath(launch.workspace, launch.packageRoot),
    loader:
      launch.loader.kind === 'tsx'
        ? journalPath(launch.workspace, launch.loader.path)
        : 'node',
    nodeVersion: launch.node.version,
    inheritedVariables: Object.keys(environment).sort(),
    secretEnvironmentInherited: false,
  })
  return {
    pid: child.pid,
    processGroup: child.pid,
    elapsedMs: () => Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    /** The last redacted output, for a failure's cause. @example server.output() // => 'fixture listening on 127.0.0.1:4100\n' */
    output: () => capture.tail(),
    /** How the process ended, or `undefined` while it runs. @example server.exited() // => { exitCode: 3, signal: null } */
    exited: (): NodeServerExit | undefined =>
      hasExited() ? exitOf() : undefined,
    /** Waits for this process's complete inspector announcement within {@link NODE_TEST_ATTACH_TIMEOUT_MS}, never guessing an endpoint from a partial line. @example await server.inspectorEndpoint(signal) // => 'ws://127.0.0.1:58209/…' */
    async inspectorEndpoint(signal: AbortSignal): Promise<string> {
      return waitUntil(
        () => {
          const ended = failure()
          if (ended) throw ended
          if (hasExited())
            throw new Error(
              `Node server exited before debugger attachment: ${child.exitCode ?? child.signalCode}`,
            )
          return readNodeInspectorEndpoint(capture.announcement())
        },
        'owned Node server inspector announcement',
        NODE_TEST_ATTACH_TIMEOUT_MS,
        signal,
      )
    },
    /** Reports how the process ended once it exits within `timeoutMs`, or `undefined` while it still runs. @example await server.waitForExit(2_000) // => { exitCode: 0, signal: null } */
    async waitForExit(timeoutMs: number): Promise<NodeServerExit | undefined> {
      try {
        await awaitResponse(
          exit,
          'owned Node server exit',
          undefined,
          timeoutMs,
        )
      } catch {
        return undefined
      }
      return exitOf()
    },
    /**
     * Ends the whole owned process group: the debugger detaches first (a server handling SIGTERM waits for an attached debugger before it exits, and a paused one cannot run its handler), then SIGTERM, then SIGKILL after {@link NODE_SERVER_SHUTDOWN_GRACE_MS}.
     * @param detachDebugger - Ends the run's debugger session for this process (detach, which resumes it); bounded by {@link NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS} and skipped when absent.
     * @returns How the process ended.
     * @example await server.close(() => session.detach()) // => { exitCode: 0, signal: null }
     */
    async close(detachDebugger?: () => Promise<void>): Promise<NodeServerExit> {
      const attempt = (closing ??= (async () => {
        if (detachDebugger)
          await awaitResponse(
            detachDebugger(),
            'owned Node server debugger detach',
            undefined,
            NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS,
          ).catch(() => undefined)
        const processGroup = child.pid
        // A process that never started has no group to end.
        if (!processGroup) {
          await capture.settled()
          return exitOf()
        }
        signalProcessGroup(processGroup, 'SIGTERM')
        const waitForRelease = async (): Promise<void> => {
          await awaitResponse(
            exit,
            'owned Node server exit',
            undefined,
            NODE_SERVER_SHUTDOWN_GRACE_MS,
          )
          await waitUntil(
            () => isProcessGroupGone(processGroup),
            'owned Node server process group exit',
            NODE_SERVER_SHUTDOWN_GRACE_MS,
          )
        }
        let killed = false
        // A server or a process it started may ignore SIGTERM; the escalation covers its whole group.
        try {
          await waitForRelease()
        } catch {
          killed = true
          signalProcessGroup(processGroup, 'SIGKILL')
          await waitForRelease()
        }
        await capture.settled()
        record('node-server.closed', { pid: child.pid, ...exitOf(), killed })
        return exitOf()
      })())
      // Keep a finished close, while a later close retries a failed signal or exit check instead of replaying its rejection.
      try {
        return await attempt
      } catch (cause) {
        if (closing === attempt) closing = undefined
        throw cause
      }
    },
  }
}
