import { createConnection } from 'node:net'

import { CONTROL_RESPONSE_LIMIT_MS } from '../constants'

/** Proves listener closure by TCP refusal during runner teardown; unresponsive listeners remain unverified. @example await isEndpointClosed('http://127.0.0.1:9222') */
export function isEndpointClosed(
  origin: string,
  timeoutMs = CONTROL_RESPONSE_LIMIT_MS,
): Promise<boolean> {
  const endpoint = new URL(origin)
  if (endpoint.hostname !== '127.0.0.1')
    throw new Error('Endpoint closure checks require loopback ownership')
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: endpoint.hostname,
      port: Number(endpoint.port),
    })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(
        new Error('Endpoint closure is unverified: TCP connection timed out'),
      )
    })
    socket.once('error', (error) => {
      socket.destroy()
      if ('code' in error && error.code === 'ECONNREFUSED') resolve(true)
      else reject(error)
    })
  })
}
