import { basename } from 'node:path'

import type { ErrorCode } from '../errors'

import type { LoopbackHost } from './acceptsLoopbackConnection'
import {
  readPortListeners,
  type PortListener,
  type PortListenerReading,
} from './readPortListeners'
import { readProcessPsField } from './readProcessPsField'

/** What {@link verifyListenerOwnership} reads with; each is the real one unless a test names its own. */
export type ListenerOwnershipReaders = {
  /** Reads a port's listeners; {@link readPortListeners} unless a test names its own. */
  readListeners?: (port: number) => Promise<PortListenerReading>
  /** Reads a process's group id; `ps -o pgid=` unless a test names its own. */
  readProcessGroup?: (pid: number) => Promise<number | undefined>
  /** Reads a process's command name; `ps -o comm=` unless a test names its own. */
  readProcessCommand?: (pid: number) => Promise<string | undefined>
}

/** What {@link verifyListenerOwnership} judges. */
export type ListenerOwnershipInput = {
  port: number
  /** The loopback address readiness selected. */
  selectedHost: LoopbackHost
  /** The launched process. */
  ownerPid: number
  /** The launched process's group. */
  processGroup: number
  /** True when the port accepted a connection; a missing listener then reads as a foreign one. */
  acceptedWithoutListener?: boolean
} & ListenerOwnershipReaders

/** The result of {@link verifyListenerOwnership}. */
export type ListenerOwnership =
  | { owned: true }
  | {
      owned: false
      code: Extract<ErrorCode, 'LISTENER_NOT_OWNED' | 'PORT_OWNER_UNKNOWN'>
      message: string
    }

/** Listener addresses of each family that accept a connection to the loopback address. */
const ACCEPTING_ADDRESSES: Record<
  LoopbackHost,
  Record<PortListener['family'], readonly string[]>
> = {
  '127.0.0.1': {
    IPv4: ['127.0.0.1', '0.0.0.0', '*'],
    // A dual-stack IPv6 wildcard also accepts IPv4.
    IPv6: ['*', '::', '::ffff:127.0.0.1'],
  },
  '::1': { IPv4: [], IPv6: ['::1', '*', '::'] },
}

/**
 * Tells whether a listener can accept a connection to the selected loopback endpoint.
 * @param listener - One listening socket.
 * @param host - The selected loopback address.
 * @param port - The declared port.
 * @returns `true` for the exact address or a wildcard that covers it.
 * @example canAccept({ family: 'IPv6', address: '*', port: 4100, pid: 7 }, '127.0.0.1', 4100) // => true
 */
function canAccept(
  listener: PortListener,
  host: LoopbackHost,
  port: number,
): boolean {
  return (
    listener.port === port &&
    ACCEPTING_ADDRESSES[host][listener.family].includes(listener.address)
  )
}

/**
 * Words the refusal for a listener that is not the launched process.
 * @param listener - A listener that can accept the endpoint.
 * @param input - The judgement's input with its readers.
 * @returns The `LISTENER_NOT_OWNED` refusal naming the child or the foreign process.
 * @example await refusalForListener({ family: 'IPv4', address: '*', port: 4100, pid: 9 }, input) // => { owned: false, code: 'LISTENER_NOT_OWNED', message: 'Port 4100 is held by a child process …' }
 */
async function refusalForListener(
  listener: PortListener,
  input: ListenerOwnershipInput,
): Promise<ListenerOwnership> {
  const { pid } = listener
  if (pid === undefined)
    return {
      owned: false,
      code: 'LISTENER_NOT_OWNED',
      message: `Port ${input.port} is held by a process Codebook cannot read (it may belong to another user). Ask the learner to stop it or declare the port the server listens on; do not kill it.`,
    }
  const processGroup = await (input.readProcessGroup ?? readProcessGroupOf)(pid)
  if (processGroup === input.processGroup)
    return {
      owned: false,
      code: 'LISTENER_NOT_OWNED',
      message: `Port ${input.port} is held by a child process (pid ${pid}) of the started server, not by the started process itself. The debugger does not control that child, so a request would not stop in your code. Use a server whose started process listens itself.`,
    }
  const command = await (input.readProcessCommand ?? readCommandOf)(pid)
  return {
    owned: false,
    code: 'LISTENER_NOT_OWNED',
    message: `Port ${input.port} is held by another process (pid ${pid}${command ? `, ${basename(command)}` : ''}). Ask the learner to stop it or to declare the port the server listens on; do not kill it.`,
  }
}

/**
 * Reads a process's group through `ps`.
 * @param pid - The process id.
 * @returns The group id, or `undefined` when unreadable.
 * @example await readProcessGroupOf(48633) // => 48633
 */
async function readProcessGroupOf(pid: number): Promise<number | undefined> {
  const text = await readProcessPsField(pid, 'pgid')
  return text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined
}

/**
 * Reads a process's command name through `ps`.
 * @param pid - The process id.
 * @returns The command, or `undefined` when unreadable.
 * @example await readCommandOf(48633) // => 'node'
 */
function readCommandOf(pid: number): Promise<string | undefined> {
  return readProcessPsField(pid, 'comm')
}

/**
 * Decides whether the launched process is the only listener that can accept the selected loopback endpoint.
 * Why: a port that accepts proves nothing about who listens; a fork or cluster child, or a foreign server, would answer a request the debugger cannot stop in. Called by the node-server run after readiness; `PORT_OWNER_UNKNOWN` is never reported as "no listener".
 * @param input - The port, the selected host, the launched pid and group, and optional readers ({@link ListenerOwnershipInput}).
 * @returns
 * - `{ owned: true }` when every listener that can accept the endpoint (exact address or wildcard) is `ownerPid`
 * - `LISTENER_NOT_OWNED` naming the child pid (not controlled by the debugger), or the foreign pid and command, or that the port accepts while no listener is shown
 * - `PORT_OWNER_UNKNOWN` when no listener tool answers (install lsof or ss)
 * @example
 * await verifyListenerOwnership({ port: 4100, selectedHost: '127.0.0.1', ownerPid: 48633, processGroup: 48633 }) // => { owned: true }
 */
export async function verifyListenerOwnership(
  input: ListenerOwnershipInput,
): Promise<ListenerOwnership> {
  const reading = await (input.readListeners ?? readPortListeners)(input.port)
  if (reading.kind === 'unknown')
    return {
      owned: false,
      code: 'PORT_OWNER_UNKNOWN',
      message: `Codebook cannot read which process listens on port ${input.port}: ${reading.reason} Install lsof (macOS or Linux) or ss (Linux) at its system path.`,
    }
  const accepting = reading.listeners.filter((listener) =>
    canAccept(listener, input.selectedHost, input.port),
  )
  if (accepting.length === 0)
    return {
      owned: false,
      code: 'LISTENER_NOT_OWNED',
      message: input.acceptedWithoutListener
        ? `Port ${input.port} accepted a connection, but no listener process is shown for it. Ask the learner to stop whatever answers on the port or to declare the port the server listens on.`
        : `No process is shown listening on ${input.selectedHost} port ${input.port}. Ask the learner to declare the port the server listens on.`,
    }
  for (const listener of accepting)
    if (listener.pid !== input.ownerPid)
      return refusalForListener(listener, input)
  return { owned: true }
}
