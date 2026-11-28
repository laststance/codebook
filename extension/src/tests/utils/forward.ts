import { request, type IncomingMessage, type ServerResponse } from 'node:http'

/** Forwards one request to the loopback port of a real Codebook endpoint. */
export function forward(
  port: number,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  /** The request body when the caller already consumed the stream. */
  body?: Buffer,
): void {
  const upstream = request(
    {
      host: '127.0.0.1',
      port,
      path: incoming.url,
      method: incoming.method,
      // The real endpoint answers only its own host name.
      headers: { ...incoming.headers, host: `127.0.0.1:${port}` },
    },
    (answer) => {
      outgoing.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(outgoing)
    },
  )
  if (body) upstream.end(body)
  else incoming.pipe(upstream)
}
