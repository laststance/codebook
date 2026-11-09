import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream'

import { STATIC_PAGE_CACHE_CONTROL } from '../constants'
import { staticPageListenFailedRefusal } from '../staticPageRefusals'

import { isInsideFolder } from './isInsideFolder'

/** The `Content-Type` of each file extension the server answers with; every other extension is a byte stream. */
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

/** The fallback `Content-Type` of an extension {@link CONTENT_TYPE_BY_EXTENSION} does not name. */
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Gives the `Content-Type` a file is served with.
 * @param path - The file path.
 * @returns The content type of its extension (case-insensitive), else a byte stream.
 * @example contentTypeOfPath('/p/main.mjs') // => 'text/javascript; charset=utf-8'
 */
export function contentTypeOfPath(path: string): string {
  return (
    CONTENT_TYPE_BY_EXTENSION[extname(path).toLowerCase()] ??
    DEFAULT_CONTENT_TYPE
  )
}

/**
 * Tells whether a `Host` header names the loopback server itself.
 * Called by {@link answerStaticPageRequest} to refuse a request a rebinding page sent under another name.
 * @param host - The request's `Host` header.
 * @param port - The port the server listens on.
 * @returns `true` only for `127.0.0.1:<port>` or `localhost:<port>`.
 * @example isLoopbackHost('localhost:4310', 4310) // => true
 */
function isLoopbackHost(host: string | undefined, port: number): boolean {
  return (
    host === `127.0.0.1:${port}` || host?.toLowerCase() === `localhost:${port}`
  )
}

/**
 * Answers one request from the page folder: the file under the real-path containment rule, `index.html` for a folder path.
 * Called by the server {@link startStaticPageServer} creates for each request.
 * @param root - The page folder's real path.
 * @param port - The port the server listens on.
 * @param request - The request.
 * @param response - The response to answer on.
 * @example await answerStaticPageRequest('/p', 4310, request, response) // 200 with the file, 403 outside the folder, 404 for an absent file
 */
async function answerStaticPageRequest(
  root: string,
  port: number,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const send = (status: number, text: string): void => {
    response.writeHead(status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': STATIC_PAGE_CACHE_CONTROL,
    })
    response.end(text)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return send(405, 'Method not allowed')
  // A request carrying another Host header (DNS rebinding) is never answered.
  if (!isLoopbackHost(request.headers.host, port)) return send(403, 'Forbidden')
  let pathname: string
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://x').pathname,
    )
  } catch {
    return send(400, 'Bad request')
  }
  if (pathname.includes('\0')) return send(400, 'Bad request')
  // Dotfiles and dot-folders (`.git`, `.env`) are never served, whatever the folder holds.
  if (pathname.split('/').some((segment) => segment.startsWith('.')))
    return send(403, 'Forbidden')
  const wanted = pathname.endsWith('/') ? `${pathname}index.html` : pathname
  let real: string
  try {
    real = await realpath(join(root, wanted))
  } catch {
    return send(404, 'Not found')
  }
  // A path that leaves the folder, also through a link, is never answered.
  if (!isInsideFolder(root, real)) return send(403, 'Forbidden')
  const info = await stat(real).catch(() => undefined)
  if (!info?.isFile()) return send(404, 'Not found')
  response.writeHead(200, {
    'Content-Type': contentTypeOfPath(real),
    'Content-Length': info.size,
    'Cache-Control': STATIC_PAGE_CACHE_CONTROL,
  })
  if (request.method === 'HEAD') return void response.end()
  // pipeline closes the file when the request is aborted and ends the response on a read error.
  pipeline(createReadStream(real), response, () => undefined)
}

/** The handle of a started static page server: the part of the development-server handle a `static-page` run uses. */
export type StaticPageServer = {
  /** The origin the server answers on, `http://127.0.0.1:<port>`. */
  origin: string
  port: number
  isRunning(): boolean
  /** Closes the listener and every open connection; safe to call again. */
  close(): Promise<void>
}

/**
 * Starts the loopback static file server of a `static-page` run on a port the operating system picks.
 *
 * Why it exists: the page is served by Codebook's own server, never by the Example's tooling, so nothing the Example ships runs and nothing is installed. Called by the `static-page` adapter's `start`; it closes with the run.
 * @param root - The page folder's real path; only files below it are served.
 * @returns The running server.
 * @throws `STATIC_PAGE_SERVER_FAILED` (`listen-failed`) when the server cannot listen.
 * @example
 * const server = await startStaticPageServer('/repo/examples/page')
 * await fetch(`${server.origin}/`) // => 200 with index.html
 */
export async function startStaticPageServer(
  root: string,
): Promise<StaticPageServer> {
  // A folder that cannot be resolved is the coded refusal, never a raw file-system error.
  const realRoot = await realpath(root).catch((error: unknown) => {
    throw staticPageListenFailedRefusal(
      error instanceof Error && 'code' in error ? String(error.code) : 'error',
    )
  })
  let listeningPort = 0
  const server: Server = createServer((request, response) => {
    answerStaticPageRequest(realRoot, listeningPort, request, response).catch(
      () => {
        if (!response.headersSent) response.writeHead(500)
        response.end()
      },
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  }).catch((error: unknown) => {
    const code =
      error instanceof Error && 'code' in error ? String(error.code) : 'error'
    throw staticPageListenFailedRefusal(code)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw staticPageListenFailedRefusal('no-address')
  const { port } = address
  listeningPort = port
  let isClosed = false
  let closing: Promise<void> | undefined
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    isRunning: () => !isClosed && server.listening,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve) => {
        isClosed = true
        server.close(() => resolve())
        server.closeAllConnections()
      })
      return closing
    },
  }
}
