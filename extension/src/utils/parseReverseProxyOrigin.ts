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
  void text
  throw new Error('not implemented')
}
