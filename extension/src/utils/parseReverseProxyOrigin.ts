import { isIP } from 'node:net'

/** The D8 item numbers of the origin rules {@link parseReverseProxyOrigin} can refuse: 1 not a URL, 2 scheme, 3 path, 4 query or fragment, 5 credentials, 6 IP literal, 11 `localhost` or a `*.localhost` host. */
export type ReverseProxyOriginRefusalItem = 1 | 2 | 3 | 4 | 5 | 6 | 11

/** What {@link parseReverseProxyOrigin} answers: the canonical origin with its parts, or the refused rule. */
export type ParsedReverseProxyOrigin =
  | {
      ok: true
      /** `${scheme}://${hostname}` plus `:${port}` when the port is not the scheme's default: lower-case, punycoded, no trailing dot or slash. */
      origin: string
      /** The host name, lower-case and punycoded, without a trailing dot. */
      hostname: string
      /** The explicit port as `URL` reports it (`''` for the scheme's default). */
      port: string
      /** The port the browser connects to: the explicit port, else 443 for `https` and 80 for `http`. */
      effectivePort: number
      scheme: 'http' | 'https'
    }
  | { ok: false; item: ReverseProxyOriginRefusalItem }

/**
 * Parses and canonicalizes a declared `reverseProxy.origin`, or names the rule it breaks.
 *
 * Why it exists: the schema refinement words the refusal from the item, `canonicalizeReverseProxy` rewrites the origin to the canonical form, and the gate reads the hostname and the effective port from it, so one parser serves all three. The live schema stays transform-free; normalization lives here.
 * Called by the repository configuration schemas, the gate and the run.
 * @param text - The origin as declared.
 * @returns The canonical origin and its parts, or `{ ok: false, item }` for the first rule broken (1, 2, 5, 3, 4, 6, 11 in that order).
 * @example
 * parseReverseProxyOrigin('https://App.Example.test/') // => { ok: true, origin: 'https://app.example.test', hostname: 'app.example.test', port: '', effectivePort: 443, scheme: 'https' }
 * parseReverseProxyOrigin('https://app.example.test/login') // => { ok: false, item: 3 }
 */
export function parseReverseProxyOrigin(
  text: string,
): ParsedReverseProxyOrigin {
  const url = readUrl(text)
  if (url === undefined) return { ok: false, item: 1 }
  const item =
    refusalOfScheme(url) ??
    refusalOfCredentials(url) ??
    refusalOfLocation(text, url) ??
    refusalOfHost(url)
  return item === undefined ? canonicalOf(url) : { ok: false, item }
}

/** The host name without the brackets of an IPv6 literal and without one trailing dot. */
function bareHostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

/**
 * Reads the declared text as a URL.
 * Called by {@link parseReverseProxyOrigin}.
 * @param text - The origin as declared.
 * @returns The URL, or `undefined` when the text has surrounding white space or does not parse (D8 item 1).
 * @example readUrl(' https://app.example.test') // => undefined
 */
function readUrl(text: string): URL | undefined {
  // Surrounding white space is refused rather than trimmed: the declared text must be the address the learner types.
  if (text !== text.trim()) return undefined
  return URL.parse(text) ?? undefined
}

/**
 * Refuses a scheme other than `http:` and `https:` (D8 item 2).
 * @param url - The parsed origin.
 * @returns `2`, or `undefined` when the scheme is accepted.
 * @example refusalOfScheme(new URL('ftp://app.example.test')) // => 2
 */
function refusalOfScheme(url: URL): 2 | undefined {
  return url.protocol === 'http:' || url.protocol === 'https:' ? undefined : 2
}

/**
 * Refuses a user name or a password in the origin (D8 item 5).
 * @param url - The parsed origin.
 * @returns `5`, or `undefined` when there are no credentials.
 * @example refusalOfCredentials(new URL('https://user@app.example.test')) // => 5
 */
function refusalOfCredentials(url: URL): 5 | undefined {
  return url.username !== '' || url.password !== '' ? 5 : undefined
}

/**
 * Refuses a path (D8 item 3), then a query or a fragment, including an empty `?` or `#` the parser drops (D8 item 4).
 * @param text - The origin as declared.
 * @param url - The parsed origin.
 * @returns `3`, `4`, or `undefined` when the origin is scheme, host and port only.
 * @example refusalOfLocation('https://app.example.test/?', new URL('https://app.example.test/?')) // => 4
 */
function refusalOfLocation(text: string, url: URL): 3 | 4 | undefined {
  if (url.pathname !== '/') return 3
  // The text is checked too: `new URL` reports an empty query or fragment as an empty string.
  const hasQueryOrFragment =
    text.includes('?') ||
    text.includes('#') ||
    url.search !== '' ||
    url.hash !== ''
  return hasQueryOrFragment ? 4 : undefined
}

/**
 * Refuses an IP literal (D8 item 6) and `localhost` or a `*.localhost` host (D8 item 11).
 * @param url - The parsed origin.
 * @returns `6`, `11`, or `undefined` when the host is a name other than `localhost`.
 * @example refusalOfHost(new URL('https://0x7f.1')) // => 6
 */
function refusalOfHost(url: URL): 6 | 11 | undefined {
  const hostname = bareHostnameOf(url)
  if (isIP(hostname) !== 0) return 6
  const namesLocalhost =
    hostname === 'localhost' || hostname.endsWith('.localhost')
  return namesLocalhost ? 11 : undefined
}

/**
 * Builds the accepted answer: the canonical origin and its parts.
 * @param url - The parsed origin that passed every rule.
 * @returns `{ ok: true, … }` with a lower-case, punycoded host without a trailing dot or slash.
 * @example canonicalOf(new URL('https://App.Example.test:8443')).origin // => 'https://app.example.test:8443'
 */
function canonicalOf(url: URL): ParsedReverseProxyOrigin {
  const hostname = bareHostnameOf(url)
  const scheme = url.protocol === 'https:' ? 'https' : 'http'
  const defaultPort = scheme === 'https' ? 443 : 80
  return {
    ok: true,
    origin: `${scheme}://${hostname}${url.port === '' ? '' : `:${url.port}`}`,
    hostname,
    port: url.port,
    effectivePort: url.port === '' ? defaultPort : Number(url.port),
    scheme,
  }
}
