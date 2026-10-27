import { once } from 'node:events'
import { createServer } from 'node:net'

/**
 * Finds a loopback port that was free a moment ago, for a fixture server or a foreign listener to take.
 * @returns The port number.
 * @example await freeLoopbackPort() // => 53811
 */
export async function freeLoopbackPort(): Promise<number> {
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const address = probe.address()
  if (!address || typeof address === 'string')
    throw new Error('The probe server has no port.')
  probe.close()
  await once(probe, 'close')
  return address.port
}
