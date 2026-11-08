/**
 * Tells whether a configuration declares `reverseProxy`; an explicit `reverseProxy: undefined` declares nothing.
 *
 * Why it exists: a study that holds the declaration is saved as format 22, the schema member that accepts it is chosen by this test, and the retained schemas refuse it. Called by the study format rules, the configuration schemas and the run.
 * @param configuration - Any configuration; only its `reverseProxy` key is read.
 * @returns `true` when `reverseProxy` is present and not `undefined`.
 * @example
 * declaresReverseProxy({ reverseProxy: { origin: 'https://app.example.test', upstreamPort: 4310 } }) // => true
 * declaresReverseProxy({ reverseProxy: undefined }) // => false
 */
export function declaresReverseProxy(configuration: {
  reverseProxy?: unknown
}): boolean {
  // An explicit `reverseProxy: undefined` is the same as no key: it declares nothing.
  return configuration.reverseProxy !== undefined
}
