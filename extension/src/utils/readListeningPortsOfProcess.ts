import { parseLsofListeners } from './parseLsofListeners'
import { parseSsListeners } from './parseSsListeners'
import {
  queryListenerTool,
  type ListenerToolQueryInputs,
} from './queryListenerTool'

/**
 * Reads the TCP ports a process listens on, so that a server that listens elsewhere than its declaration says can be told the corrected `port: <n>`.
 * Called by the node-server run when readiness times out (`SERVER_NOT_LISTENING`); the run excludes the inspector port from the answer.
 * @param pid - The process id of the launched server.
 * @param inputs - The tool lookup and the runner ({@link ListenerToolQueryInputs}); the real ones when left out.
 * @returns The ports the process listens on, ascending and without duplicates; empty when it listens on none or the tool could not answer.
 * @example
 * await readListeningPortsOfProcess(48633) // => [4100, 9229]
 */
export async function readListeningPortsOfProcess(
  pid: number,
  inputs: ListenerToolQueryInputs = {},
): Promise<number[]> {
  const answer = await queryListenerTool(
    (kind) =>
      kind === 'lsof'
        ? ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fptn']
        : ['-H', '-l', '-t', '-n', '-p'],
    inputs,
  )
  if (!answer) return []
  const listeners =
    (answer.kind === 'lsof'
      ? parseLsofListeners(answer.stdout)
      : parseSsListeners(answer.stdout)) ?? []
  // ss lists every process's sockets; only this process's count.
  const ports = listeners
    .filter((listener) => listener.pid === pid)
    .map((listener) => listener.port)
  return [...new Set(ports)].sort((first, second) => first - second)
}
