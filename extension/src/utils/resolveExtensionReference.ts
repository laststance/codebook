/** The scheme of an extension's own urls. */
const EXTENSION_SCHEME = 'chrome-extension:'

/**
 * Resolves a script reference against the url of the file (or `<base href>`) that names it, and keeps it only when it points into the run's own extension.
 * Handles relative, root-absolute (`/x.js`, against the extension root) and `chrome-extension://<id>/` forms of the run's id; query strings and fragments are dropped. Called by {@link discoverStaticLoads} for every literal reference.
 * @param reference - The specifier as written.
 * @param baseUrl - The url the reference is relative to.
 * @param extensionId - The run's extension id; another id or an http url is not followed.
 * @returns The path relative to the extension root, or `undefined` when the reference leaves the extension or climbs above its root.
 * @example
 * resolveExtensionReference('../lib.js?v=2', extensionFileUrl('ui/page.js', id), id) // => 'lib.js'
 * resolveExtensionReference('https://example.com/x.js', base, id)                   // => undefined
 */
export function resolveExtensionReference(
  reference: string,
  baseUrl: URL,
  extensionId: string,
): string | undefined {
  let resolved: URL
  try {
    resolved = new URL(reference, baseUrl)
  } catch {
    return undefined
  }
  if (resolved.protocol !== EXTENSION_SCHEME || resolved.host !== extensionId)
    return undefined
  let path: string
  try {
    path = decodeURIComponent(resolved.pathname.slice(1))
  } catch {
    return undefined
  }
  // An encoded `..` survives URL normalization; refuse anything that is not a plain path below the root.
  const segments = path.split('/')
  if (
    path === '' ||
    segments.some(
      (segment) => segment === '..' || segment === '.' || segment === '',
    )
  )
    return undefined
  return path
}
