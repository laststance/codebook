import { StudyError } from '../errors'

import {
  assertDevelopmentPortFree,
  type PortCheckOptions,
  type PortRefusal,
} from './assertDevelopmentPortFree'
import type { PortOccupant } from './findPortOccupant'

/**
 * Words a port refusal for the node-server run as `PORT_UNAVAILABLE`, naming the occupying process when it is visible.
 * @param refusal - Why the port cannot be used.
 * @param occupant - The visible process on the port, if any.
 * @returns The `PORT_UNAVAILABLE` error.
 * @example refusalText({ port: 4100, reason: 'in-use' }, { pid: 99, command: 'node' }) // => '... process 99 (node) listens on port 4100 ...'
 */
function refusalText(
  refusal: PortRefusal,
  occupant: PortOccupant | undefined,
): string {
  const { port } = refusal
  const named = occupant
    ? `Process ${occupant.pid}${occupant.command ? ` (${occupant.command})` : ''} listens on port ${port}`
    : `Something listens on port ${port}`
  if (refusal.reason === 'not-permitted')
    return `Port ${port} is not permitted for Codebook on this machine (the operating system refuses to let this program listen on it). Ask the learner to declare the port the server's own code listens on, from 1024 up, then start again.`
  if (refusal.reason === 'unreadable')
    return `Codebook could not check whether port ${port} is free (${refusal.errorCode ?? 'unknown error'}), so it did not start the server. Ask the learner to resolve the network problem on this machine, then start again.`
  if (refusal.reason === 'held-by-codebook')
    return `Port ${port} is still held by an earlier Codebook run that ${refusal.heldBy === 'stopping' ? 'has not finished stopping' : 'is still running'}. Stop that run (codebook_stop) and wait for it to finish, then start again.`
  return `${named}, and the declaration names it as the server's own port. Ask the learner to stop that process, or to declare the port the server's own code listens on, then start again; never end that process yourself.`
}

/**
 * Refuses a node-server start while its declared port is taken, with `PORT_UNAVAILABLE`.
 * The check is the repository-browser one ({@link assertDevelopmentPortFree}): a port that Codebook's own stopping run holds is waited for up to 5,000 ms first; only the refusal's wording differs.
 * Called by the node-server run's preparation, before anything is spawned.
 * @param input - The declared port, the run's cancellation, how to find the occupying process, and the check's test seams.
 * @throws `PORT_UNAVAILABLE` naming the occupying pid and command when visible.
 * @example await assertNodeServerPortFree({ port: 4100, signal, findPortOccupant })
 */
export async function assertNodeServerPortFree(input: {
  port: number
  signal?: AbortSignal
  findPortOccupant(port: number): Promise<PortOccupant | undefined>
  seams?: Pick<PortCheckOptions, 'connect' | 'bind' | 'releaseWaitMs'>
}): Promise<void> {
  await assertDevelopmentPortFree(
    { port: input.port, source: 'the node-server declaration' },
    {
      ...input.seams,
      signal: input.signal,
      refuse: async (refusal) =>
        new StudyError(
          'PORT_UNAVAILABLE',
          refusalText(
            refusal,
            refusal.reason === 'in-use'
              ? await input.findPortOccupant(refusal.port)
              : undefined,
          ),
        ),
    },
  )
}
