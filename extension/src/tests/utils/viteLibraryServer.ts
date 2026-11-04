import { createServer } from 'node:http'

/**
 * Starts a stand-in owned Vite server on loopback for a library stop: it serves an entry page with module scripts and the library's built module under `/@fs/`, answering any `?v=` hash with the module text of the moment.
 *
 * Why it exists: the Cycle 0078 integration tests run the real Vite adapter's library seal, which fetches the entry page and the library module over HTTP from the owned origin; the rest of the runtime stays scripted. Used by `configuredRuntimeHarness` when a test opts into a Vite library stop.
 * @param moduleRoute - The served path of the library module without its query (`/@fs/<real repository>/packages/core/build/modern/a.js`).
 * @param moduleText - The module text served first.
 * @returns The origin, a setter for the module text and the server's closing function.
 * @example
 * const server = await startViteLibraryServer('/@fs/repo/packages/core/build/modern/a.js', text)
 * server.setModuleText(otherText)
 */
export async function startViteLibraryServer(
  moduleRoute: string,
  moduleText: string,
) {
  let currentText = moduleText
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html')
      response.end(
        '<!doctype html><script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>',
      )
      return
    }
    if (url.pathname === moduleRoute) {
      response.setHeader('content-type', 'text/javascript')
      response.end(currentText)
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    /** Serves this text from now on, as the owned server does after the library is rebuilt. */
    setModuleText(text: string): void {
      currentText = text
    },
    close: (): Promise<void> =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
