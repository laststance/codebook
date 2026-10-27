import { spawn } from 'node:child_process'

import {
  NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS,
  NODE_SERVER_GROUP_EXIT_POLL_MS,
  NODE_SERVER_KILL_BY_MS,
  NODE_SERVER_OUTPUT_PENDING_LIMIT_BYTES,
  NODE_SERVER_STOP_DEADLINE_MS,
  NODE_TEST_ATTACH_TIMEOUT_MS,
} from '../constants'
import { NANOSECONDS_PER_MILLISECOND } from '../runtimeSupport/constants'
import { awaitResponse } from '../runtimeSupport/utils/awaitResponse'
import { waitUntil } from '../runtimeSupport/utils/waitUntil'

import { buildNodeServerEnvironment } from './buildNodeServerEnvironment'
import type { ProcessOutputEvent } from './captureProcessOutput'
import {
  confirmLaunchedGroup,
  type LaunchedGroupVerdict,
} from './confirmLaunchedGroup'
import { isProcessGone } from './isProcessGone'
import { isProcessGroupGone } from './isProcessGroupGone'
import { readNodeInspectorEndpoint } from './readNodeInspectorEndpoint'
import { readProcessCwd } from './readProcessCwd'
import { readProcessStart } from './readProcessStart'
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
 * What a close can be told beyond the debugger's detach: the stop's clock and bounds, and the signals and identity check it uses. Every field defaults to the product's own; the run supplies the first two and a test any.
 */
export type NodeServerCloseOptions = {
  /** Milliseconds since the stop was admitted, which the detach, the TERM grace and the group wait share; counted from the close call when absent. */
  sinceAdmissionMs?: () => number
  /** Reads whether the group is still the launched one ({@link confirmLaunchedGroup}), before each signal of a retried close; the launcher's own reading of its leader when absent. */
  confirmGroup?: () => Promise<LaunchedGroupVerdict>
  /** Whether the stop is a retry of an earlier one that may have signalled the group before any close ran (the run's own count): such a close confirms the group before each signal from its first call on. */
  retried?: boolean
  /** By when SIGKILL has been sent; {@link NODE_SERVER_KILL_BY_MS} unless a test names its own. */
  killByMs?: number
  /** The stop's whole deadline; {@link NODE_SERVER_STOP_DEADLINE_MS} unless a test names its own. */
  deadlineMs?: number
  /** Delivers a signal to the group; {@link signalProcessGroup} unless a test names its own. */
  signalGroup?: typeof signalProcessGroup
  /** Says whether the group has no member left; {@link isProcessGroupGone} unless a test names its own. */
  isGroupGone?: typeof isProcessGroupGone
}

/** A close's options with the product's own clock, bounds, signal and probe filled in ({@link resolveCloseOptions}). */
type ResolvedCloseOptions = Required<
  Pick<
    NodeServerCloseOptions,
    | 'sinceAdmissionMs'
    | 'killByMs'
    | 'deadlineMs'
    | 'signalGroup'
    | 'isGroupGone'
  >
>

/**
 * Fills a close's options with the product's own: the stop's clock counted from the close call, {@link NODE_SERVER_KILL_BY_MS}, {@link NODE_SERVER_STOP_DEADLINE_MS}, {@link signalProcessGroup} and {@link isProcessGroupGone}.
 * Why: a test names its own clock, bounds and signals, and the run names the stop's admission clock; the close reads one resolved set. Called by the close of {@link launchNodeServer}.
 * @param options - What the caller named ({@link NodeServerCloseOptions}).
 * @param closeStartedAt - When the close began (`performance.now()`), the clock's start when no admission clock was named.
 * @returns The resolved clock, bounds, signal and probe.
 * @example
 * resolveCloseOptions({}, performance.now()).killByMs // => 5000
 */
function resolveCloseOptions(
  options: NodeServerCloseOptions,
  closeStartedAt: number,
): ResolvedCloseOptions {
  return {
    sinceAdmissionMs:
      options.sinceAdmissionMs ??
      ((): number => performance.now() - closeStartedAt),
    killByMs: options.killByMs ?? NODE_SERVER_KILL_BY_MS,
    deadlineMs: options.deadlineMs ?? NODE_SERVER_STOP_DEADLINE_MS,
    signalGroup: options.signalGroup ?? signalProcessGroup,
    isGroupGone: options.isGroupGone ?? isProcessGroupGone,
  }
}

/**
 * Ends an owned process group with SIGTERM, then SIGKILL when it has not ended by the kill bound.
 * Why: a server or a process it started may ignore SIGTERM, so the escalation covers the whole group and lands by the kill bound. A retried close confirms the group once, before SIGTERM; the group has existed since that checked SIGTERM and a group id is not given out while a member holds it, so the kill bound only probes the group and never repeats the identity check (which could push SIGKILL past the bound). Called by the close of {@link launchNodeServer}.
 * @param input - The group, the identity check before SIGTERM, the signal, the group probe, the wait for the group's end and the two bounds.
 * @returns
 * - `false` when the group ended after SIGTERM, was gone at the kill bound, or nothing was signalled
 * - `true` only when SIGKILL was sent
 * @throws When the identity check cannot tell whose group it is, when the probe at the kill bound cannot tell whether members remain (no SIGKILL is sent), or the group outlives SIGKILL until the deadline.
 * @example
 * await endGroupBySignals({ processGroup: 4242, mayStillSignal: async () => true, signalGroup, isGroupGone, waitForRelease, killByMs: 5_000, deadlineMs: 10_000 }) // => false
 */
