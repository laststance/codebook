import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { NODE_SERVER_PROCESS_QUERY_TIMEOUT_MS } from '../constants'

import { psProgramPath } from './psProgramPath'
import { readPortListeners } from './readPortListeners'

/** The process that holds a port, as far as the system shows it. */
export type PortOccupant = { pid: number; command?: string }

/**
 * Reads the command name of a process through `ps`, started by its absolute path.
 * @param pid - The process.
 * @returns Its command name, or `undefined` when `ps` is missing, fails or prints nothing.
 * @example await commandOf(4242) // => 'node'
 */
async function commandOf(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)(
      await psProgramPath('The port occupant check'),
      ['-o', 'comm=', '-p', String(pid)],
      { timeout: NODE_SERVER_PROCESS_QUERY_TIMEOUT_MS },
    )
    return stdout.trim().split('/').at(-1) || undefined
  } catch {
    return undefined
  }
}

/**
 * Finds the process that listens on a port, so a refusal or a stop report can name it.
 * Called by the node-server run when its declared port is taken (`PORT_UNAVAILABLE`) and after a stop, to report a foreign listener apart from the stop.
 * @param port - The TCP port.
 * @returns
 * - the first listener whose pid is visible, with its command name when `ps` shows it
 * - `undefined` when nothing listens there, or when the listener tool is missing or cannot show the process
 * @example await findPortOccupant(4100) // => { pid: 48633, command: 'node' }
 */
export async function findPortOccupant(
  port: number,
): Promise<PortOccupant | undefined> {
  const reading = await readPortListeners(port)
  if (reading.kind !== 'read') return undefined
  const pid = reading.listeners.find(
    (listener) => listener.pid !== undefined,
  )?.pid
  if (pid === undefined) return undefined
  return { pid, command: await commandOf(pid) }
}
