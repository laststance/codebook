import {
  queryListenerTool,
  type ListenerToolQueryInputs,
} from './queryListenerTool'
import { splitListenerAddress } from './splitListenerAddress'

/** The two ends of an established loopback connection, as the server process sees them. */
type ConnectionEnds = { clientPort: number; serverPort: number }

/**
 * Finds the pid on the server end in `lsof -Fpn` output: a `p<pid>` line opens a process, an `n<local>-><remote>` line is one of its connections.
 * @param stdout - What `lsof` printed.
 * @param ends - The connection's ports.
 * @param ownPid - This process's pid, never the server end.
 * @returns The pid, or `undefined` when no line has the server port as local and the client port as remote.
 * @example findInLsof('p77\nn127.0.0.1:4100->127.0.0.1:55000\n', { clientPort: 55000, serverPort: 4100 }, 1) // => 77
 */
function findInLsof(
  stdout: string,
  ends: ConnectionEnds,
  ownPid: number,
): number | undefined {
  let pid: number | undefined
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    if (!line.startsWith('n') || pid === undefined || pid === ownPid) continue
    const [local, remote] = line.slice(1).split('->')
    if (
      local !== undefined &&
      remote !== undefined &&
      splitListenerAddress(local)?.port === ends.serverPort &&
      splitListenerAddress(remote)?.port === ends.clientPort
    )
      return pid
  }
  return undefined
}

/**
 * Finds the pid on the server end in `ss -Htnp state established` output: columns Recv-Q, Send-Q, local, peer, then `users:(("node",pid=1,fd=3))`.
 * @param stdout - What `ss` printed.
 * @param ends - The connection's ports.
 * @param ownPid - This process's pid, never the server end.
 * @returns The first other pid, or `undefined`.
 * @example findInSs('0 0 127.0.0.1:4100 127.0.0.1:55000 users:(("node",pid=77,fd=3))\n', { clientPort: 55000, serverPort: 4100 }, 1) // => 77
 */
function findInSs(
  stdout: string,
  ends: ConnectionEnds,
  ownPid: number,
): number | undefined {
  for (const line of stdout.split('\n')) {
    const columns = line.trim().split(/\s+/)
    const local = columns[2]
    const peer = columns[3]
    if (
      local === undefined ||
      peer === undefined ||
      splitListenerAddress(local)?.port !== ends.serverPort ||
      splitListenerAddress(peer)?.port !== ends.clientPort
    )
      continue
    for (const match of line.matchAll(/pid=(\d+)/g))
      if (Number(match[1]) !== ownPid) return Number(match[1])
  }
  return undefined
}

/**
 * Reads which process holds the server end of an established loopback connection, so that the request sender can check, before writing a byte, that the peer is the launched server and not another process that took the port.
 * Called through the `verifyPeer` of {@link sendDeclaredRequest} by the node-server run, once the request's socket is connected.
 * @param input - The connection's client port (this process's end) and server port (the declared port).
 * @param inputs - The tool lookup and the runner ({@link ListenerToolQueryInputs}); the real ones when left out.
 * @returns The pid of the process holding the server end, never this process's own; `undefined` when it is unreadable (no tool, timeout, no matching line).
 * @example
 * await readConnectionServerPid({ clientPort: 55000, serverPort: 4100 }) // => 48633
 */
export async function readConnectionServerPid(
  input: ConnectionEnds,
  inputs: ListenerToolQueryInputs = {},
): Promise<number | undefined> {
  const answer = await queryListenerTool(
    (kind) =>
      kind === 'lsof'
        ? ['-nP', `-iTCP:${input.clientPort}`, '-sTCP:ESTABLISHED', '-Fpn']
        : ['-H', '-t', '-n', '-p', 'state', 'established'],
    inputs,
  )
  if (!answer) return undefined
  return answer.kind === 'lsof'
    ? findInLsof(answer.stdout, input, process.pid)
    : findInSs(answer.stdout, input, process.pid)
}
