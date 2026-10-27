import { once } from 'node:events'
import { createServer, type Server } from 'node:net'
import type { TestContext } from 'node:test'

/**
 * Occupies a loopback port with a listener that is not the server under test, for the tests of listener ownership: this test process is the foreign owner.
 * @param context - The test, at whose end the listener is closed.
 * @param port - The port to take.
 * @param host - The address to bind; `127.0.0.1` unless a test names another (`::` for a dual-stack wildcard).
 * @returns The listener.
 * @example await occupyPort(t, 4100, '::1')
 */
export async function occupyPort(
  context: TestContext,
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const listener = createServer((socket) => socket.destroy())
  listener.listen(port, host)
  await once(listener, 'listening')
  context.after(async () => {
    listener.close()
    await once(listener, 'close')
  })
  return listener
}
