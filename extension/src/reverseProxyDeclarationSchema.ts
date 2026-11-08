import { z } from 'zod'

import {
  NODE_SERVER_PORT_MAX,
  NODE_SERVER_PORT_MIN,
  REVERSE_PROXY_MINIMUM_API,
} from './constants'
import type { ReverseProxyOriginRefusalItem } from './utils/parseReverseProxyOrigin'

/** The message for a missing `origin`. */
const ORIGIN_MISSING_MESSAGE =
  'reverseProxy needs origin: the address the learner types in the browser, such as https://app.example.test.'

/** The message for an `upstreamPort` that is missing, not an integer or out of range. */
const UPSTREAM_PORT_MESSAGE = `reverseProxy.upstreamPort must be a whole number from ${NODE_SERVER_PORT_MIN} to ${NODE_SERVER_PORT_MAX}: the port the learner's proxy forwards to. Read it from the proxy's own configuration or ask the learner; never guess it.`

/**
 * The optional `reverseProxy` declaration of a version 3 `next-dev-webpack` configuration (MCP API 1.40): the address the learner opens the app at through their own local reverse proxy, and the port that proxy forwards to.
 * Only the shape is checked here. The origin rules (scheme, path, query, credentials, IP literal, `localhost`), the adapter rule, the `library` conflict and the canonical spelling live in the repository configuration schemas, which call `parseReverseProxyOrigin`; the schema stays transform-free so `z.toJSONSchema` keeps working on the live schema.
 * Read by the version 3 repository-browser configuration; every adapter but `next-dev-webpack` and every older version refuses the key.
 * @example
 * reverseProxyDeclarationSchema.parse({ origin: 'https://app.example.test', upstreamPort: 4310 }) // => same object
 */
export const reverseProxyDeclarationSchema = z
  .strictObject({
    origin: z
      .string(ORIGIN_MISSING_MESSAGE)
      .describe(
        'The address the learner types in the browser: scheme and host, plus the port when it is not 443 for https or 80 for http, for example https://app.example.test. No path (put the page in entryPath), no query, no fragment, no credentials, no IP address, and not localhost or a *.localhost host. The host must be a name this machine resolves only to loopback addresses.',
      ),
    upstreamPort: z
      .number(UPSTREAM_PORT_MESSAGE)
      .int(UPSTREAM_PORT_MESSAGE)
      .min(NODE_SERVER_PORT_MIN, UPSTREAM_PORT_MESSAGE)
      .max(NODE_SERVER_PORT_MAX, UPSTREAM_PORT_MESSAGE)
      .describe(
        "The port the learner's proxy forwards to on this machine, as the proxy's own configuration names it (nginx proxy_pass, Caddy reverse_proxy, a Traefik service URL), from 1024 to 65535. Codebook starts next dev on this port, bound to 127.0.0.1, so the learner's own dev server must not run on it. Never copy the dev script's port or Next's default without reading the proxy's configuration or asking the learner.",
      ),
  })
  .describe(
    `Optional (API ${REVERSE_PROXY_MINIMUM_API}, next-dev-webpack, version 3). Declare it when the learner opens the app through their own local reverse proxy (nginx, Caddy or Traefik with a locally trusted certificate) at a host name, instead of opening the dev server directly at its own http://localhost:<port> address. Codebook starts the dev server itself on upstreamPort, proves that origin reaches that server and only this machine, and opens the entry at origin. It is not an HTTP proxy setting and not Vite's server.proxy. Omit it when the learner opens the dev server directly.`,
  )

/** The parsed `reverseProxy` declaration: the origin the learner types and the port their proxy forwards to. */
export type ReverseProxyDeclaration = z.infer<
  typeof reverseProxyDeclarationSchema
>

/**
 * The stand-alone refusal sentence of each origin rule {@link parseReverseProxyOrigin} can break (D8 items 1 to 6 and 11); none echoes a value that may carry credentials, a query or a path.
 * Read by the repository configuration schemas, which report it at `reverseProxy.origin` as an `INVALID_CONFIGURATION` issue.
 */
export const REVERSE_PROXY_ORIGIN_REFUSAL_MESSAGES = {
  1: 'reverseProxy.origin is not a URL: declare the address the learner types in the browser, such as https://app.example.test.',
  2: 'reverseProxy.origin must start with https:// or http://; other schemes are not an app origin.',
  3: 'reverseProxy.origin must not carry a path: declare only the scheme and host, and put the page in entryPath.',
  4: 'reverseProxy.origin must not carry a query or a fragment: declare only the scheme and host.',
  5: 'reverseProxy.origin must not carry a user name or a password; Codebook takes no credentials in a URL.',
  6: "reverseProxy.origin must name a host, not an IP address: declare the host name the learner types, the one their hosts entry or local DNS maps to a loopback address. An app opened directly at its dev server's http://localhost:<port> address declares no reverseProxy.",
  11: 'reverseProxy.origin must not name localhost or a *.localhost host: the browser resolves those itself, so Codebook cannot hold it to the address it checked. Declare the host name your hosts entry or local DNS maps to a loopback address.',
} as const satisfies Record<ReverseProxyOriginRefusalItem, string>

/** D8 item 10: `reverseProxy` on a run that is not a version 3 `next-dev-webpack` run. */
export const REVERSE_PROXY_ADAPTER_MESSAGE = `reverseProxy is accepted on a version 3 next-dev-webpack run only (API ${REVERSE_PROXY_MINIMUM_API}). A Vite, Create React App or Expo run opens the app at the dev server's own localhost address.`

/** D19 item 12: `reverseProxy` beside `library`. */
export const REVERSE_PROXY_LIBRARY_MESSAGE =
  'reverseProxy and library cannot be declared on one run; declare the library run or the reverse proxy run, not both.'
