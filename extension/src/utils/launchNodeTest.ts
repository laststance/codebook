import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

import {
  NODE_TEST_HISTORY_LIMIT_BYTES,
  REPOSITORY_RUN_TIMEOUT_MS,
} from '../constants'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { buildNodeTestEnvironment } from './buildNodeTestEnvironment'
import type { ProcessOutputEvent } from './captureProcessOutput'
import { isProcessGroupGone } from './isProcessGroupGone'
import type { PreparedNodeTestLaunch } from './prepareNodeTestLaunch'
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint'
import { signalProcessGroup } from './signalProcessGroup'
import { watchOwnedProcess } from './watchOwnedProcess'

const INSPECTOR_READY_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 5_000
/** One stamped, redacted chunk of an owned test's output ({@link ProcessOutputEvent}). */
export type NodeTestOutputEvent = ProcessOutputEvent

/** Reserves a local port only while choosing one; the later Inspector identity must still be checked against the owned process group. @example const port = await availableInspectorPort() */
async function availableInspectorPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  if (!address || typeof address === 'string')
    throw new Error('Node test inspector did not acquire a loopback port.')
  return address.port
}

/** Starts exactly the sealed Vitest file in an owned process group, in its Vitest root, before native debugger attachment. Called by the Node test runtime after source verification. @param launch - Checked in-repository program and argv, the Vitest root it runs in and the plan's facts the start journals. @param node - External Node executable. @param record - Bounded process event sink. @param onOutput - Receives each stamped chunk at once, in arrival order; its promise settles when the chunk is durable. @example const testRun = await launchNodeTest(launch, '/usr/bin/node', record); await testRun.inspectorEndpoint(signal) */
export async function launchNodeTest(
  launch: Pick<
    PreparedNodeTestLaunch,
    'vitestRoot' | 'execution' | 'program' | 'args'
  >,
  node: string,
  record: (type: string, detail?: unknown) => unknown,
  onOutput?: (event: NodeTestOutputEvent) => void | Promise<void>,
) {
  const started = process.hrtime.bigint()
  const port = await availableInspectorPort()
  const args = launch.args.map((argument) =>
    argument === '--inspect-brk' ? `--inspect-brk=${port}` : argument,
  )
  if (
    args.filter((argument) => argument === `--inspect-brk=${port}`).length !== 1
  )
    throw new Error('Node test launch has no single Inspector pause.')
  // The owned test receives basic process settings without inheriting unrelated account credentials, exactly as its file-listing preflight did.
  // The Vitest root, as the package's own `vitest` command runs from it, so its config and its relative paths resolve as there.
  const child = spawn(node, [launch.program, ...args], {
    cwd: launch.vitestRoot,
    env: buildNodeTestEnvironment(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let closing: Promise<void> | undefined
  // Each channel is redacted before the 32 KiB tail and the 4,096-character event split, so a secret never reaches either.
  const { exit, hasExited, failure, capture } = watchOwnedProcess(child, {
    startedAt: started,
    onOutput,
    // Output beyond the durable history's capacity can never be saved; fail capture instead of buffering it behind slow history writes.
    pendingLimitBytes: NODE_TEST_HISTORY_LIMIT_BYTES,
    overflowMessage:
      'Node test output capture failed: output outpaced its durable history beyond the history size limit.',
    failurePrefix: 'Node test output capture failed',
  })
  record('node-test.started', {
    pid: child.pid,
    port,
    program: launch.program,
    args,
    cwd: launch.vitestRoot,
    vitestRoot: launch.execution.vitestRoot,
    rootClaim: launch.execution.rootClaim,
    secretEnvironmentInherited: false,
  })
  return {
    pid: child.pid,
    processGroup: child.pid,
    elapsedMs: () => Number(process.hrtime.bigint() - started) / 1_000_000,
    output: () => capture.tail(),
    /** Waits for the launched test command's actual exit before sealing its output result. @example const result = await testRun.result(signal) */
    async result(signal: AbortSignal): Promise<{
      exitCode: number | null
      signal: NodeJS.Signals | null
      output: string
    }> {
      // The rest of the test file runs after the final continuation, so only cancellation and the owned run deadline bound it.
      await awaitResponse(
        exit,
        'owned Node test result',
        signal,
        REPOSITORY_RUN_TIMEOUT_MS,
      )
      await capture.settled()
      const ended = failure()
      if (ended) throw ended
      return {
        exitCode: child.exitCode,
        signal: child.signalCode,
        output: capture.tail(),
      }
    },
    /** Reports how the process ended once it exits within `timeoutMs`, or `undefined` while it is still running. Used to explain a debugger session that ended before its first stop. @example await testRun.waitForExit(2_000) // => { exitCode: 0, signal: null } */
    async waitForExit(
      timeoutMs: number,
    ): Promise<
      { exitCode: number | null; signal: NodeJS.Signals | null } | undefined
    > {
      try {
        await awaitResponse(exit, 'owned Node test exit', undefined, timeoutMs)
      } catch {
        return undefined
      }
      return { exitCode: child.exitCode, signal: child.signalCode }
    },
    /** Waits for this process's complete Inspector announcement, never guessing an endpoint from a partial chunk. @example await testRun.inspectorEndpoint(signal) */
    async inspectorEndpoint(signal: AbortSignal): Promise<string> {
      return waitUntil(
        () => {
          const ended = failure()
          if (ended || hasExited())
            throw (
              ended ??
              new Error(
                `Node test exited before debugger attachment: ${child.exitCode}`,
              )
            )
          const endpoint = readNodeInspectorEndpoint(capture.announcement())
          if (!endpoint) return undefined
          if (Number(new URL(endpoint).port) !== port)
            throw new Error('Node test announced a foreign Inspector port.')
          return endpoint
        },
        'owned Node test inspector announcement',
        INSPECTOR_READY_TIMEOUT_MS,
        signal,
      )
    },
    /** Releases the entire owned test process group, including a paused worker, after success or failure. @example await testRun.close() */
    async close(): Promise<void> {
      const attempt = (closing ??= (async () => {
        if (!child.pid) {
          await exit
          await capture.settled()
          return
        }
        const processGroup = child.pid
        // A group whose exited members macOS has not reaped yet answers EPERM; both utilities wait for it instead of failing the release.
        signalProcessGroup(processGroup, 'SIGTERM')
        const groupGone = (): boolean => isProcessGroupGone(processGroup)
        const waitForRelease = async (): Promise<void> => {
          await awaitResponse(
            exit,
            'owned Node test exit',
            undefined,
            SHUTDOWN_TIMEOUT_MS,
          )
          await waitUntil(
            groupGone,
            'owned Node test process group exit',
            SHUTDOWN_TIMEOUT_MS,
          )
        }
        // A test worker may outlive the launcher, so escalation covers its whole owned group.
        try {
          await waitForRelease()
        } catch {
          signalProcessGroup(processGroup, 'SIGKILL')
          await waitForRelease()
        }
        await capture.settled()
        record('node-test.closed', {
          pid: child.pid,
          exitCode: child.exitCode,
          signal: child.signalCode,
        })
      })())
      // Keep a finished release, while a later close retries a failed signal or exit check instead of replaying its rejection.
      try {
        await attempt
      } catch (cause) {
        if (closing === attempt) closing = undefined
        throw cause
      }
    },
  }
}
