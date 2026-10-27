import { z } from 'zod'

import {
  LISTENER_QUERY_MAX_BYTES,
  LISTENER_QUERY_TIMEOUT_MS,
} from '../constants'

import { listenerToolPath, type ListenerTool } from './listenerToolPath'
import { parseLsofListeners } from './parseLsofListeners'
import { parseSsListeners } from './parseSsListeners'
import { runBoundedQuery, type BoundedQueryRunner } from './runBoundedQuery'

/** One socket listening on a TCP port: its family, local address (`*` for any address, which on IPv6 also accepts IPv4), port and the process holding it (`undefined` when the tool may not show another user's process). */
export type PortListener = {
  family: 'IPv4' | 'IPv6'
  address: string
  port: number
  pid: number | undefined
}

/** A port's listening sockets as the listener tool printed them, or why they could not be read; an unknown reading never counts as "no listener". */
export type PortListenerReading =
  | { kind: 'read'; tool: ListenerTool['kind']; listeners: PortListener[] }
  | { kind: 'unknown'; reason: string }

/** What {@link readPortListeners} reads with; each is the real one unless a test names its own. */
export type PortListenerInputs = {
  /** Names the listener tool; {@link listenerToolPath} unless a test names its own. */
  findTool?: () => Promise<ListenerTool | undefined>
  /** Runs the bounded query; {@link runBoundedQuery} unless a test names its own. */
  run?: BoundedQueryRunner
}

/** The parts of a failed `execFile` the reading tells apart: an exit code, an end by the time or size bound, and what the tool printed. */
const queryFailureSchema = z.looseObject({
  code: z.union([z.number(), z.string()]).nullish(),
  killed: z.boolean().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
})

/**
 * Builds the tool's arguments for one port's listening TCP sockets, numeric and with process ids.
 * @param tool - The listener tool.
 * @param port - The port.
 * @returns The arguments `lsof` or `ss` receives.
 * @example queryArguments({ kind: 'lsof', path: '/usr/sbin/lsof' }, 4100) // => ['-nP', '-iTCP:4100', '-sTCP:LISTEN', '-Fptn']
 */
function queryArguments(tool: ListenerTool, port: number): string[] {
  return tool.kind === 'lsof'
    ? ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fptn']
    : ['-H', '-l', '-t', '-n', '-p', 'sport', '=', `:${port}`]
}

/**
 * Explains a query that ended without an answer, or recognizes `lsof`'s silent exit 1, which is its answer "no listener".
 * @param tool - The listener tool that ran.
 * @param failure - The rejection of the query.
 * @returns An empty `read` for `lsof`'s silent exit 1, an `unknown` reading naming the bound or the tool's first error line otherwise.
 * @example readingOfFailure({ kind: 'lsof', path: '/usr/sbin/lsof' }, Object.assign(new Error('x'), { killed: true })) // => { kind: 'unknown', reason: 'lsof did not answer within 3000 ms.' }
 */
function readingOfFailure(
  tool: ListenerTool,
  failure: unknown,
): PortListenerReading {
  const parsed = queryFailureSchema.safeParse(failure)
  const details = parsed.success ? parsed.data : {}
  // An answer longer than the size bound is no answer either; Node.js ends that query too.
  if (details.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return {
      kind: 'unknown',
      reason: `${tool.kind} printed more than ${LISTENER_QUERY_MAX_BYTES} bytes.`,
    }
  if (details.killed)
    return {
      kind: 'unknown',
      reason: `${tool.kind} did not answer within ${LISTENER_QUERY_TIMEOUT_MS / 1_000} s.`,
    }
  // lsof exits 1 without a word when nothing matches; any printed word makes it a failure instead.
  if (
    tool.kind === 'lsof' &&
    details.code === 1 &&
    !details.stdout &&
    !details.stderr
  )
    return { kind: 'read', tool: tool.kind, listeners: [] }
  const firstErrorLine = details.stderr?.split('\n').find(Boolean)
  return {
    kind: 'unknown',
    reason: `${tool.kind} failed: ${firstErrorLine ?? `exit ${String(details.code ?? 'unknown')}`}.`,
  }
}

/**
 * Asks the system which processes listen on a TCP port, through `lsof` (or `ss` on Linux without it) started by its absolute path, within {@link LISTENER_QUERY_TIMEOUT_MS}.
 * The node-server run bases its listener-ownership decisions on this reading: the launched process must be the only listener that can accept the request's address, and an `unknown` reading refuses the request instead of passing for "no listener".
 * Called by the node-server run at readiness and immediately before the request is written.
 * @param port - The port the declaration names.
 * @param inputs - The tool lookup and the query runner ({@link PortListenerInputs}); the real ones when left out.
 * @returns
 * - `{ kind: 'read', tool, listeners }`, listeners possibly empty
 * - `{ kind: 'unknown', reason }` when no tool lies where Codebook starts it, the query ran past its bound, failed or printed what this reader does not understand
 * @example
 * await readPortListeners(4100) // => { kind: 'read', tool: 'lsof', listeners: [{ family: 'IPv6', address: '*', port: 4100, pid: 48633 }] }
 */
export async function readPortListeners(
  port: number,
  inputs: PortListenerInputs = {},
): Promise<PortListenerReading> {
  const tool = await (inputs.findTool ?? listenerToolPath)()
  if (!tool)
    return {
      kind: 'unknown',
      reason:
        'No lsof lies at /usr/sbin/lsof or /usr/bin/lsof (on Linux, no ss at /usr/bin/ss, /bin/ss, /usr/sbin/ss or /sbin/ss), and Codebook starts them only from there.',
    }
  let stdout: string
  try {
    ;({ stdout } = await (inputs.run ?? runBoundedQuery)(
      tool.path,
      queryArguments(tool, port),
      {
        timeout: LISTENER_QUERY_TIMEOUT_MS,
        maxBuffer: LISTENER_QUERY_MAX_BYTES,
        killSignal: 'SIGKILL',
        windowsHide: true,
        env: { LC_ALL: 'C', PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      },
    ))
  } catch (failure) {
    return readingOfFailure(tool, failure)
  }
  const listeners =
    tool.kind === 'lsof' ? parseLsofListeners(stdout) : parseSsListeners(stdout)
  return listeners
    ? { kind: 'read', tool: tool.kind, listeners }
    : {
        kind: 'unknown',
        reason: `${tool.kind} printed a listener line Codebook cannot read.`,
      }
}
