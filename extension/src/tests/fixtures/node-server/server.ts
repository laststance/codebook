// Test-only HTTP server for the node-server launcher and run tests; it never ships (package.test.mjs checks the VSIX).
// Like a repository's own server, it reads its settings from the folder it runs in (fixture-server.json there), never from Codebook.
// The tests copy its compiled file into a new folder, so it imports only Node.js built-ins.
import { readFileSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'

const settings: unknown = JSON.parse(
  readFileSync('fixture-server.json', 'utf8'),
)

/**
 * Reads one setting of fixture-server.json.
 * @param name - The setting's name.
 * @returns Its value, or `undefined` when the file does not set it.
 * @example setting('port') // => 4100
 */
function setting(name: string): unknown {
  return typeof settings === 'object' && settings !== null
    ? Reflect.get(settings, name)
    : undefined
}

const mode = String(setting('mode') ?? 'listen')
if (mode === 'exit-before-listen') {
  console.error('fixture cannot start: exit-before-listen')
  process.exit(3)
}

/**
 * Answers one request: /health with a status (/log-credential also logs a credential-shaped token), /environment with the names (never the values) of the variables the server inherited, anything else with 404.
 * @param request - The incoming request.
 * @param response - The response to write.
 * @example GET /health // => 200 {"status":"ok"}
 */
function answer(request: IncomingMessage, response: ServerResponse): void {
  const requestPath = request.url
  console.log(`fixture request ${request.method} ${requestPath}`)
  // A server that logs a credential, split over two writes as a stream may deliver it.
  if (requestPath === '/log-credential') {
    process.stdout.write('fixture using token ghp_0123456789')
    process.stdout.write('abcdefghijKLMNOP and more\n')
  }
  const body =
    requestPath === '/health' || requestPath === '/log-credential'
      ? { status: 'ok' }
      : requestPath === '/environment'
        ? { names: Object.keys(process.env).sort() }
        : undefined
  response.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body ?? { error: 'not found' }))
}

const server = createServer(answer)
const port = Number(setting('port'))
const host = String(setting('host') ?? '127.0.0.1')
if (mode === 'never-listen') setInterval(() => undefined, 60_000)
else
  server.listen(port, host, () =>
    console.log(`fixture listening on ${host}:${port}`),
  )

// A graceful shutdown, as switch-time's server.ts has: with a debugger still attached, node waits for it before exiting.
process.on('SIGTERM', () => server.close(() => process.exit(0)))
