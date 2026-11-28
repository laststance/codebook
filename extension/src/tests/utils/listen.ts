import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { type AddressInfo } from 'node:net'

/** Starts a loopback HTTP server that is closed, with its open connections, when the test ends. */
export async function listen(
  context: { after: (callback: () => Promise<void>) => void },
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { server, port: (server.address() as AddressInfo).port }
}
