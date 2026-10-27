// Test-only HTTP server for the node-server launcher and run tests; it never ships (package.test.mjs checks the VSIX).
// Like a repository's own server, it reads its settings from the folder it runs in (fixture-server.json there), never from Codebook.
// The tests copy its compiled file into a new folder, so it imports only Node.js built-ins.
import { fork, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { Socket } from 'node:net'

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

/** Request bytes received on each open connection, so `/received-bytes` can report what other connections sent. */
const receivedBytesByConnection = new Map<Socket, number>()

/** A reply: status, headers and body. */
type Reply = { status: number; headers: Record<string, string>; body: Buffer }

/**
 * Builds a JSON reply.
 * @param status - The HTTP status.
 * @param value - The value to serialize.
 * @returns The reply.
 * @example jsonReply(200, { status: 'ok' })
 */
function jsonReply(status: number, value: unknown): Reply {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify(value)),
  }
}

/**
 * Builds a reply of raw bytes.
 * @param contentType - The reply's Content-Type.
 * @param body - The bytes.
 * @param headers - Further headers.
 * @returns The reply.
 * @example bytesReply('application/octet-stream', Buffer.from([1, 2]))
 */
function bytesReply(
  contentType: string,
  body: Buffer,
  headers: Record<string, string> = {},
): Reply {
  return {
    status: 200,
    headers: { 'Content-Type': contentType, ...headers },
    body,
  }
}

/**
 * Reads a request's whole body.
 * @param request - The incoming request.
 * @returns The body as text.
 * @example await readBody(request) // => '{"a":1}'
 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Answers one request: /health with a status (/log-credential also logs a credential-shaped token), /environment with the names (never the values) of the variables the server inherited, /echo with the method, headers and body it received, /received-bytes with the request bytes other connections sent, /reset by closing the connection without a reply, /big with 2 MiB of text, /binary, /invalid-utf8, /secret, /redirect-same and /redirect-other, anything else with 404.
 * @param request - The incoming request.
 * @param response - The response to write.
 * @example GET /health // => 200 {"status":"ok"}
 */
async function answer(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestPath = new URL(request.url ?? '/', 'http://fixture').pathname
  console.log(`fixture request ${request.method} ${request.url}`)
  // A server that logs a credential, split over two writes as a stream may deliver it.
  if (requestPath === '/log-credential') {
    process.stdout.write('fixture using token ghp_0123456789')
    process.stdout.write('abcdefghijKLMNOP and more\n')
  }
  if (requestPath === '/reset') {
    request.socket.destroy()
    return
  }
  const echoed = requestPath === '/echo' ? await readBody(request) : ''
  const otherConnectionsBytes = [...receivedBytesByConnection]
    .filter(([socket]) => socket !== request.socket)
    .reduce((sum, [, bytes]) => sum + bytes, 0)
  const replies: Record<string, () => Reply> = {
    '/health': () => jsonReply(200, { status: 'ok' }),
    '/log-credential': () => jsonReply(200, { status: 'ok' }),
    '/environment': () =>
      jsonReply(200, { names: Object.keys(process.env).sort() }),
    '/echo': () =>
      jsonReply(200, {
        method: request.method,
        headers: request.headers,
        rawHeaderNames: request.rawHeaders.filter(
          (_, index) => index % 2 === 0,
        ),
        body: echoed,
      }),
    '/received-bytes': () => jsonReply(200, { bytes: otherConnectionsBytes }),
    '/big': () => bytesReply('text/plain', Buffer.alloc(2_097_152, 0x61)),
    '/binary': () =>
      bytesReply('application/octet-stream', Buffer.from([0, 1, 2, 255])),
    '/invalid-utf8': () =>
      bytesReply('text/plain', Buffer.from([0x41, 0xff, 0x42])),
    '/secret': () =>
      bytesReply(
        'text/plain',
        Buffer.from('token ghp_0123456789abcdefghijKLMNOP'),
      ),
    '/odd-content-type': () =>
      bytesReply(
        `text/plain; note=ghp_0123456789abcdefghijKLMNOP;${'x'.repeat(400)}`,
        Buffer.from('ok'),
      ),
    '/redirect-same': () => ({
      status: 302,
      headers: { Location: '/health' },
      body: Buffer.alloc(0),
    }),
    '/redirect-other': () => ({
      status: 302,
      headers: { Location: 'https://example.com/elsewhere' },
      body: Buffer.alloc(0),
    }),
  }
  const reply =
    replies[requestPath]?.() ?? jsonReply(404, { error: 'not found' })
  response.writeHead(reply.status, reply.headers)
  response.end(reply.body)
}

const server = createServer((request, response) => {
  void answer(request, response)
})
server.on('connection', (socket) => {
  receivedBytesByConnection.set(socket, 0)
  socket.on('data', (chunk) =>
    receivedBytesByConnection.set(
      socket,
      (receivedBytesByConnection.get(socket) ?? 0) + chunk.length,
    ),
  )
})
const port = Number(setting('port'))
const host = String(setting('host') ?? '127.0.0.1')
// A "fork" parent starts a child that listens and does not listen itself, as a cluster or fork server does.
const isForkChild = process.argv[2] === 'fork-child'
let forkChild: ChildProcess | undefined
if (mode === 'never-listen') setInterval(() => undefined, 60_000)
else if (mode === 'fork' && !isForkChild) {
  forkChild = fork(process.argv[1] ?? '', ['fork-child'])
  setInterval(() => undefined, 60_000)
} else
  server.listen(port, host, () =>
    console.log(`fixture listening on ${host}:${port}`),
  )

// A graceful shutdown, as switch-time's server.ts has: with a debugger still attached, node waits for it before exiting.
// In `ignore-sigterm` mode the server swallows SIGTERM, as a server stuck in its own shutdown does, so only SIGKILL ends it.
process.on('SIGTERM', () => {
  if (mode === 'ignore-sigterm') return
  forkChild?.kill('SIGTERM')
  if (forkChild) process.exit(0)
  server.close(() => process.exit(0))
})
