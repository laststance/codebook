import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { StringDecoder } from 'node:string_decoder'

import {
  NODE_TEST_HISTORY_LIMIT_BYTES,
  REPOSITORY_RUN_TIMEOUT_MS,
} from '../constants'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { buildNodeTestEnvironment } from './buildNodeTestEnvironment'
import { createOutputRedactor } from './createOutputRedactor'
import { isProcessGroupGone } from './isProcessGroupGone'
import type { PreparedNodeTestLaunch } from './prepareNodeTestLaunch'
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint'
import { signalProcessGroup } from './signalProcessGroup'

const OUTPUT_LIMIT_BYTES = 32_768
const OUTPUT_EVENT_LIMIT_CHARS = 4_096
const INSPECTOR_READY_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 5_000
export type NodeTestOutputEvent = {
  sequence: number
  elapsedMs: number
  channel: 'stdout' | 'stderr'
  text: string
}

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
  let output = '',
    announcement = '',
    error: Error | undefined,
    exited = false,
    closing: Promise<void> | undefined,
    outputSequence = 0
  let outputWrites = Promise.resolve(),
    pendingOutputBytes = 0
  const exit = new Promise<void>((resolve) =>
    child.once('close', () => {
      exited = true
      resolve()
    }),
  )
  child.once('error', (cause) => {
    error = cause
  })
  for (const [channel, stream] of [
    ['stdout', child.stdout],
    ['stderr', child.stderr],
  ] as const) {
    const decoder = new StringDecoder('utf8')
    // One redactor per channel, applied before the announcement, the 32 KiB tail and the 4,096-character event split, so a secret never reaches any of them.
    const redactor = createOutputRedactor()
    const enqueue = (
      text: string,
      deliver: (event: NodeTestOutputEvent) => void | Promise<void>,
    ): void => {
      const bytes = Buffer.byteLength(text)
      // Output beyond the durable history's capacity can never be saved; fail capture instead of buffering it behind slow history writes.
      if (pendingOutputBytes + bytes > NODE_TEST_HISTORY_LIMIT_BYTES) {
        error = new Error(
          'Node test output capture failed: output outpaced its durable history beyond the history size limit.',
        )
        return
      }
      pendingOutputBytes += bytes
      const event = {
        sequence: ++outputSequence,
        elapsedMs: Number(process.hrtime.bigint() - started) / 1_000_000,
        channel,
        text,
      }
      // Hand the chunk over in the step that stamps it; the history serializes its own durable writes, so a debugger stop accepted later cannot overtake it.
      let delivery: Promise<void>
      try {
        delivery = Promise.resolve(deliver(event))
      } catch (cause) {
        delivery = Promise.reject(cause)
      }
      const settled = delivery
        .catch((cause) => {
          error ??= new Error(
            `Node test output capture failed: ${String(cause)}`,
          )
        })
        .finally(() => {
          pendingOutputBytes -= bytes
        })
      outputWrites = outputWrites.then(() => settled)
    }
    const accept = (text: string): void => {
      if (!text) return
      // Keep the initial Inspector announcement and the final bounded test result separately.
      if (Buffer.byteLength(announcement) < OUTPUT_LIMIT_BYTES)
        announcement = Buffer.from(announcement + text)
          .subarray(0, OUTPUT_LIMIT_BYTES)
          .toString('utf8')
      output = Buffer.from(output + text)
        .subarray(-OUTPUT_LIMIT_BYTES)
        .toString('utf8')
      if (!onOutput || error) return
      let part = ''
      for (const character of text) {
        if (part.length + character.length > OUTPUT_EVENT_LIMIT_CHARS) {
          enqueue(part, onOutput)
          if (error) return
          part = ''
        }
        part += character
      }
      if (part) enqueue(part, onOutput)
    }
    stream.on('data', (chunk: Buffer) =>
      accept(redactor.write(decoder.write(chunk))),
    )
    stream.on('end', () =>
      accept(redactor.write(decoder.end()) + redactor.end()),
    )
  }
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
    output: () => output,
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
      await outputWrites
      if (error) throw error
      return { exitCode: child.exitCode, signal: child.signalCode, output }
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
          if (error || exited)
            throw (
              error ??
              new Error(
                `Node test exited before debugger attachment: ${child.exitCode}`,
              )
            )
          const endpoint = readNodeInspectorEndpoint(announcement)
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
          await outputWrites
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
        await outputWrites
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