async function endGroupBySignals(input: {
  processGroup: number
  mayStillSignal: () => Promise<boolean>
  signalGroup: typeof signalProcessGroup
  isGroupGone: typeof isProcessGroupGone
  waitForRelease: (boundMs: number) => Promise<void>
  killByMs: number
  deadlineMs: number
}): Promise<boolean> {
  if (!(await input.mayStillSignal())) return false
  input.signalGroup(input.processGroup, 'SIGTERM')
  try {
    await input.waitForRelease(input.killByMs)
    return false
  } catch {
    // SIGTERM did not end the group by the kill bound. A probe that throws cannot tell, so it propagates and nothing is killed.
    if (input.isGroupGone(input.processGroup)) return false
    input.signalGroup(input.processGroup, 'SIGKILL')
    await input.waitForRelease(input.deadlineMs)
    return true
  }
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
  let closeAttempts = 0
  // The leader's identity is read at launch, while the leader surely is the launched process, for the checks of a retried close.
  const launchedStart = child.pid
    ? readProcessStart(child.pid).catch(() => undefined)
    : undefined
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
    elapsedMs: () =>
      Number(process.hrtime.bigint() - startedAt) / NANOSECONDS_PER_MILLISECOND,
    /** The last redacted output, for a failure's cause. @example server.output() // => 'fixture listening on 127.0.0.1:4100\n' */
    output: () => capture.tail(),
    /** How the process ended, or `undefined` while it runs. @example server.exited() // => { exitCode: 3, signal: null } */
    exited: (): NodeServerExit | undefined =>
      hasExited() ? exitOf() : undefined,
    /** Settles with how the process ended once it exits, however long that takes; the run watches it to learn of an exit nobody asked for. @example (await server.whenExited()).exitCode // => 3 */
    whenExited: (): Promise<NodeServerExit> => exit.then(exitOf),
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
     * Ends the whole owned process group inside the stop's budget: the debugger detaches first (a server handling SIGTERM waits for an attached debugger before it exits, and a paused one cannot run its handler), then SIGTERM, then SIGKILL no later than {@link NODE_SERVER_KILL_BY_MS} after the stop's admission, and the group's exit is awaited until {@link NODE_SERVER_STOP_DEADLINE_MS}. Detach, grace and wait share these two bounds, so a slow detach shortens the grace instead of delaying the kill.
     * A retried close (an earlier close failed, or the run says its stop is a retry) signals only after {@link confirmLaunchedGroup} found the group still the launched one: a replaced group is left alone, an unverifiable one fails the close.
     * @param detachDebugger - Ends the run's debugger session for this process (detach, which resumes it); bounded by {@link NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS} and by the kill bound, and skipped when absent.
     * @param options - The stop's clock, bounds and checks ({@link NodeServerCloseOptions}).
     * @returns How the process ended.
     * @throws When a retried close cannot tell whether the group is still the launched one, or the group outlives the SIGKILL until the deadline.
     * @example await server.close(() => session.detach(), { sinceAdmissionMs: () => performance.now() - admittedAt }) // => { exitCode: 0, signal: null }
     */
    async close(
      detachDebugger?: () => Promise<void>,
      options: NodeServerCloseOptions = {},
    ): Promise<NodeServerExit> {
      const attempt = (closing ??= (async () => {
        const {
          sinceAdmissionMs,
          killByMs,
          deadlineMs,
          signalGroup,
          isGroupGone,
        } = resolveCloseOptions(options, performance.now())
        // A stop the run retries is a retry here too, even when its first attempt failed before any close ran.
        const isRetry = closeAttempts++ > 0 || options.retried === true
        // The time left until a bound of the stop, never less than one poll so a check that is already true still runs.
        const timeLeft = (boundMs: number): number =>
          Math.max(boundMs - sinceAdmissionMs(), NODE_SERVER_GROUP_EXIT_POLL_MS)
        if (detachDebugger)
          await awaitResponse(
            detachDebugger(),
            'owned Node server debugger detach',
            undefined,
            Math.min(
              NODE_SERVER_DEBUGGER_DETACH_TIMEOUT_MS,
              timeLeft(killByMs),
            ),
          ).catch(() => undefined)
        const processGroup = child.pid
        // A process that never started has no group to end.
        if (!processGroup) {
          await capture.settled()
          return exitOf()
        }
        // A retried close signals a group id only while it is the launched group's: the first close may have lost it to another process.
        const mayStillSignal = async (): Promise<boolean> => {
          if (!isRetry) return true
          const verdict = await (
            options.confirmGroup ??
            (async () =>
              confirmLaunchedGroup({
                pid: processGroup,
                startedAt: await launchedStart,
                leaderExited: hasExited(),
                readProcessStart,
                readProcessCwd,
                isGroupGone,
                isProcessGone,
              }))
          )()
          if (verdict === 'unverifiable')
            throw new Error(
              'Node server process group could not be confirmed as the launched one, so it was not signalled again.',
            )
          return verdict === 'launched'
        }
        const waitForRelease = async (boundMs: number): Promise<void> => {
          await awaitResponse(
            exit,
            'owned Node server exit',
            undefined,
            timeLeft(boundMs),
          )
          await waitUntil(
            () => isGroupGone(processGroup),
            'owned Node server process group exit',
            timeLeft(boundMs),
            undefined,
            NODE_SERVER_GROUP_EXIT_POLL_MS,
          )
        }
        const killed = await endGroupBySignals({
          processGroup,
          mayStillSignal,
          signalGroup,
          isGroupGone,
          waitForRelease,
          killByMs,
          deadlineMs,
        })
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
